import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { refundUnusedEscrows } from "../lib/escrow-refunds";
import { sendShiftReminders } from "../lib/shift-reminders";

const router: IRouter = Router();

/** Vercel Cron mengirim `Authorization: Bearer <CRON_SECRET>` bila variabel itu diisi. */
function authorized(header: string | undefined): boolean {
  const secret = process.env["CRON_SECRET"]?.trim();
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(header);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

router.get("/cron/refund-expired", async (req, res): Promise<void> => {
  if (!process.env["CRON_SECRET"]?.trim()) {
    res.status(503).json({ error: "CRON_SECRET belum diisi." });
    return;
  }
  if (!authorized(req.get("authorization"))) {
    res.status(401).json({ error: "Tidak diizinkan." });
    return;
  }
  const result = await refundUnusedEscrows();
  res.json({ ok: true, ...result });
});

router.get("/cron/shift-reminders", async (req, res): Promise<void> => {
  if (!process.env["CRON_SECRET"]?.trim()) {
    res.status(503).json({ error: "CRON_SECRET belum diisi." });
    return;
  }
  if (!authorized(req.get("authorization"))) {
    res.status(401).json({ error: "Tidak diizinkan." });
    return;
  }
  const sent = await sendShiftReminders();
  res.json({ ok: true, sent });
});

export default router;
