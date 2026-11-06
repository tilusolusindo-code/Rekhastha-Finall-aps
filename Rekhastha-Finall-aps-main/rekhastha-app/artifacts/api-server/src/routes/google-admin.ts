/**
 * Admin-only Google Cloud integration endpoints.
 *
 * GET  /api/admin/backups          – list DB backups in GCS
 * POST /api/admin/export/pdf       – trigger Cloud Run PDF export
 * POST /api/admin/reconcile        – trigger payment reconciliation
 */

import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { ADMIN_COOKIE, adminSessionId } from "../lib/admin";
import { listBackups } from "../lib/gcs-backup";
import { triggerPdfExport, triggerReconciliation } from "../lib/cloud-run-client";

const router: IRouter = Router();

async function requireAdmin(req: Parameters<typeof Router>[0] extends never ? never : Parameters<import("express").RequestHandler>[0], res: Parameters<import("express").RequestHandler>[1]): Promise<string | null> {
  const adminId = await adminSessionId((req as import("express").Request).cookies?.[ADMIN_COOKIE]);
  if (!adminId) {
    (res as import("express").Response).status(401).json({ error: "Sesi admin tidak valid." });
    return null;
  }
  return adminId;
}

// GET /api/admin/backups
router.get("/admin/backups", async (req, res): Promise<void> => {
  if (!(await adminSessionId(req.cookies?.[ADMIN_COOKIE]))) {
    res.status(401).json({ error: "Sesi admin tidak valid." });
    return;
  }
  try {
    const backups = await listBackups(30);
    res.json({ backups });
  } catch (err) {
    req.log?.error({ err }, "Failed to list backups");
    res.status(503).json({ error: "Tidak dapat mengambil daftar backup." });
  }
});

// POST /api/admin/export/pdf
const pdfBody = z.object({
  type: z.enum(["payroll", "attendance", "gig_summary"]),
  jobId: z.number().int().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

router.post("/admin/export/pdf", async (req, res): Promise<void> => {
  const adminId = await adminSessionId(req.cookies?.[ADMIN_COOKIE]);
  if (!adminId) { res.status(401).json({ error: "Sesi admin tidak valid." }); return; }
  const parsed = pdfBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Parameter export tidak valid." }); return; }
  const result = await triggerPdfExport({ ...parsed.data, requestedBy: adminId });
  if (!result.ok) {
    res.status(503).json({ error: result.error ?? "Export gagal." });
    return;
  }
  res.json(result.data);
});

// POST /api/admin/reconcile
const reconcileBody = z.object({
  provider: z.enum(["midtrans", "xendit"]),
  dateFrom: z.string(),
  dateTo: z.string(),
});

router.post("/admin/reconcile", async (req, res): Promise<void> => {
  const adminId = await adminSessionId(req.cookies?.[ADMIN_COOKIE]);
  if (!adminId) { res.status(401).json({ error: "Sesi admin tidak valid." }); return; }
  const parsed = reconcileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Parameter rekonsiliasi tidak valid." }); return; }
  const result = await triggerReconciliation(parsed.data);
  if (!result.ok) {
    res.status(503).json({ error: result.error ?? "Rekonsiliasi gagal." });
    return;
  }
  res.json(result.data);
});

export default router;
