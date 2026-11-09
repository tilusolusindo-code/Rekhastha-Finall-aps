/**
 * DOKU Payment Routes
 *
 * POST /api/doku/create        — Buat payment order, dapat checkout URL
 * POST /api/doku/notify        — Webhook dari DOKU (tidak perlu auth)
 * GET  /api/doku/status/:order — Cek status order
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  subscriptionOrdersTable,
  subscriptionPlansTable,
  dokuPaymentsTable,
} from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  createDokuOrder,
  verifyDokuNotification,
  logDokuMode,
  type DokuNotifyPayload,
} from "../lib/doku";
import { logger } from "../lib/logger";

const router: IRouter = Router();
logDokuMode();

// ── POST /api/doku/create ─────────────────────────────────────────────────────
/**
 * Employer minta checkout URL untuk bayar langganan.
 * Body: { planId: number }
 */
router.post("/doku/create", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya akun perusahaan yang bisa berlangganan." });
    return;
  }

  const parsed = z.object({ planId: z.coerce.number() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "planId tidak valid." });
    return;
  }

  const [plan] = await db
    .select()
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, parsed.data.planId))
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "Paket tidak ditemukan." });
    return;
  }

  try {
    // Buat subscription order dulu
    const [order] = await db
      .insert(subscriptionOrdersTable)
      .values({ companyId: user.id, planId: plan.id, amount: plan.promoPrice })
      .returning();
    if (!order) throw new Error("Gagal membuat order.");

    const orderId = `RKS-SUB-${order.id}-${Date.now()}`;

    // Buat DOKU payment
    const dokuResult = await createDokuOrder({
      orderId,
      amount: plan.promoPrice,
      customerName: user.name,
      customerEmail: user.email,
      description: `Rekhastha Bisnis ${plan.label} (${plan.durationDays} hari)`,
    });

    // Simpan record DOKU
    await db.insert(dokuPaymentsTable).values({
      orderId,
      subscriptionOrderId: order.id,
      companyId: user.id,
      amount: plan.promoPrice,
      status: "pending",
      checkoutUrl: dokuResult.checkoutUrl,
      dokuToken: dokuResult.token,
      requestId: dokuResult.requestId,
    });

    res.json({
      ok: true,
      checkoutUrl: dokuResult.checkoutUrl,
      orderId,
      amount: plan.promoPrice,
      plan: { label: plan.label, durationDays: plan.durationDays },
    });
  } catch (err) {
    logger.error({ err }, "[doku] /doku/create error");
    res.status(502).json({ error: "Gagal membuat pembayaran DOKU. Coba lagi." });
  }
});

// ── POST /api/doku/notify ─────────────────────────────────────────────────────
/**
 * Webhook dari DOKU — tidak perlu session auth, tapi diverifikasi signature.
 */
router.post("/doku/notify", async (req, res): Promise<void> => {
  // ── IP Allowlist (production only) ───────────────────────────────────────
  // Ref: https://developers.doku.com/accept-payment/direct-api/snap
  if (isDokuProduction()) {
    const clientIp = ((req.headers["x-forwarded-for"] as string) || "")
      .split(",")[0]?.trim() || req.socket.remoteAddress || "";
    const allowed =
      clientIp.startsWith("103.211.17.") ||
      clientIp.startsWith("103.211.18.") ||
      clientIp.startsWith("103.56.236.");
    if (!allowed) {
      logger.warn({ clientIp }, "[doku] Webhook dari IP tidak dikenal — ditolak");
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const payload = req.body as DokuNotifyPayload;

  // Verifikasi signature
  try {
    if (!verifyDokuNotification(payload)) {
      logger.warn({ payload }, "[doku] Signature tidak valid");
      res.status(401).json({ error: "Signature tidak valid." });
      return;
    }
  } catch (err) {
    logger.error({ err }, "[doku] Gagal verifikasi signature");
    res.status(500).json({ error: "Verifikasi gagal." });
    return;
  }

  const { invoice_number, amount } = payload.order;
  const { status } = payload.transaction;

  logger.info({ invoice_number, amount, status }, "[doku] Webhook diterima");

  try {
    // Update status di doku_payments
    await db.execute(sql`
      UPDATE doku_payments
      SET status = ${status.toLowerCase()},
          transaction_status = ${status},
          payment_channel = ${payload.payment?.channel ?? null},
          notified_at = now(),
          updated_at = now()
      WHERE order_id = ${invoice_number}
    `);

    // Kalau SUCCESS → aktifkan langganan
    if (status === "SUCCESS") {
      const result = await db.execute(sql`
        SELECT dp.company_id, dp.subscription_order_id,
               sp.duration_days
        FROM doku_payments dp
        JOIN subscription_orders so ON so.id = dp.subscription_order_id
        JOIN subscription_plans sp ON sp.id = so.plan_id
        WHERE dp.order_id = ${invoice_number}
        LIMIT 1
      `);

      const row = result.rows[0];
      if (row) {
        const expiredAt = new Date();
        expiredAt.setDate(expiredAt.getDate() + Number(row.duration_days));

        await db.execute(sql`
          UPDATE users
          SET expired_at = ${expiredAt.toISOString()}
          WHERE id = ${row.company_id}
        `);

        await db.execute(sql`
          UPDATE subscription_orders
          SET status = 'paid', paid_at = now()
          WHERE id = ${row.subscription_order_id}
        `);

        logger.info({ companyId: row.company_id, expiredAt }, "[doku] Langganan diaktifkan");

        // Notifikasi ke perusahaan
        await db.execute(sql`
          INSERT INTO notifications (user_id, message, type)
          VALUES (
            ${row.company_id},
            ${'Pembayaran Rekhastha Bisnis berhasil! Langganan Anda aktif hingga ' + expiredAt.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' })},
            'subscription_paid'
          )
        `).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, invoice_number }, "[doku] Gagal update status");
    res.status(500).json({ error: "Internal error." });
  }
});

// ── GET /api/doku/status/:orderId ─────────────────────────────────────────────
router.get("/doku/status/:orderId", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  try {
    const result = await db.execute(sql`
      SELECT status, checkout_url, amount, created_at, notified_at
      FROM doku_payments
      WHERE order_id = ${req.params.orderId}
        AND company_id = ${user.id}
      LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) { res.status(404).json({ error: "Order tidak ditemukan." }); return; }

    res.json({ order: row });
  } catch (err) {
    logger.error({ err }, "[doku] /status error");
    res.status(500).json({ error: "Gagal cek status." });
  }
});

export default router;

// ── DOKU IP Allowlist Middleware (tambahkan ke notify route) ──────────────────
// IP DOKU Production: https://developers.doku.com/accept-payment/direct-api/snap#ip-whitelist
// Sandbox tidak punya IP tetap — bypass di non-production
