/**
 * Midtrans Snap Payment Routes
 *
 * POST /api/payments/midtrans/snap/subscription  — Buat Snap token untuk langganan Bisnis
 * POST /api/payments/midtrans/snap/posting        — Buat Snap token untuk biaya posting lowongan
 * POST /api/payments/midtrans/notification        — Webhook notifikasi dari Midtrans
 * GET  /api/payments/midtrans/status/:orderId     — Cek status order
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  subscriptionOrdersTable,
  subscriptionPlansTable,
  notificationsTable,
} from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  createSnapTransaction,
  verifyMidtransSignature,
  isMidtransProduction,
  logMidtransMode,
} from "../lib/midtrans";
import { getAdminFeeAmount, hasAdminFeeWaiverAt } from "../lib/pricing";
import { logger } from "../lib/logger";

const router: IRouter = Router();
logMidtransMode();

const APP_BASE = process.env["APP_BASE_URL"] ?? "https://rekhastha.my.id";

// ── Helper: buat order ID unik ────────────────────────────────────────────────
function makeOrderId(prefix: string, id: number | string): string {
  return `RKS-${prefix}-${id}-${Date.now()}`;
}

// ── POST /api/payments/midtrans/snap/subscription ─────────────────────────────
/**
 * Employer minta Snap token untuk bayar langganan Rekhastha Bisnis.
 * Body: { planId: number }
 * Returns: { snapToken, orderId, redirectUrl }
 */
router.post("/payments/midtrans/snap/subscription", async (req, res): Promise<void> => {
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

    const orderId = makeOrderId("SUB", order.id);

    // Buat Snap transaction
    const snapResponse = await createSnapTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: plan.promoPrice,
      },
      item_details: [{
        id: `plan-${plan.id}`,
        price: plan.promoPrice,
        quantity: 1,
        name: `Rekhastha Bisnis ${plan.label} (${plan.durationDays} hari)`,
      }],
      customer_details: {
        first_name: user.name,
        email: user.email,
      },
      callbacks: {
        finish: `${APP_BASE}/?payment=success&order=${orderId}&type=subscription`,
        error: `${APP_BASE}/?payment=failed&order=${orderId}`,
        pending: `${APP_BASE}/?payment=pending&order=${orderId}`,
      },
      // Simpan metadata untuk webhook
      custom_field1: `subscription`,
      custom_field2: String(order.id),
      custom_field3: String(user.id),
    });

    // Simpan orderId Midtrans ke subscription order
    await db.execute(sql`
      UPDATE subscription_orders
      SET midtrans_order_id = ${orderId}
      WHERE id = ${order.id}
    `).catch(() => {}); // kolom mungkin belum ada, tidak blocking

    logger.info({ orderId, planId: plan.id, userId: user.id }, "[midtrans] Snap subscription created");

    res.json({
      snapToken: snapResponse.token,
      redirectUrl: snapResponse.redirect_url,
      orderId,
      amount: plan.promoPrice,
      plan: { label: plan.label, durationDays: plan.durationDays },
    });
  } catch (err) {
    logger.error({ err }, "[midtrans] snap/subscription error");
    res.status(502).json({ error: "Gagal membuat sesi pembayaran Midtrans. Coba lagi." });
  }
});

// ── POST /api/payments/midtrans/snap/posting ──────────────────────────────────
/**
 * Employer minta Snap token untuk biaya posting lowongan (Rp 75.000).
 * Body: { jobId: string }
 * Returns: { snapToken, orderId, redirectUrl }
 */
router.post("/payments/midtrans/snap/posting", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(403).json({ error: "Login sebagai perusahaan diperlukan." });
    return;
  }

  const parsed = z.object({ jobId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "jobId tidak valid." });
    return;
  }

  try {
    // Ambil data job
    const jobResult = await db.execute(sql`
      SELECT id, posisi, kategori, employer_id, payment_status, admin_fee_amount
      FROM gigs WHERE id = ${parsed.data.jobId} LIMIT 1
    `);
    const job = jobResult.rows[0];

    if (!job) {
      res.status(404).json({ error: "Lowongan tidak ditemukan." });
      return;
    }
    if (job.employer_id !== user.id) {
      res.status(403).json({ error: "Bukan lowongan Anda." });
      return;
    }
    if (job.payment_status === "confirmed") {
      res.status(409).json({ error: "Lowongan sudah dibayar." });
      return;
    }

    // Cek apakah subscriber (waive fee)
    const [employer] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    const waived = hasAdminFeeWaiverAt(new Date(), {
      createdAt: employer?.createdAt ?? new Date(),
      isPremium: employer?.isPremium ?? false,
      expiredAt: employer?.expiredAt ?? null,
      freeTrialStartedAt: employer?.freeTrialStartedAt ?? null,
      freeTrialExpiresAt: employer?.freeTrialExpiresAt ?? null,
    });

    if (waived) {
      // Subscriber — langsung aktifkan tanpa bayar
      await db.execute(sql`
        UPDATE gigs SET payment_status = 'confirmed', is_active = true
        WHERE id = ${parsed.data.jobId}
      `);
      res.json({ waived: true, message: "Lowongan langsung aktif (subscriber)." });
      return;
    }

    const feeAmount = Number(job.admin_fee_amount) || getAdminFeeAmount(job.kategori as string);
    const orderId = makeOrderId("POST", parsed.data.jobId);

    const snapResponse = await createSnapTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: feeAmount,
      },
      item_details: [{
        id: `posting-${parsed.data.jobId}`,
        price: feeAmount,
        quantity: 1,
        name: `Biaya Posting Lowongan: ${job.posisi}`,
      }],
      customer_details: {
        first_name: user.name,
        email: user.email,
      },
      callbacks: {
        finish: `${APP_BASE}/?payment=success&order=${orderId}&type=posting`,
        error: `${APP_BASE}/?payment=failed&order=${orderId}`,
        pending: `${APP_BASE}/?payment=pending&order=${orderId}`,
      },
      custom_field1: "posting",
      custom_field2: parsed.data.jobId,
      custom_field3: user.id,
    });

    logger.info({ orderId, jobId: parsed.data.jobId, feeAmount }, "[midtrans] Snap posting created");

    res.json({
      snapToken: snapResponse.token,
      redirectUrl: snapResponse.redirect_url,
      orderId,
      amount: feeAmount,
    });
  } catch (err) {
    logger.error({ err }, "[midtrans] snap/posting error");
    res.status(502).json({ error: "Gagal membuat sesi pembayaran. Coba lagi." });
  }
});

