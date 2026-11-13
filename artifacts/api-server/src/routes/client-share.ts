import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  applicationsTable, applicationUploadsTable, clientShareLinksTable, db, gigsTable, notificationsTable, usersTable,
} from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { teamCan } from "../lib/team-access";
import { getWorkerStats } from "../lib/worker-stats";
import { logger } from "../lib/logger";

/**
 * Shortlist untuk klien agensi.
 *
 * HR/pemilik menandai pelamar layak ("shortlist") lalu membagikan satu tautan per lowongan.
 * Klien (tanpa akun) hanya bisa MENILAI (setuju/tidak + catatan); keputusan akhir tetap di agensi.
 * Data yang tampil ke klien sengaja minim: nama depan + inisial, foto profil, keahlian, statistik,
 * jawaban teks. Tidak ada kontak, rekening, NIK/NPWP, CV, atau berkas unggahan.
 */
const router: IRouter = Router();

const MAX_ACTIVE_LINKS_PER_JOB = 5;
const SHARE_STATUSES = ["baru", "ditinjau", "diterima"];
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function managedUser(req: Request, res: Response) {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) { res.status(401).json({ error: "Login diperlukan." }); return null; }
  return user;
}

/** Pemilik perusahaan atau anggota tim HR (applications.decide) boleh mengelola shortlist. */
async function canManage(userId: string, role: string, companyId: string): Promise<boolean> {
  if (!companyId) return false;
  if (userId === companyId) return role === "perusahaan";
  return teamCan(userId, companyId, "applications.decide");
}

/** "Budi Santoso" -> "Budi S." */
export function clientDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Pelamar";
  const first = parts[0]!.slice(0, 20);
  const initial = parts[1]?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** POST /api/applications/:id/shortlist — { shortlisted: boolean } */
router.post("/applications/:id/shortlist", async (req, res): Promise<void> => {
  const user = await managedUser(req, res);
  if (!user) return;
  const id = Number(req.params["id"]);
  const parsed = z.object({ shortlisted: z.boolean() }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
    res.status(400).json({ error: "Permintaan tidak valid." });
    return;
  }
  const [app] = await db.select().from(applicationsTable).where(eq(applicationsTable.id, id)).limit(1);
  if (!app || !(await canManage(user.id, user.role, app.employerId))) {
    res.status(404).json({ error: "Lamaran tidak ditemukan." });
    return;
  }
  if (!SHARE_STATUSES.includes(app.status)) {
    res.status(409).json({ error: "Hanya pelamar yang masih diproses yang bisa dimasukkan ke shortlist." });
    return;
  }
  await db
    .update(applicationsTable)
    .set(
      parsed.data.shortlisted
        ? { shortlistedAt: app.shortlistedAt ?? new Date() }
        : { shortlistedAt: null, clientDecision: null, clientNote: null, clientDecidedAt: null },
    )
    .where(eq(applicationsTable.id, id));
  res.json({ ok: true, shortlisted: parsed.data.shortlisted });
});

