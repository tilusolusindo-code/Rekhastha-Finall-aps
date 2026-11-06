import { Router, type NextFunction, type Request, type Response } from "express";
import { eq, asc, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { access } from "node:fs/promises";
import path from "node:path";
import { db, chatMessagesTable, gigsTable, applicationsTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { broadcastChatMessage } from "../lib/realtime";
import {
  chatUpload,
  isSafeUploadFilename,
  persistPrivateUpload,
  UPLOAD_ROOT,
} from "../lib/upload";
import { verifyPrivateObjectExists } from "../lib/private-application-storage";

const router = Router();

/**
 * Verify the caller is a participant in the conversation (jobId, workerId).
 *
 * Returns `{ user, gig }` on success; sends the HTTP error and returns null
 * so the route handler can exit immediately.
 *
 * Access rules:
 *  - Employer: `gig.employerId === user.id`
 *  - Worker:   `user.role === "pekerja"` AND `user.id === workerId`
 *
 * 404 is returned for any failure (not 403) to avoid leaking job existence.
 */
export async function resolveParticipant(
  req: Request,
  res: Response,
  jobId: number,
  workerId: string,
): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>; gig: { employerId: string | null } } | null> {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return null;
  }

  const [gig] = await db
    .select({ employerId: gigsTable.employerId })
    .from(gigsTable)
    .where(eq(gigsTable.id, jobId))
    .limit(1);

  if (!gig) {
    res.status(404).json({ error: "Tidak ditemukan." });
    return null;
  }

  const isEmployer =
    user.role === "perusahaan" &&
    gig.employerId !== null &&
    gig.employerId === user.id;
  const isWorker = user.role === "pekerja" && user.id === workerId;

  if (!isEmployer && !isWorker) {
    res.status(404).json({ error: "Tidak ditemukan." });
    return null;
  }

  // Workers may only open a chat thread once the employer has accepted their
  // application (status = "diterima"). Without this check any worker who knows
  // a jobId/workerId pair could read or write messages before being accepted.
  //
  // IMPORTANT: order by createdAt desc and take the MOST RECENT application.
  // A worker can re-apply to the same job (e.g. after a rejection), which
  // creates a second row for the same (jobId, workerId) pair. Without this
  // ordering, an unordered `.limit(1)` can non-deterministically return a
  // stale "ditolak" row even after the employer accepted the newer one —
  // permanently deadlocking the worker out of a chat they were just granted.
  const [app] = await db
    .select({ status: applicationsTable.status })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, jobId),
        eq(applicationsTable.workerId, workerId),
      ),
    )
    .orderBy(desc(applicationsTable.createdAt))
    .limit(1);
  if (!app || (app.status !== "diterima" && app.status !== "selesai")) {
    res.status(403).json({ error: "Chat hanya tersedia setelah lamaran diterima oleh pemberi kerja." });
    return null;
  }

  return { user, gig };
}

type ChatParticipant = NonNullable<Awaited<ReturnType<typeof resolveParticipant>>>;

async function isAttachmentForThread(
  attachmentUrl: string,
  jobId: number,
  workerId: string,
): Promise<boolean> {
  const scopedPrefix = `/api/uploads/chat/${jobId}/${workerId}/`;
  if (attachmentUrl.startsWith(scopedPrefix)) {
    const filename = attachmentUrl.slice(scopedPrefix.length);
    if (!isSafeUploadFilename(filename)) return false;
    if (process.env["NODE_ENV"] === "production") {
      const objectPath = `/objects/uploads/chat/${jobId}/${workerId}/${filename}`;
      if (await verifyPrivateObjectExists(objectPath)) return true;
    }
    try {
      const filePath = path.join(UPLOAD_ROOT, "chat", String(jobId), workerId, filename);
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Legacy URLs are accepted only when they were already recorded in this
  // same conversation. This prevents a caller from re-linking another thread's
  // old flat-path attachment into a conversation they control.
  const legacyPrefix = "/api/uploads/chat/";
  if (!attachmentUrl.startsWith(legacyPrefix)) return false;
  const filename = attachmentUrl.slice(legacyPrefix.length);
  if (!isSafeUploadFilename(filename) || filename.includes("/")) return false;

  const [existing] = await db
    .select({ id: chatMessagesTable.id })
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.jobId, jobId),
        eq(chatMessagesTable.workerId, workerId),
        eq(chatMessagesTable.attachmentUrl, attachmentUrl),
      ),
    )
    .limit(1);
  return !!existing;
}

/**
 * Fetch the chat history for a specific (jobId, workerId) conversation thread.
 *
 * Access: employer who owns the gig, or the exact worker identified by workerId.
 * Messages are returned oldest-first for chronological rendering.
 */
