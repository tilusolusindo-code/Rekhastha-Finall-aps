import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { applicationsTable, attendanceTable, db, gigsTable, usersTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { teamCan, type TeamPermission } from "../lib/team-access";
import { getWorkerStats } from "../lib/worker-stats";
import { getApplicationAttachments } from "./applications";

/**
 * Data perusahaan untuk anggota tim, dibatasi per peran (lihat lib/team-access.ts).
 * Anggota hanya melihat data perusahaan tempat mereka bergabung, hanya selama paket
 * Rekhastha Bisnis perusahaan aktif, dan tanpa data sensitif (rekening, NIK, NPWP,
 * nominal upah, atau dokumen identitas).
 */
const router: IRouter = Router();

async function authorize(
  req: Request,
  res: Response,
  permission: TeamPermission,
): Promise<{ userId: string; companyId: string } | null> {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Login diperlukan." });
    return null;
  }
  const companyId = String(req.params["companyId"] ?? "");
  if (!(await teamCan(user.id, companyId, permission))) {
    // 404 (bukan 403) agar keberadaan perusahaan/tim tidak bocor ke orang luar.
    res.status(404).json({ error: "Tidak ditemukan." });
    return null;
  }
  res.setHeader("Cache-Control", "no-store");
  return { userId: user.id, companyId };
}

/** GET /api/team/company/:companyId/gigs — lowongan aktif beserta pekerja yang diterima. */
router.get("/team/company/:companyId/gigs", async (req, res): Promise<void> => {
  const ctx = await authorize(req, res, "gigs.view");
  if (!ctx) return;
  const gigs = await db
    .select({
      id: gigsTable.id,
      posisi: gigsTable.posisi,
      jobDate: gigsTable.jobDate,
      jamKerja: gigsTable.jamKerja,
      alamat: gigsTable.alamat,
      kuota: gigsTable.kuota,
      jumlahHari: gigsTable.jumlahHari,
    })
    .from(gigsTable)
    .where(and(eq(gigsTable.employerId, ctx.companyId), eq(gigsTable.paymentStatus, "confirmed")))
    .orderBy(desc(gigsTable.postedAt))
    .limit(100);

  const ids = gigs.map((g) => g.id);
  const accepted = ids.length
    ? await db
        .select({
          applicationId: applicationsTable.id,
          jobId: applicationsTable.jobId,
          workerName: applicationsTable.workerName,
          status: applicationsTable.status,
        })
        .from(applicationsTable)
        .where(and(inArray(applicationsTable.jobId, ids), inArray(applicationsTable.status, ["diterima", "selesai"])))
    : [];
  res.json({
    gigs: gigs.map((g) => ({
      ...g,
      workers: accepted.filter((a) => a.jobId === g.id).map(({ applicationId, workerName, status }) => ({ applicationId, workerName, status })),
    })),
  });
});

/** Data diri yang aman dilihat HR: usia, jenis kelamin, tempat lahir, status verifikasi. Tanpa NIK/NPWP/rekening/WhatsApp. */
function safeDataDiri(profile: unknown, verificationStatus: string | null) {
  const p = (profile && typeof profile === "object" ? profile : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
  let usia: number | null = null;
  const dob = str(p["tanggalLahir"]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age -= 1;
    if (age >= 0 && age < 120) usia = age;
  }
  const g = str(p["jenisKelamin"]);
  return {
    usia,
    jenisKelamin: g === "L" || g === "P" ? g : null,
    tempatLahir: str(p["tempatLahir"]) || null,
    terverifikasi: verificationStatus === "verified" || verificationStatus === "approved",
  };
}

/** GET /api/team/company/:companyId/applications?jobId= — lamaran (tanpa data keuangan/identitas). */
router.get("/team/company/:companyId/applications", async (req, res): Promise<void> => {
  const ctx = await authorize(req, res, "applications.view");
  if (!ctx) return;
  const jobId = req.query["jobId"] ? Number(req.query["jobId"]) : null;
  const where =
    jobId && Number.isSafeInteger(jobId)
      ? and(eq(applicationsTable.employerId, ctx.companyId), eq(applicationsTable.jobId, jobId))
      : eq(applicationsTable.employerId, ctx.companyId);

  const rows = await db
    .select({
      application: applicationsTable,
      workerAvatarUrl: usersTable.avatarUrl,
      workerSkills: usersTable.skills,
      accountName: usersTable.name,
      workerProfile: usersTable.profile,
      verificationStatus: usersTable.verificationStatus,
    })
    .from(applicationsTable)
    .leftJoin(usersTable, eq(applicationsTable.workerId, usersTable.id))
    .where(where)
    .orderBy(desc(applicationsTable.createdAt))
    .limit(300);
  const attachments = await getApplicationAttachments(rows.map((r) => r.application.id));
  const stats = await getWorkerStats(rows.map((r) => r.application.workerId));

  res.json(
    rows.map(({ application: a, workerAvatarUrl, workerSkills, accountName, workerProfile, verificationStatus }) => ({
      id: a.id,
      jobId: a.jobId,
      jobTitle: a.jobTitle,
      workerName: accountName ?? a.workerName,
      dataDiri: safeDataDiri(workerProfile, verificationStatus),
      status: a.status,
      createdAt: a.createdAt,
      shortlistedAt: a.shortlistedAt,
      clientDecision: a.clientDecision,
      clientNote: a.clientNote,
      cvLink: a.cvLink,
      portfolioLink: a.portfolioLink,
      applicationQuestions: a.applicationQuestions,
      applicationAnswers: a.applicationAnswers,
      supportingInfo: a.supportingInfo,
      uploadedFiles: attachments.get(a.id) ?? [],
      workerAvatarUrl: workerAvatarUrl ?? null,
      workerSkills: workerSkills ?? [],
      workerStats: stats.get(a.workerId) ?? { ratingAvg: null, ratingCount: 0, completedJobs: 0 },
      // Sengaja tidak disertakan: bank, rekening, NIK, NPWP, workerId, employerId.
    })),
  );
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/team/company/:companyId/attendance?date=YYYY-MM-DD&jobId= — rekap presensi satu hari (WIB). */
router.get("/team/company/:companyId/attendance", async (req, res): Promise<void> => {
  const ctx = await authorize(req, res, "attendance.view");
  if (!ctx) return;
  const dateParam = typeof req.query["date"] === "string" ? req.query["date"] : "";
  const date = DATE_RE.test(dateParam)
    ? dateParam
    : new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10); // hari ini menurut WIB
  const jobId = req.query["jobId"] ? Number(req.query["jobId"]) : null;

  const rows = await db
    .select({
      id: attendanceTable.id,
      jobId: attendanceTable.jobId,
      jobTitle: gigsTable.posisi,
      workerName: attendanceTable.workerName,
      kind: attendanceTable.kind,
      at: attendanceTable.at,
    })
    .from(attendanceTable)
    .innerJoin(gigsTable, eq(gigsTable.id, attendanceTable.jobId))
    .where(
      and(
        eq(gigsTable.employerId, ctx.companyId),
        eq(attendanceTable.scanDate, date),
        jobId && Number.isSafeInteger(jobId) ? eq(attendanceTable.jobId, jobId) : sql`true`,
      ),
    )
    .orderBy(desc(attendanceTable.at))
    .limit(500);
  res.json({ date, records: rows });
});

export default router;
