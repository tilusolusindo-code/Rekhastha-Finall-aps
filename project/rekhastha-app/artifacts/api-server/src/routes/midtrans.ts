import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, midtransPaymentsTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  createSnapTransaction,
  verifyMidtransSignature,
  parseMidtransDate,
  logMidtransMode,
  isMidtransProduction,
} from "../lib/midtrans";

logMidtransMode();

const router: IRouter = Router();

// ── Schema validasi ────────────────────────────────────────────────────────

const createPaymentBody = z.object({
  orderId: z.string().min(1),         // merchant-generated, e.g. "RKS-{jobId}-{ts}"
  jobId: z.string().optional(),
  jobType: z.enum(["gig", "escrow", "subscription", "instant"]),
  grossAmount: z.number().int().positive(),
  customerDetails: z.object({
    firstName: z.string(),
    lastName: z.string().optional(),
    email: z.string().email(),
    phone: z.string().optional(),
  }),
  itemDetails: z
    .array(
      z.object({
        id: z.string(),
        price: z.number().int().positive(),
        quantity: z.number().int().positive(),
        name: z.string(),
      }),
    )
    .optional(),
});

const callbackBody = z.object({
  order_id: z.string(),
  status_code: z.string(),
  gross_amount: z.string(),
  signature_key: z.string(),
  transaction_id: z.string().optional(),
  transaction_status: z.string().optional(),
  payment_type: z.string().optional(),
  fraud_status: z.string().optional(),
  transaction_time: z.string().optional(),
  settlement_time: z.string().optional(),
}).passthrough();

// ── POST /payments/midtrans/create ─────────────────────────────────────────
// Buat Snap transaction dan simpan ke DB.
// Kembalikan { snapToken, redirectUrl } ke frontend.
router.post("/payments/midtrans/create", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }

  const parsed = createPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { orderId, jobId, jobType, grossAmount, customerDetails, itemDetails } =
    parsed.data;

  // Cek duplikat order id
  const existing = await db
    .select({ id: midtransPaymentsTable.id, status: midtransPaymentsTable.status })
    .from(midtransPaymentsTable)
    .where(eq(midtransPaymentsTable.orderId, orderId))
    .limit(1);

  if (existing.length > 0) {
    res
      .status(409)
      .json({ error: "Order ID sudah ada. Gunakan order ID yang unik." });
    return;
  }

  // Buat Snap transaction
  const snapParam: Record<string, unknown> = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: {
      first_name: customerDetails.firstName,
      last_name: customerDetails.lastName ?? "",
      email: customerDetails.email,
      phone: customerDetails.phone ?? "",
    },
    ...(itemDetails && { item_details: itemDetails }),
    callbacks: {
      finish: `${process.env["APP_BASE_URL"] ?? ""}/payment/finish`,
      error: `${process.env["APP_BASE_URL"] ?? ""}/payment/error`,
      pending: `${process.env["APP_BASE_URL"] ?? ""}/payment/pending`,
    },
  };

  let snapToken: string | undefined;
  let redirectUrl: string | undefined;

  try {
    const result = await createSnapTransaction(snapParam);
    snapToken = result.token;
    redirectUrl = result.redirect_url;
  } catch (err) {
    req.log.error({ err, orderId }, "Gagal membuat Snap transaction");
    res.status(502).json({ error: "Gagal menghubungi Midtrans. Coba beberapa saat lagi." });
    return;
  }

  // Simpan ke DB
  await db.insert(midtransPaymentsTable).values({
    orderId,
    jobId: jobId ?? null,
    jobType,
    grossAmount,
    status: "pending",
    customerDetails: customerDetails as Record<string, unknown>,
    snapToken: snapToken ?? null,
    redirectUrl: redirectUrl ?? null,
  });

  req.log.info(
    { orderId, jobType, grossAmount, isProduction: isMidtransProduction() },
    "Midtrans Snap transaction created",
  );

  res.status(201).json({ snapToken, redirectUrl, orderId });
});

// ── POST /payments/midtrans-callback ──────────────────────────────────────
// Menerima HTTP notification dari Midtrans.
// Verifikasi signature_key sebelum update status.
router.post("/payments/midtrans-callback", async (req, res): Promise<void> => {
  const parsed = callbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Payload callback tidak valid." });
    return;
  }

  const data = parsed.data;

  // Verifikasi signature (SHA512: orderId + statusCode + grossAmount + serverKey)
  const isValid = verifyMidtransSignature({
    orderId: data.order_id,
    statusCode: data.status_code,
    grossAmount: data.gross_amount,
    signatureKey: data.signature_key,
  });

  if (!isValid) {
    req.log.warn({ orderId: data.order_id }, "Midtrans callback signature INVALID");
    res.status(403).json({ error: "Signature tidak valid." });
    return;
  }

  // Map transaction_status → status internal
  const txStatus = data.transaction_status ?? "";
  let internalStatus: string;
  if (txStatus === "settlement" || txStatus === "capture") {
    internalStatus =
      data.fraud_status === "accept" || !data.fraud_status ? "paid" : "fraud";
  } else if (txStatus === "pending") {
    internalStatus = "pending";
  } else if (txStatus === "deny" || txStatus === "cancel" || txStatus === "expire") {
    internalStatus = txStatus; // simpan apa adanya
  } else {
    internalStatus = txStatus;
  }

  await db
    .update(midtransPaymentsTable)
    .set({
      status: internalStatus,
      transactionId: data.transaction_id ?? null,
      transactionStatus: data.transaction_status ?? null,
      paymentType: data.payment_type ?? null,
      fraudStatus: data.fraud_status ?? null,
      transactionTime: parseMidtransDate(data.transaction_time),
      settlementTime: parseMidtransDate(data.settlement_time),
      rawNotification: data as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(midtransPaymentsTable.orderId, data.order_id));

  req.log.info(
    { orderId: data.order_id, status: internalStatus, paymentType: data.payment_type },
    "Midtrans callback processed",
  );

  // Midtrans mengharapkan HTTP 200 OK
  res.status(200).json({ received: true });
});

// ── GET /payments/midtrans/status/:orderId ────────────────────────────────
// Frontend polling status transaksi.
router.get("/payments/midtrans/status/:orderId", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }

  const { orderId } = req.params;
  const [payment] = await db
    .select({
      orderId: midtransPaymentsTable.orderId,
      status: midtransPaymentsTable.status,
      grossAmount: midtransPaymentsTable.grossAmount,
      paymentType: midtransPaymentsTable.paymentType,
      transactionStatus: midtransPaymentsTable.transactionStatus,
      createdAt: midtransPaymentsTable.createdAt,
      updatedAt: midtransPaymentsTable.updatedAt,
    })
    .from(midtransPaymentsTable)
    .where(eq(midtransPaymentsTable.orderId, orderId ?? ""))
    .limit(1);

  if (!payment) {
    res.status(404).json({ error: "Order tidak ditemukan." });
    return;
  }

  res.json(payment);
});

export default router;
