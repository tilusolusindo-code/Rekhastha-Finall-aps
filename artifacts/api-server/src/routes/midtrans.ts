import { notifyByEmail } from "../lib/notify";
import { recordSecurityEvent } from "../lib/security-events";
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
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  gigsTable,
  instantOrdersTable,
  manualPaymentsTable,
  usersTable,
  subscriptionOrdersTable,
  subscriptionPlansTable,
  notificationsTable,
} from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  createSnapTransaction,
  verifyMidtransSignature,
  getMidtransTransactionStatus,
  isMidtransProduction,
  logMidtransMode,
} from "../lib/midtrans";
import { broadcastGig, broadcastInstantActivated } from "../lib/realtime";
import { logger } from "../lib/logger";

const router: IRouter = Router();
logMidtransMode();

/** Basis URL untuk redirect Snap: APP_BASE_URL bila diisi, jika tidak diturunkan dari request. */
function appBase(req: { protocol?: string; get?: (h: string) => string | undefined }): string {
  const fromEnv = process.env["APP_BASE_URL"]?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const host = req.get?.("x-forwarded-host") ?? req.get?.("host");
  if (!host) throw new Error("APP_BASE_URL belum diisi dan host request tidak tersedia.");
  const proto = (req.get?.("x-forwarded-proto") ?? req.protocol ?? "https").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

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
    const APP_BASE = appBase(req);

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
 * Employer membayar lowongan via Midtrans Snap.
 * Nominal = persis tagihan manual "gig_escrow" (upah pekerja + biaya posting),
 * sehingga hasilnya sama dengan konfirmasi admin atas transfer manual.
 * Body: { jobId: number | string }
 * Returns: { snapToken, orderId, redirectUrl, amount, wage, fee }
 */
router.post("/payments/midtrans/snap/posting", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(403).json({ error: "Login sebagai perusahaan diperlukan." });
    return;
  }

  // Frontend mengirim id lowongan sebagai angka; terima angka maupun string.
  const parsed = z.object({ jobId: z.coerce.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "jobId tidak valid." });
    return;
  }
  const gigId = parsed.data.jobId;

  try {
    const [gig] = await db.select().from(gigsTable).where(eq(gigsTable.id, gigId)).limit(1);
    if (!gig) {
      res.status(404).json({ error: "Lowongan tidak ditemukan." });
      return;
    }
    if (gig.employerId !== user.id) {
      res.status(403).json({ error: "Bukan lowongan Anda." });
      return;
    }
    if (gig.paymentStatus === "confirmed") {
      res.status(409).json({ error: "Lowongan sudah dibayar." });
      return;
    }

    const wage = gig.escrowAmount ?? 0;
    const fee = gig.adminFeeAmount ?? 0;
    const amount = wage + fee;
    if (!Number.isSafeInteger(amount) || wage <= 0 || fee < 0) {
      res.status(409).json({ error: "Nominal lowongan belum valid. Hubungi admin." });
      return;
    }

    // Tagihan manual adalah catatan resmi nominalnya; harus konsisten dengan lowongan.
    const [invoice] = await db
      .select()
      .from(manualPaymentsTable)
      .where(and(eq(manualPaymentsTable.targetType, "gig_escrow"), eq(manualPaymentsTable.targetId, String(gigId))))
      .limit(1);
    if (!invoice || invoice.payerId !== user.id || invoice.amount !== amount) {
      logger.error({ gigId, amount, invoice: invoice?.amount }, "[midtrans] Tagihan lowongan tidak konsisten");
      res.status(409).json({ error: "Tagihan lowongan tidak konsisten. Hubungi admin." });
      return;
    }
    if (invoice.status === "confirmed") {
      res.status(409).json({ error: "Lowongan sudah dibayar." });
      return;
    }

    const orderId = makeOrderId("POST", gigId);
    const APP_BASE = appBase(req);
    const items = [
      { id: `wage-${gigId}`, price: wage, quantity: 1, name: "Upah pekerja (dana escrow)" },
      ...(fee > 0 ? [{ id: `fee-${gigId}`, price: fee, quantity: 1, name: "Biaya layanan posting" }] : []),
    ];

    const snapResponse = await createSnapTransaction({
      transaction_details: { order_id: orderId, gross_amount: amount },
      item_details: items,
      customer_details: { first_name: user.name, email: user.email },
      callbacks: {
        finish: `${APP_BASE}/?payment=success&order=${orderId}&type=posting`,
        error: `${APP_BASE}/?payment=failed&order=${orderId}`,
        pending: `${APP_BASE}/?payment=pending&order=${orderId}`,
      },
      // Hanya informasi; aktivasi memakai order_id + database, bukan field ini.
      custom_field1: "posting",
      custom_field2: String(gigId),
    });

    logger.info({ orderId, gigId, amount }, "[midtrans] Snap posting created");
    res.json({
      snapToken: snapResponse.token,
      redirectUrl: snapResponse.redirect_url,
      orderId,
      amount,
      wage,
      fee,
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
// Format order dari rute ini: RKS-SUB-<id order langganan>-<ts> / RKS-POST-<id lowongan>-<ts>
const ORDER_ID_RE = /^RKS-(SUB|POST)-(.+)-(\d{10,})$/;

router.post("/payments/midtrans/notification", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    order_id?: string;
    status_code?: string;
    gross_amount?: string;
    signature_key?: string;
    transaction_status?: string;
    fraud_status?: string;
  };

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const match = ORDER_ID_RE.exec(orderId);
  if (!match) {
    // Bukan order buatan rute ini (mis. transaksi format lama). Tidak ada yang diproses;
    // balas 200 agar Midtrans tidak mengulang kiriman.
    logger.info({ orderId }, "[midtrans] Notifikasi untuk order di luar rute ini, diabaikan");
    res.json({ ok: true, ignored: true });
    return;
  }
  const kind = match[1] as "SUB" | "POST";
  const targetId = match[2] as string;

  // 1) Tentukan status transaksi yang bisa dipercaya.
  let transactionStatus = String(body.transaction_status ?? "");
  let fraudStatus = body.fraud_status;
  let paidAmount = String(body.gross_amount ?? "");

  const signatureOk =
    typeof body.signature_key === "string" &&
    verifyMidtransSignature({
      orderId,
      statusCode: String(body.status_code ?? ""),
      grossAmount: paidAmount,
      signatureKey: body.signature_key,
    });

  if (!signatureOk) {
    // Signature tidak cocok: jangan percaya isi notifikasi, tanya Midtrans langsung.
    const lookup = await getMidtransTransactionStatus(orderId);
    if (!lookup.ok) {
      if (lookup.reason === "unreachable") {
        logger.error({ orderId }, "[midtrans] Tidak bisa memverifikasi ke Midtrans, minta kirim ulang");
        res.status(503).json({ error: "Verifikasi sementara tidak tersedia." });
        return;
      }
      logger.warn({ orderId, reason: lookup.reason }, "[midtrans] Notifikasi ditolak: tidak terverifikasi");
      recordSecurityEvent(req, "webhook_bad_signature", "high", `Notifikasi Midtrans palsu/tak terverifikasi (order ${String(orderId).slice(0, 60)}, ${lookup.reason})`);
      res.status(401).json({ error: "Notifikasi tidak terverifikasi." });
      return;
    }
    logger.warn({ orderId }, "[midtrans] Signature tidak cocok; status diverifikasi langsung ke Midtrans");
    transactionStatus = lookup.data.transaction_status;
    fraudStatus = lookup.data.fraud_status;
    paidAmount = lookup.data.gross_amount;
  }

  const isSuccess =
    (transactionStatus === "capture" && fraudStatus === "accept") ||
    transactionStatus === "settlement";

  logger.info({ orderId, transactionStatus, fraudStatus, isSuccess, viaSignature: signatureOk }, "[midtrans] Notifikasi diterima");

  if (!isSuccess) {
    // pending / expire / cancel: cukup dicatat.
    res.json({ ok: true, status: transactionStatus });
    return;
  }

  // 2) Aktivasi. Semua data diambil dari database kita berdasarkan order_id yang
  //    sudah terverifikasi, bukan dari custom_field di isi notifikasi.
  try {
    if (kind === "SUB") {
      const orderResult = await db.execute(sql`
        SELECT so.id, so.company_id, so.amount, sp.duration_days
        FROM subscription_orders so
        JOIN subscription_plans sp ON sp.id = so.plan_id
        WHERE so.id = ${Number(targetId)} LIMIT 1
      `);
      const row = orderResult.rows[0];
      if (!row) {
        logger.error({ orderId }, "[midtrans] Order langganan tidak ditemukan di database");
        res.json({ ok: false, error: "order_not_found" });
        return;
      }
      if (Number(paidAmount) !== Number(row.amount)) {
        logger.error({ orderId, paidAmount, expected: row.amount }, "[midtrans] Nominal tidak sesuai, langganan tidak diaktifkan");
        res.json({ ok: false, error: "amount_mismatch" });
        return;
      }

      const companyId = String(row.company_id);
      const expiredAt = new Date();
      expiredAt.setDate(expiredAt.getDate() + Number(row.duration_days));

      // Atomik & idempoten: hanya satu notifikasi yang boleh "mengklaim" order ini.
      const activated = await db.transaction(async (tx) => {
        const claimed = await tx.execute(sql`
          UPDATE subscription_orders
          SET status = 'paid', paid_at = now()
          WHERE id = ${Number(targetId)} AND status IS DISTINCT FROM 'paid'
          RETURNING id
        `);
        if (!claimed.rows[0]) return false;
        await tx.execute(sql`
          UPDATE users
          SET expired_at = ${expiredAt.toISOString()}, is_premium = true
          WHERE id = ${companyId}
        `);
        return true;
      });

      if (activated) {
        await db.insert(notificationsTable).values({
          userId: companyId,
          message: `Pembayaran Rekhastha Bisnis berhasil! Langganan aktif hingga ${expiredAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.`,
          type: "subscription_paid",
        }).catch(() => {});
        void notifyByEmail(companyId, {
          kind: "payment",
          title: "Pembayaran Rekhastha Bisnis berhasil",
          detail: `Langganan Rekhastha Bisnis Anda aktif hingga ${expiredAt.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.`,
        });
        logger.info({ companyId, expiredAt }, "[midtrans] Langganan diaktifkan");
      } else {
        logger.info({ orderId }, "[midtrans] Order langganan sudah diproses sebelumnya");
      }

    } else {
      // Lowongan: efek yang sama dengan konfirmasi admin atas tagihan "gig_escrow".
      const gigId = Number(targetId);
      const outcome = await db.transaction(async (tx) => {
        const [gig] = await tx
          .select()
          .from(gigsTable)
          .where(eq(gigsTable.id, gigId))
          .for("update")
          .limit(1);
        if (!gig) return { kind: "not_found" as const };

        const expected = (gig.escrowAmount ?? 0) + (gig.adminFeeAmount ?? 0);
        if (Math.round(Number(paidAmount)) !== expected) {
          return { kind: "amount_mismatch" as const, expected };
        }
        // Sudah dikonfirmasi (oleh notifikasi sebelumnya atau oleh admin).
        if (gig.paymentStatus === "confirmed") return { kind: "duplicate" as const };
        if (gig.paymentStatus === "cancelled") {
          // Tautan Snap lama dibayar setelah lowongan dibatalkan/kedaluwarsa. Uang sudah masuk,
          // jadi lowongan tetap diaktifkan agar dana pemberi kerja tidak menggantung.
          logger.warn({ orderId, gigId }, "[midtrans] Pembayaran masuk untuk lowongan yang sudah dibatalkan; lowongan diaktifkan kembali");
        }

        const instant = gig.hiringMode === "cepat";
        const [funded] = await tx
          .update(gigsTable)
          .set({ paymentStatus: "confirmed", escrowStatus: "locked", broadcastActive: instant })
          .where(eq(gigsTable.id, gigId))
          .returning();

        if (instant) {
          await tx
            .update(instantOrdersTable)
            .set({ status: "active" })
            .where(and(eq(instantOrdersTable.jobId, gigId), eq(instantOrdersTable.status, "pending")));
        }

        // Tutup tagihan manual agar tidak bisa dikonfirmasi admin untuk kedua kalinya.
        await tx
          .update(manualPaymentsTable)
          .set({
            status: "confirmed",
            transferReference: orderId,
            proofNote: "Dibayar via Midtrans Snap",
            adminNote: "Dikonfirmasi otomatis oleh Midtrans.",
            reviewedBy: "midtrans",
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(manualPaymentsTable.targetType, "gig_escrow"),
              eq(manualPaymentsTable.targetId, String(gigId)),
            ),
          );

        return { kind: "activated" as const, gig: funded!, instant };
      });

      if (outcome.kind === "not_found") {
        logger.error({ orderId }, "[midtrans] Lowongan tidak ditemukan di database");
        res.json({ ok: false, error: "job_not_found" });
        return;
      }
      if (outcome.kind === "amount_mismatch") {
        logger.error({ orderId, paidAmount, expected: outcome.expected }, "[midtrans] Nominal tidak sesuai, lowongan tidak diaktifkan");
        res.json({ ok: false, error: "amount_mismatch" });
        return;
      }
      if (outcome.kind === "duplicate") {
        // Bisa notifikasi ulang (normal) atau lowongan sudah dikonfirmasi admin sebelum
        // pembayaran Midtrans masuk (perlu rekonsiliasi/refund manual).
        logger.warn({ orderId, gigId }, "[midtrans] Lowongan sudah berstatus confirmed; periksa kemungkinan pembayaran ganda");
      } else {
        if (outcome.instant) broadcastInstantActivated(outcome.gig);
        else broadcastGig(outcome.gig);
        await db.insert(notificationsTable).values({
          userId: String(outcome.gig.employerId),
          message: `Pembayaran lowongan "${outcome.gig.posisi}" berhasil! Lowongan Anda sudah tayang.`,
          type: "posting_paid",
        }).catch(() => {});
        if (outcome.gig.employerId) {
          void notifyByEmail(String(outcome.gig.employerId), {
            kind: "payment",
            title: `Pembayaran lowongan berhasil — ${outcome.gig.posisi}`,
            detail: `Pembayaran lowongan "${outcome.gig.posisi}" sudah kami terima dan lowongan Anda sudah tayang. Invoice bisa diunduh dari profil Anda.`,
          });
        }
        logger.info({ gigId, orderId }, "[midtrans] Lowongan diaktifkan");
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, orderId }, "[midtrans] Gagal proses notifikasi");
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

  // Order posting lowongan: RKS-POST-<id lowongan>-<ts>
  const post = ORDER_ID_RE.exec(orderId ?? "");
  if (post && post[1] === "POST") {
    const [gig] = await db
      .select({ paymentStatus: gigsTable.paymentStatus, employerId: gigsTable.employerId, posisi: gigsTable.posisi })
      .from(gigsTable)
      .where(eq(gigsTable.id, Number(post[2])))
      .limit(1);
    if (gig && gig.employerId === user.id) {
      res.json({ type: "posting", order: { status: gig.paymentStatus === "confirmed" ? "paid" : "pending", label: gig.posisi } });
      return;
    }
  }

  res.status(404).json({ error: "Order tidak ditemukan." });
});

export default router;
