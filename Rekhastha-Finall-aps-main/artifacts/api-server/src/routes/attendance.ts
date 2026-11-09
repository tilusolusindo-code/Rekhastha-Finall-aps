import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  attendanceTable,
  applicationsTable,
  companyBranchesTable,
  gigsTable,
} from "@workspace/db";
import { broadcastAttendance } from "../lib/realtime";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { requirePremium } from "../lib/premium";
import { kvClaimFlag, kvDelete, kvGet, kvPut, kvReleaseFlag } from "../lib/ephemeral";

const router: IRouter = Router();

/**
 * Short-lived attendance QR tokens.
 *
 * The employer device requests a token for a (jobId, kind) pair; the token is
 * encoded into a real QR code and displayed. When a worker scans it, the token
 * is redeemed exactly once and consumed. Tokens live in Postgres (ephemeral_kv,
 * shared by every serverless instance) and expire quickly so a stale
 * screenshot of the QR cannot be reused (anti-joki).
 */
const TOKEN_TTL_MS = 3 * 60 * 1000;

interface TokenRecord {
  jobId: number;
  branchId: number | null;
  kind: "masuk" | "pulang";
  latitude: number;
  longitude: number;
  radiusMeters: number;
  processing?: boolean;
}

const tokenKey = (token: string): string => `att:${token}`;

/** Returns today's date as "YYYY-MM-DD" in the Asia/Jakarta timezone. */
function jakartaDateString(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
}

const tokenBody = z.object({
  jobId: z.coerce.number(),
  kind: z.enum(["masuk", "pulang"]),
  branchId: z.coerce.number().int().positive().optional(),
});

/**
 * Employer mints a QR token. Identity comes from the session cookie (never the
 * body); the caller must be the employer that posted the job.
 *
 * Gated behind requirePremium: GPS attendance QR generation is a
 * "Rekhastha Bisnis" employee-management tool, free/unlimited only for
 * active premium subscribers (job posting itself stays free for everyone).
 */
router.post("/attendance/token", requirePremium, async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const parsed = tokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [gig] = await db
    .select()
    .from(gigsTable)
    .where(eq(gigsTable.id, parsed.data.jobId));
  if (!gig) {
    res.status(404).json({ error: "Lowongan tidak ditemukan." });
    return;
  }
  if (gig.employerId !== user.id) {
    res.status(403).json({ error: "Hanya pemberi kerja pemilik lowongan yang dapat membuat QR." });
    return;
  }

  let branchId: number | null = null;
  let latitude = Number(gig.lat);
  let longitude = Number(gig.lng);
  let radiusMeters = 500;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    res.status(422).json({
      error: "Lokasi lowongan belum tersedia. Atur lokasi atau tambahkan cabang sebelum membuat QR.",
    });
    return;
  }
  if (parsed.data.branchId !== undefined) {
    const [branch] = await db
      .select({ id: companyBranchesTable.id })
      .from(companyBranchesTable)
      .where(
        and(
          eq(companyBranchesTable.id, parsed.data.branchId),
          eq(companyBranchesTable.companyId, user.id),
          eq(companyBranchesTable.active, true),
        ),
      )
      .limit(1);
    if (!branch) {
      res.status(404).json({ error: "Cabang aktif tidak ditemukan." });
      return;
    }
    const [branchLocation] = await db
      .select({
        latitude: companyBranchesTable.latitude,
        longitude: companyBranchesTable.longitude,
        radiusMeters: companyBranchesTable.radiusMeters,
      })
      .from(companyBranchesTable)
      .where(
        and(
          eq(companyBranchesTable.id, branch.id),
          eq(companyBranchesTable.companyId, user.id),
          eq(companyBranchesTable.active, true),
        ),
      )
      .limit(1);
    if (!branchLocation) {
      res.status(404).json({ error: "Cabang aktif tidak ditemukan." });
      return;
    }
    branchId = branch.id;
    latitude = Number(branchLocation.latitude);
    longitude = Number(branchLocation.longitude);
    radiusMeters = branchLocation.radiusMeters;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await kvPut(
    tokenKey(token),
    {
      jobId: parsed.data.jobId,
      branchId,
      kind: parsed.data.kind,
      latitude,
      longitude,
      radiusMeters,
    } satisfies TokenRecord,
    TOKEN_TTL_MS,
  );
  res.status(201).json({ token, expiresAt });
});

const scanBody = z.object({
  token: z.string().min(1),
  latitude: z.coerce.number().finite().min(-90).max(90).optional(),
  longitude: z.coerce.number().finite().min(-180).max(180).optional(),
  accuracy: z.coerce.number().finite().positive().max(1000).optional(),
});

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const radius = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Worker redeems a scanned QR token. The recorded worker name is taken from the
 * authenticated session — never trusted from the body — so a scan cannot be
 * attributed to someone else.
 *
 * A worker may not scan the same event kind (masuk/pulang) more than once for
 * the same job on the same calendar day. Duplicates return HTTP 409.
 */