// ── POST /api/payments/midtrans/notification ──────────────────────────────────
/**
 * Webhook dari Midtrans — tidak perlu session, diverifikasi signature.
 * Midtrans docs: https://docs.midtrans.com/reference/handling-notifications
 */
router.post("/payments/midtrans/notification", async (req, res): Promise<void> => {
  const body = req.body as {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
    transaction_status: string;
    fraud_status?: string;
    custom_field1?: string;
    custom_field2?: string;
    custom_field3?: string;
    payment_type?: string;
  };

  // Verifikasi signature
  const valid = verifyMidtransSignature({
    orderId:       body.order_id,
    statusCode:    body.status_code,
    grossAmount:   body.gross_amount,
    signatureKey:  body.signature_key,
  });

  if (!valid) {
    logger.warn({ orderId: body.order_id }, "[midtrans] Signature tidak valid");
    res.status(401).json({ error: "Signature tidak valid." });
    return;
  }

  const { transaction_status, fraud_status, order_id } = body;
  const isSuccess =
    (transaction_status === "capture" && fraud_status === "accept") ||
    transaction_status === "settlement";
  const isFailed = ["deny", "cancel", "expire", "failure"].includes(transaction_status);

  logger.info({ order_id, transaction_status, fraud_status, isSuccess }, "[midtrans] Webhook diterima");

  if (!isSuccess) {
    // Catat tapi tidak lakukan apa-apa untuk pending/failed
    res.json({ ok: true, status: transaction_status });
    return;
  }

  const type      = body.custom_field1;  // "subscription" | "posting"
  const targetId  = body.custom_field2;  // order.id | jobId
  const companyId = body.custom_field3;  // user.id

  try {
    if (type === "subscription" && targetId && companyId) {
      // Aktifkan langganan
      const orderResult = await db.execute(sql`
        SELECT so.id, sp.duration_days
        FROM subscription_orders so
        JOIN subscription_plans sp ON sp.id = so.plan_id
        WHERE so.id = ${Number(targetId)} LIMIT 1
      `);
      const row = orderResult.rows[0];

      if (row) {
        const expiredAt = new Date();
        expiredAt.setDate(expiredAt.getDate() + Number(row.duration_days));

        await db.execute(sql`
          UPDATE users
          SET expired_at = ${expiredAt.toISOString()}, is_premium = true
          WHERE id = ${companyId}
        `);
        await db.execute(sql`
          UPDATE subscription_orders
          SET status = 'paid', paid_at = now()
          WHERE id = ${Number(targetId)}
        `);

        // Notifikasi
        await db.insert(notificationsTable).values({
          userId: companyId,
          message: `Pembayaran Rekhastha Bisnis berhasil! Langganan aktif hingga ${expiredAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.`,
          type: "subscription_paid",
        }).catch(() => {});

        logger.info({ companyId, expiredAt }, "[midtrans] Langganan diaktifkan");
      }

    } else if (type === "posting" && targetId && companyId) {
      // Aktifkan lowongan
      await db.execute(sql`
        UPDATE gigs
        SET payment_status = 'confirmed', is_active = true
        WHERE id = ${targetId} AND employer_id = ${companyId}
      `);

      // Notifikasi
      const jobResult = await db.execute(sql`SELECT posisi FROM gigs WHERE id = ${targetId} LIMIT 1`);
      const jobName = (jobResult.rows[0]?.posisi as string) ?? "lowongan";
      await db.insert(notificationsTable).values({
        userId: companyId,
        message: `Pembayaran posting "${jobName}" berhasil! Lowongan Anda sudah tayang.`,
        type: "posting_paid",
      }).catch(() => {});

      logger.info({ jobId: targetId, companyId }, "[midtrans] Lowongan diaktifkan");
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, order_id }, "[midtrans] Gagal proses notifikasi");
    res.status(500).json({ error: "Internal error." });
  }
});

// ── GET /api/payments/midtrans/status/:orderId ────────────────────────────────
router.get("/payments/midtrans/status/:orderId", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return; }

  const { orderId } = req.params;

  // Cek di subscription orders
  const subResult = await db.execute(sql`
    SELECT so.status, so.amount, so.paid_at, sp.label
    FROM subscription_orders so
    JOIN subscription_plans sp ON sp.id = so.plan_id
    WHERE so.midtrans_order_id = ${orderId}
      AND so.company_id = ${user.id}
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  if (subResult.rows[0]) {
    res.json({ type: "subscription", order: subResult.rows[0] });
    return;
  }

  res.status(404).json({ error: "Order tidak ditemukan." });
});

export default router;