/** POST /api/client-links — { jobId, label?, days? } → tautan sekali tampil. */
router.post("/client-links", async (req, res): Promise<void> => {
  const user = await managedUser(req, res);
  if (!user) return;
  const parsed = z.object({
    jobId: z.coerce.number().int().positive(),
    label: z.string().trim().max(60).optional(),
    days: z.coerce.number().int().min(1).max(14).default(7),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Permintaan tidak valid." }); return; }

  const [gig] = await db.select({ employerId: gigsTable.employerId }).from(gigsTable).where(eq(gigsTable.id, parsed.data.jobId)).limit(1);
  if (!gig?.employerId || !(await canManage(user.id, user.role, gig.employerId))) {
    res.status(404).json({ error: "Lowongan tidak ditemukan." });
    return;
  }
  const active = await db
    .select({ id: clientShareLinksTable.id })
    .from(clientShareLinksTable)
    .where(and(
      eq(clientShareLinksTable.jobId, parsed.data.jobId),
      eq(clientShareLinksTable.companyId, gig.employerId),
      isNull(clientShareLinksTable.revokedAt),
      gt(clientShareLinksTable.expiresAt, new Date()),
    ));
  if (active.length >= MAX_ACTIVE_LINKS_PER_JOB) {
    res.status(409).json({ error: `Maksimal ${MAX_ACTIVE_LINKS_PER_JOB} tautan aktif per lowongan. Cabut salah satu dulu.` });
    return;
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + parsed.data.days * 86_400_000);
  const [row] = await db
    .insert(clientShareLinksTable)
    .values({
      companyId: gig.employerId,
      jobId: parsed.data.jobId,
      tokenHash: hashToken(token),
      label: parsed.data.label ?? "",
      expiresAt,
    })
    .returning({ id: clientShareLinksTable.id });
  const baseUrl = process.env["APP_BASE_URL"] ?? "https://rekhastha.my.id";
  res.status(201).json({ id: row!.id, url: `${baseUrl}/?klien=${token}`, expiresAt });
});

/** GET /api/client-links?jobId= — tautan aktif (tanpa token; token hanya tampil saat dibuat). */
router.get("/client-links", async (req, res): Promise<void> => {
  const user = await managedUser(req, res);
  if (!user) return;
  const jobId = Number(req.query["jobId"]);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) { res.status(400).json({ error: "jobId tidak valid." }); return; }
  const [gig] = await db.select({ employerId: gigsTable.employerId }).from(gigsTable).where(eq(gigsTable.id, jobId)).limit(1);
  if (!gig?.employerId || !(await canManage(user.id, user.role, gig.employerId))) {
    res.status(404).json({ error: "Lowongan tidak ditemukan." });
    return;
  }
  const rows = await db
    .select({
      id: clientShareLinksTable.id, label: clientShareLinksTable.label,
      expiresAt: clientShareLinksTable.expiresAt, createdAt: clientShareLinksTable.createdAt,
    })
    .from(clientShareLinksTable)
    .where(and(
      eq(clientShareLinksTable.jobId, jobId),
      eq(clientShareLinksTable.companyId, gig.employerId),
      isNull(clientShareLinksTable.revokedAt),
      gt(clientShareLinksTable.expiresAt, new Date()),
    ))
    .orderBy(desc(clientShareLinksTable.createdAt));
  res.setHeader("Cache-Control", "no-store");
  res.json({ links: rows });
});

/** DELETE /api/client-links/:id — cabut tautan. */
router.delete("/client-links/:id", async (req, res): Promise<void> => {
  const user = await managedUser(req, res);
  if (!user) return;
  const id = Number(req.params["id"]);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "ID tidak valid." }); return; }
  const [link] = await db.select().from(clientShareLinksTable).where(eq(clientShareLinksTable.id, id)).limit(1);
  if (!link || !(await canManage(user.id, user.role, link.companyId))) {
    res.status(404).json({ error: "Tautan tidak ditemukan." });
    return;
  }
  await db.update(clientShareLinksTable).set({ revokedAt: new Date() }).where(eq(clientShareLinksTable.id, id));
  res.json({ ok: true });
});

/* ───────────────────────────── Tampilan klien (tanpa login) ───────────────────────────── */

function noIndex(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

async function resolveLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const [link] = await db
    .select()
    .from(clientShareLinksTable)
    .where(and(
      eq(clientShareLinksTable.tokenHash, hashToken(token)),
      isNull(clientShareLinksTable.revokedAt),
      gt(clientShareLinksTable.expiresAt, new Date()),
    ))
    .limit(1);
  return link ?? null;
}

async function shortlistedFor(link: { companyId: string; jobId: number }) {
  return db
    .select({
      application: applicationsTable,
      avatarUrl: usersTable.avatarUrl,
      skills: usersTable.skills,
      // Nama dari akun, bukan dari kolom lamaran (yang dikirim browser pelamar dan bisa dipalsukan).
      accountName: usersTable.name,
    })
    .from(applicationsTable)
    .leftJoin(usersTable, eq(applicationsTable.workerId, usersTable.id))
    .where(and(
      eq(applicationsTable.jobId, link.jobId),
      eq(applicationsTable.employerId, link.companyId),
      isNotNull(applicationsTable.shortlistedAt),
      inArray(applicationsTable.status, SHARE_STATUSES),
    ))
    .orderBy(desc(applicationsTable.shortlistedAt))
    .limit(100);
}