router.post("/attendance/scan", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang dapat melakukan presensi." });
    return;
  }
  const parsed = scanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const key = tokenKey(parsed.data.token);
  // Cross-instance lock: only one request may redeem a token at a time.
  const rec = await kvClaimFlag<TokenRecord>(key, "processing");
  if (!rec) {
    const stillThere = await kvGet<TokenRecord>(key);
    if (stillThere) {
      res.status(409).json({ error: "QR sedang diproses. Coba lagi sebentar." });
    } else {
      res.status(410).json({ error: "QR tidak valid atau sudah kadaluarsa." });
    }
    return;
  }

  // A worker can only record attendance after this employer has accepted their
  // latest application for the job.
  const [application] = await db
    .select({ status: applicationsTable.status })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, rec.jobId),
        eq(applicationsTable.workerId, user.id),
      ),
    )
    .orderBy(desc(applicationsTable.createdAt))
    .limit(1);
  if (!application || application.status !== "diterima") {
    await kvReleaseFlag(key, "processing");
    res.status(403).json({ error: "Presensi hanya tersedia untuk pekerja yang lamarannya diterima." });
    return;
  }

  let targetLatitude = rec.latitude;
  let targetLongitude = rec.longitude;
  let targetRadiusMeters = rec.radiusMeters;
  if (rec.branchId !== null) {
    const [branch] = await db
      .select()
      .from(companyBranchesTable)
      .where(
        and(
          eq(companyBranchesTable.id, rec.branchId),
          eq(companyBranchesTable.active, true),
        ),
      )
      .limit(1);
    if (!branch) {
      await kvDelete(key);
      res.status(410).json({ error: "Cabang QR sudah tidak aktif." });
      return;
    }
    targetLatitude = Number(branch.latitude);
    targetLongitude = Number(branch.longitude);
    targetRadiusMeters = branch.radiusMeters;
  }
  const { latitude: scanLatitude, longitude: scanLongitude, accuracy } = parsed.data;
  if (scanLatitude === undefined || scanLongitude === undefined || accuracy === undefined) {
    await kvReleaseFlag(key, "processing");
    res.status(400).json({ error: "Lokasi GPS wajib diizinkan untuk melakukan presensi." });
    return;
  }
  if (accuracy > 100) {
    await kvReleaseFlag(key, "processing");
    res.status(422).json({ error: "Akurasi GPS terlalu rendah. Coba lagi di area terbuka." });
    return;
  }
  const distance = distanceMeters(
    scanLatitude,
    scanLongitude,
    targetLatitude,
    targetLongitude,
  );
  if (distance > targetRadiusMeters) {
    await kvReleaseFlag(key, "processing");
    res.status(403).json({
      error: `Anda berada di luar radius presensi (${Math.round(distance)} m dari lokasi).`,
    });
    return;
  }

  const scanDate = jakartaDateString();

  // Duplicate-scan guard: one masuk and one pulang per worker per job per day.
  const [existing] = await db
    .select({ id: attendanceTable.id })
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.jobId, rec.jobId),
        eq(attendanceTable.workerId, user.id),
        eq(attendanceTable.kind, rec.kind),
        eq(attendanceTable.scanDate, scanDate),
      ),
    );
  if (existing) {
    await kvDelete(key);
    res.status(409).json({
      error:
        rec.kind === "masuk"
          ? "Anda sudah melakukan presensi masuk hari ini untuk pekerjaan ini."
          : "Anda sudah melakukan presensi pulang hari ini untuk pekerjaan ini.",
    });
    return;
  }

  const [row] = await db
    .insert(attendanceTable)
    .values({
      jobId: rec.jobId,
      branchId: rec.branchId,
      workerId: user.id,
      workerName: user.name,
      kind: rec.kind,
      scanDate,
    })
    .onConflictDoNothing()
    .returning();

  // The token is consumed only once the attendance row is safely committed.
  await kvDelete(key);
  if (!row) {
    res.status(409).json({
      error:
        rec.kind === "masuk"
          ? "Anda sudah melakukan presensi masuk hari ini untuk pekerjaan ini."
          : "Anda sudah melakukan presensi pulang hari ini untuk pekerjaan ini.",
    });
    return;
  }
  const [ownerGig] = await db
    .select({ employerId: gigsTable.employerId })
    .from(gigsTable)
    .where(eq(gigsTable.id, rec.jobId))
    .limit(1);
  broadcastAttendance(row, { workerId: user.id, employerId: ownerGig?.employerId ?? null });
  res.status(201).json(row);
});

const statusQuery = z.object({
  jobId: z.coerce.number().int().positive(),
});

/**
 * Worker restores their own attendance status for today after navigating or
 * refreshing. The session scopes the query; worker IDs are never accepted from
 * the client.
 */
router.get("/attendance/status", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Status presensi ini hanya tersedia untuk pekerja." });
    return;
  }
  const parsed = statusQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const scanDate = jakartaDateString();
  const records = await db
    .select({
      kind: attendanceTable.kind,
      at: attendanceTable.at,
    })
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.jobId, parsed.data.jobId),
        eq(attendanceTable.workerId, user.id),
        eq(attendanceTable.scanDate, scanDate),
      ),
    )
    .orderBy(desc(attendanceTable.at));
  const clockedIn = records.find((record) => record.kind === "masuk");
  const clockedOut = records.find((record) => record.kind === "pulang");

  res.setHeader("Cache-Control", "no-store");
  res.json({
    scannedIn: !!clockedIn,
    scannedOut: !!clockedOut,
    clockedInAt: clockedIn?.at.toISOString() ?? null,
    clockedOutAt: clockedOut?.at.toISOString() ?? null,
  });
});

export default router;
