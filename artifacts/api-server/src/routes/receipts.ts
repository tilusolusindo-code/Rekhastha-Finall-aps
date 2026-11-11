import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { applicationsTable, db, gigsTable, midtransPaymentsTable, usersTable, walletEntriesTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { escapeHtml as esc } from "../lib/mailer";

const router: IRouter = Router();

const rupiah = (n: number): string =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const tanggal = (d: Date): string =>
  d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB";

function page(res: Response, title: string, rows: Array<[string, string]>, lines: Array<[string, number]>, total: [string, number], footer: string): void {
  const meta = rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  const items = lines.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${rupiah(v)}</td></tr>`).join("");
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font-family:system-ui,sans-serif;color:#111827;max-width:640px;margin:24px auto;padding:0 16px}
h1{color:#059669;margin:0}.sub{color:#6b7280;margin:4px 0 20px}
table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:8px 0;border-bottom:1px solid #e5e7eb;vertical-align:top}
.k{color:#6b7280;width:38%}.r{text-align:right}.total td{font-weight:800;font-size:1.1em;border-bottom:2px solid #059669}
.note{color:#6b7280;font-size:12px;margin-top:20px}
button{margin-top:16px;padding:10px 18px;background:#059669;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer}
@media print{button{display:none}}
</style></head><body>
<h1>Rekhastha</h1><p class="sub">${esc(title)}</p>
<table>${meta}</table>
<table>${items}<tr class="total"><td>${esc(total[0])}</td><td class="r">${rupiah(total[1])}</td></tr></table>
<p class="note">${esc(footer)}</p>
<button onclick="window.print()">Cetak / Simpan PDF</button>
</body></html>`);
}

/** Invoice pembayaran lowongan untuk pemberi kerja pemilik lowongan. */
router.get("/receipts/invoice/:gigId", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "perusahaan") {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const gigId = Number(req.params["gigId"]);
  if (!Number.isSafeInteger(gigId) || gigId < 1) {
    res.status(400).json({ error: "ID lowongan tidak valid." });
    return;
  }
  const [gig] = await db.select().from(gigsTable).where(eq(gigsTable.id, gigId)).limit(1);
  if (!gig || gig.employerId !== user.id || gig.paymentStatus !== "confirmed") {
    res.status(404).json({ error: "Invoice tidak ditemukan." });
    return;
  }
  const [payment] = await db
    .select()
    .from(midtransPaymentsTable)
    .where(and(eq(midtransPaymentsTable.jobId, String(gigId)), isNotNull(midtransPaymentsTable.settlementTime)))
    .orderBy(desc(midtransPaymentsTable.settlementTime))
    .limit(1);

  const wage = gig.totalWorkerPayout ?? gig.escrowAmount ?? 0;
  const fee = gig.adminFeeAmount ?? 0;
  const profile = (user.profile ?? {}) as Record<string, unknown>;
  const buyer = gig.namaPerusahaan || (typeof profile["namaPerusahaan"] === "string" ? profile["namaPerusahaan"] : "") || user.name;
  page(
    res,
    `Invoice INV-${gig.id}`,
    [
      ["Pemberi kerja", buyer],
      ["Lowongan", gig.posisi],
      ["Rincian", `${gig.kuota} pekerja × ${gig.jumlahHari ?? 1} hari × ${rupiah(gig.nominal)} (${gig.pembayaran})`],
      ["Tanggal pembayaran", tanggal(payment?.settlementTime ?? gig.postedAt)],
      ["Metode / referensi", payment ? `${payment.paymentType ?? "Midtrans"} · ${payment.orderId}` : "Konfirmasi manual admin"],
    ],
    [
      ["Dana upah pekerja (ditahan escrow)", wage],
      ["Biaya layanan Rekhastha", fee],
    ],
    ["Total", wage + fee],
    "Dokumen ini dibuat otomatis oleh Rekhastha sebagai bukti pembayaran lowongan. Dana upah dilepas ke pekerja setelah pekerjaan selesai.",
  );
});

/** Slip upah untuk pekerja pemilik entri dompet. */
router.get("/receipts/slip/:entryId", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user || user.role !== "pekerja") {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const entryId = Number(req.params["entryId"]);
  if (!Number.isSafeInteger(entryId) || entryId < 1) {
    res.status(400).json({ error: "ID slip tidak valid." });
    return;
  }
  const [entry] = await db
    .select()
    .from(walletEntriesTable)
    .where(and(eq(walletEntriesTable.id, entryId), eq(walletEntriesTable.workerId, user.id)))
    .limit(1);
  if (!entry) {
    res.status(404).json({ error: "Slip tidak ditemukan." });
    return;
  }
  let jobTitle = entry.description;
  let employer = "—";
  if (entry.sourceType === "gig_wage") {
    const [app] = await db
      .select({ jobTitle: applicationsTable.jobTitle, employerId: applicationsTable.employerId })
      .from(applicationsTable)
      .where(eq(applicationsTable.id, Number(entry.sourceId)))
      .limit(1);
    if (app) {
      jobTitle = app.jobTitle || jobTitle;
      const [boss] = await db.select({ name: usersTable.name, profile: usersTable.profile }).from(usersTable).where(eq(usersTable.id, app.employerId)).limit(1);
      const p = (boss?.profile ?? {}) as Record<string, unknown>;
      employer = (typeof p["namaPerusahaan"] === "string" && p["namaPerusahaan"]) || boss?.name || "—";
    }
  }
  page(
    res,
    `Slip Upah SLP-${entry.id}`,
    [
      ["Penerima", user.name],
      ["Pekerjaan", jobTitle],
      ["Pemberi kerja", employer],
      ["Tanggal masuk dompet", tanggal(entry.createdAt)],
    ],
    [["Upah diterima", entry.amount]],
    ["Total", entry.amount],
    "Slip ini bukti upah yang masuk ke dompet Rekhastha Anda. Pencairan ke rekening mengikuti proses penarikan terpisah.",
  );
});

export default router;