/** GET /api/public/client-view/:token */
router.get("/public/client-view/:token", async (req, res): Promise<void> => {
  noIndex(res);
  const link = await resolveLink(String(req.params["token"] ?? ""));
  if (!link) { res.status(404).json({ error: "Tautan tidak valid atau sudah kedaluwarsa." }); return; }
  try {
    const [gig] = await db.select({ posisi: gigsTable.posisi }).from(gigsTable).where(eq(gigsTable.id, link.jobId)).limit(1);
    const [company] = await db.select({ name: usersTable.name, profile: usersTable.profile }).from(usersTable).where(eq(usersTable.id, link.companyId)).limit(1);
    const companyName = ((company?.profile ?? {}) as Record<string, unknown>)["namaPerusahaan"];
    const rows = await shortlistedFor(link);
    const stats = await getWorkerStats(rows.map((r) => r.application.workerId));
    const uploadRows = rows.length
      ? await db
          .select({ applicationId: applicationUploadsTable.applicationId, questionId: applicationUploadsTable.questionId })
          .from(applicationUploadsTable)
          .where(and(inArray(applicationUploadsTable.applicationId, rows.map((r) => r.application.id)), eq(applicationUploadsTable.uploaded, true)))
      : [];
    const attached = new Set(uploadRows.map((u) => `${u.applicationId}:${u.questionId}`));
    // Daftar pertanyaan diambil dari lamaran pertama yang punya pertanyaan (semua pelamar lowongan sama melihat yang sama).
    const questionSource = rows.map((r) => r.application.applicationQuestions ?? []).find((q) => q.length > 0) ?? [];
    res.json({
      questions: questionSource.map((q) => ({ prompt: q.prompt, type: q.answerType, required: !!q.required })),
      jobTitle: gig?.posisi ?? "Lowongan",
      companyName: typeof companyName === "string" && companyName ? companyName : (company?.name ?? ""),
      label: link.label,
      expiresAt: link.expiresAt,
      candidates: rows.map(({ application: a, avatarUrl, skills, accountName }) => {
        const questions = a.applicationQuestions ?? [];
        const info = a.supportingInfo ?? {};
        return {
          id: a.id,
          displayName: clientDisplayName(accountName ?? a.workerName),
          avatarUrl: avatarUrl ?? null,
          skills: skills ?? [],
          stats: stats.get(a.workerId) ?? { ratingAvg: null, ratingCount: 0, completedJobs: 0 },
          experience: info["experience"] ?? "",
          education: info["education"] ?? "",
          // Pertanyaan foto/file hanya dilaporkan terpenuhi atau tidak — berkasnya tidak dibagikan ke klien.
          answers: questions.map((q) =>
            q.answerType === "photo" || q.answerType === "file"
              ? { prompt: q.prompt, type: q.answerType, required: !!q.required, answer: "", attached: attached.has(`${a.id}:${q.id}`) }
              : { prompt: q.prompt, type: q.answerType, required: !!q.required, answer: (a.applicationAnswers ?? {})[q.id] ?? "", attached: false },
          ),
          decision: a.clientDecision,
          note: a.clientNote ?? "",
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "[client-share] gagal memuat tampilan klien");
    res.status(500).json({ error: "Gagal memuat data." });
  }
});

/** POST /api/public/client-view/:token/decision — { applicationId, decision: "setuju"|"tidak"|null, note? } */
router.post("/public/client-view/:token/decision", async (req, res): Promise<void> => {
  noIndex(res);
  const link = await resolveLink(String(req.params["token"] ?? ""));
  if (!link) { res.status(404).json({ error: "Tautan tidak valid atau sudah kedaluwarsa." }); return; }
  const parsed = z.object({
    applicationId: z.coerce.number().int().positive(),
    decision: z.enum(["setuju", "tidak"]).nullable(),
    note: z.string().trim().max(300).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Penilaian tidak valid." }); return; }

  const rows = await shortlistedFor(link);
  const targetRow = rows.find((r) => r.application.id === parsed.data.applicationId);
  const target = targetRow?.application;
  if (!target || !targetRow) { res.status(404).json({ error: "Pelamar tidak ada di daftar ini." }); return; }

  await db
    .update(applicationsTable)
    .set({
      clientDecision: parsed.data.decision,
      clientNote: parsed.data.decision ? (parsed.data.note ?? "") : null,
      clientDecidedAt: parsed.data.decision ? new Date() : null,
    })
    .where(eq(applicationsTable.id, target.id));

  if (parsed.data.decision && parsed.data.decision !== target.clientDecision) {
    await db.insert(notificationsTable).values({
      userId: link.companyId,
      message: `Klien menilai ${clientDisplayName(targetRow.accountName ?? target.workerName)} untuk ${target.jobTitle || "lowongan Anda"}: ${parsed.data.decision === "setuju" ? "Setuju" : "Tidak"}`,
      type: "application",
      jobId: target.jobId,
      applicationId: target.id,
    }).catch((err) => logger.warn({ err }, "[client-share] notifikasi gagal"));
  }
  res.json({ ok: true });
});

export default router;
