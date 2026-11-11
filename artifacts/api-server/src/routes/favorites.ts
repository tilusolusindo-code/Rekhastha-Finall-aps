import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  applicationsTable,
  db,
  favoriteWorkersTable,
  gigsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { kvPutIfAbsent } from "../lib/ephemeral";
import { notifyByEmail } from "../lib/notify";
import { getWorkerStats } from "../lib/worker-stats";
import { escrowAllowsPayout } from "../lib/wage-ledger";

const router: IRouter = Router();
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/;

async function requireEmployer(req: Request, res: Response) {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return null;
  }
  if (user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya pemberi kerja yang dapat memakai pekerja favorit." });
    return null;
  }
  return user;
}

/** Daftar pekerja favorit milik pemberi kerja, lengkap dengan statistik publik. */
router.get("/favorites", async (req, res): Promise<void> => {
  const user = await requireEmployer(req, res);
  if (!user) return;
  const rows = await db
    .select({
      workerId: favoriteWorkersTable.workerId,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      skills: usersTable.skills,
      suspended: usersTable.suspended,
    })
    .from(favoriteWorkersTable)
    .innerJoin(usersTable, eq(usersTable.id, favoriteWorkersTable.workerId))
    .where(eq(favoriteWorkersTable.employerId, user.id))
    .orderBy(desc(favoriteWorkersTable.createdAt));
  const stats = await getWorkerStats(rows.map((r) => r.workerId));
  res.setHeader("Cache-Control", "no-store");
  res.json(
    rows
      .filter((r) => !r.suspended)
      .map((r) => ({
        workerId: r.workerId,
        name: r.name,
        avatarUrl: r.avatarUrl ?? null,
        skills: r.skills ?? [],
        stats: stats.get(r.workerId) ?? { ratingAvg: null, ratingCount: 0, completedJobs: 0 },
      })),
  );
});

/** Tandai favorit. Hanya pekerja yang pernah diterima oleh pemberi kerja ini. */
router.put("/favorites/:workerId", async (req, res): Promise<void> => {
  const user = await requireEmployer(req, res);
  if (!user) return;
  const workerId = String(req.params["workerId"] ?? "");
  if (!WORKER_ID.test(workerId)) {
    res.status(400).json({ error: "ID pekerja tidak valid." });
    return;
  }
  const [worked] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.employerId, user.id),
        eq(applicationsTable.workerId, workerId),
        inArray(applicationsTable.status, ["diterima", "selesai"]),
      ),
    )
    .limit(1);
  if (!worked) {
    res.status(403).json({ error: "Hanya pekerja yang pernah Anda terima yang bisa difavoritkan." });
    return;
  }
  await db
    .insert(favoriteWorkersTable)
    .values({ employerId: user.id, workerId })
    .onConflictDoNothing();
  res.json({ ok: true, isFavorite: true });
});

router.delete("/favorites/:workerId", async (req, res): Promise<void> => {
  const user = await requireEmployer(req, res);
  if (!user) return;
  const workerId = String(req.params["workerId"] ?? "");
  if (!WORKER_ID.test(workerId)) {
    res.status(400).json({ error: "ID pekerja tidak valid." });
    return;
  }
  await db
    .delete(favoriteWorkersTable)
    .where(and(eq(favoriteWorkersTable.employerId, user.id), eq(favoriteWorkersTable.workerId, workerId)));
  res.json({ ok: true, isFavorite: false });
});

const inviteBody = z.object({ jobId: z.number().int().positive() });

/** Ajak pekerja favorit ke lowongan aktif: notifikasi dalam aplikasi + email. */
router.post("/favorites/:workerId/invite", async (req, res): Promise<void> => {
  const user = await requireEmployer(req, res);
  if (!user) return;
  const workerId = String(req.params["workerId"] ?? "");
  const parsed = inviteBody.safeParse(req.body);
  if (!WORKER_ID.test(workerId) || !parsed.success) {
    res.status(400).json({ error: "Data undangan tidak valid." });
    return;
  }
  const { jobId } = parsed.data;

  const [favorite] = await db
    .select({ workerId: favoriteWorkersTable.workerId })
    .from(favoriteWorkersTable)
    .where(and(eq(favoriteWorkersTable.employerId, user.id), eq(favoriteWorkersTable.workerId, workerId)))
    .limit(1);
  if (!favorite) {
    res.status(404).json({ error: "Pekerja ini belum ada di daftar favorit Anda." });
    return;
  }
  const [gig] = await db.select().from(gigsTable).where(eq(gigsTable.id, jobId)).limit(1);
  if (!gig || gig.employerId !== user.id) {
    res.status(404).json({ error: "Lowongan tidak ditemukan." });
    return;
  }
  if (gig.paymentStatus !== "confirmed" || !escrowAllowsPayout(gig.escrowStatus)) {
    res.status(409).json({ error: "Lowongan belum aktif atau sudah selesai." });
    return;
  }
  const [worker] = await db
    .select({ id: usersTable.id, suspended: usersTable.suspended })
    .from(usersTable)
    .where(eq(usersTable.id, workerId))
    .limit(1);
  if (!worker || worker.suspended) {
    res.status(404).json({ error: "Pekerja tidak tersedia." });
    return;
  }
  const fresh = await kvPutIfAbsent(`invite:${user.id}:${workerId}:${jobId}`, 1, 24 * 60 * 60 * 1000);
  if (!fresh) {
    res.status(429).json({ error: "Pekerja ini sudah Anda ajak untuk lowongan tersebut." });
    return;
  }

  const profile = (user.profile ?? {}) as Record<string, unknown>;
  const employerName = (typeof profile["namaPerusahaan"] === "string" && profile["namaPerusahaan"]) || user.name;
  await db.insert(notificationsTable).values({
    userId: workerId,
    message: `${employerName} mengajak Anda untuk lowongan ${gig.posisi}`,
    type: "invite",
    jobId,
  });
  void notifyByEmail(workerId, { kind: "invite", employerName, jobTitle: gig.posisi });
  res.json({ ok: true });
});

export default router;