router.get("/chat/:jobId/:workerId", async (req: Request, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  const workerId = String(req.params.workerId ?? "");

  if (!jobId || isNaN(jobId) || !workerId) {
    res.status(400).json({ error: "Parameter tidak valid." });
    return;
  }

  const ctx = await resolveParticipant(req, res, jobId, workerId);
  if (!ctx) return;

  const rows = await db
    .select()
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.jobId, jobId),
        eq(chatMessagesTable.workerId, workerId),
      ),
    )
    .orderBy(asc(chatMessagesTable.sentAt));

  res.setHeader("Cache-Control", "no-store");
  res.json(rows);
});

const messageBody = z
  .object({
    text: z.string().max(2000).default(""),
    attachmentUrl: z.string().max(500).optional(),
    attachmentType: z.string().max(100).optional(),
    fileSize: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.text.trim().length > 0 || !!v.attachmentUrl, {
    message: "Pesan atau lampiran wajib diisi.",
  });

/**
 * Post a new message to a specific (jobId, workerId) conversation thread.
 *
 * Access: employer who owns the gig, or the exact worker identified by workerId.
 * The saved row is broadcast via WebSocket only to the employer and the worker —
 * no other connected client receives the frame.
 */
router.post("/chat/:jobId/:workerId", async (req: Request, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  const workerId = String(req.params.workerId ?? "");

  if (!jobId || isNaN(jobId) || !workerId) {
    res.status(400).json({ error: "Parameter tidak valid." });
    return;
  }

  const ctx = await resolveParticipant(req, res, jobId, workerId);
  if (!ctx) return;

  const parsed = messageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Pesan tidak valid." });
    return;
  }
  if (
    parsed.data.attachmentUrl &&
    !(await isAttachmentForThread(parsed.data.attachmentUrl, jobId, workerId))
  ) {
    res.status(400).json({ error: "Lampiran tidak sesuai dengan percakapan ini." });
    return;
  }

  const [row] = await db
    .insert(chatMessagesTable)
    .values({
      jobId,
      workerId,
      senderId: ctx.user.id,
      senderRole: ctx.user.role,
      text: parsed.data.text,
      attachmentUrl: parsed.data.attachmentUrl ?? null,
      attachmentType: parsed.data.attachmentType ?? null,
      fileSize: parsed.data.fileSize ?? null,
    })
    .returning();

  broadcastChatMessage(row, ctx.gig.employerId ?? "", workerId);

  req.log.info(
    { chatMessageId: row.id, jobId: row.jobId, senderId: row.senderId },
    "Chat message sent",
  );
  res.status(201).json(row);
});

async function authorizeChatUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const jobId = Number(req.params["jobId"]);
  const workerId = String(req.params["workerId"] ?? "");
  if (
    !Number.isSafeInteger(jobId) ||
    jobId <= 0 ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(workerId)
  ) {
    res.status(400).json({ error: "Parameter tidak valid." });
    return;
  }

  const participant = await resolveParticipant(req, res, jobId, workerId);
  if (!participant) return;
  res.locals.chatParticipant = participant;
  next();
}

/**
 * Upload a chat attachment (KTP revision, work proof, dispute photo).
 * Access is scoped identically to posting a message in the thread: only the
 * employer who owns the gig or the accepted worker may upload.
 *
 * Returns the server-relative URL to embed in a subsequent POST /chat/:jobId/:workerId.
 * The file itself is not linked to any message until that POST succeeds, so an
 * upload with no follow-up POST is simply an orphaned file (best-effort — not
 * cleaned up automatically, consistent with the KYC upload path).
 */
router.post(
  "/chat/:jobId/:workerId/upload",
  authorizeChatUpload,
  chatUpload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const jobId = Number(req.params.jobId);
    const workerId = String(req.params.workerId ?? "");
    const ctx = res.locals.chatParticipant as ChatParticipant | undefined;
    if (!ctx) {
      res.status(401).json({ error: "Tidak terautentikasi." });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "Berkas tidak ditemukan atau format tidak didukung (JPG, PNG, PDF, maks 5MB)." });
      return;
    }

    let filename: string;
    try {
      filename = await persistPrivateUpload(req.file, [
        "chat",
        String(jobId),
        workerId,
      ]);
    } catch {
      req.log.error({ jobId, workerId }, "Failed to store chat attachment");
      res.status(503).json({ error: "Penyimpanan lampiran sedang tidak tersedia." });
      return;
    }

    const url = `/api/uploads/chat/${jobId}/${workerId}/${filename}`;
    req.log.info(
      { jobId, workerId, senderId: ctx.user.id, mimetype: req.file.mimetype, size: req.file.size },
      "Chat attachment uploaded",
    );
    res.status(201).json({
      attachmentUrl: url,
      attachmentType: req.file.mimetype,
      fileSize: req.file.size,
    });
  },
);

export default router;
