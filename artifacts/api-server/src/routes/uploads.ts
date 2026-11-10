import { Router, type Request, type Response } from "express";
import { and, asc, eq, or } from "drizzle-orm";
import path from "node:path";
import {
  applicationsTable,
  chatMessagesTable,
  db,
  usersTable,
} from "@workspace/db";
import { ADMIN_COOKIE, adminSessionId } from "../lib/admin";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { isSafeUploadFilename, UPLOAD_ROOT } from "../lib/upload";
import {
  createPrivateDownloadUrl,
  verifyPrivateObjectExists,
} from "../lib/private-application-storage";
import { resolveParticipant } from "./chat";

const router = Router();
const PRIVATE_FILE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function allowedExtension(kind: "kyc" | "documents" | "chat" | "avatar", filename: string): boolean {
  if (!isSafeUploadFilename(filename)) return false;
  const extension = path.extname(filename).toLowerCase();
  if (kind === "kyc" || kind === "avatar") return [".jpg", ".jpeg", ".png", ".bin"].includes(extension);
  if (kind === "documents") return [".pdf", ".bin"].includes(extension);
  return [".jpg", ".jpeg", ".png", ".pdf", ".bin"].includes(extension);
}

function sendPrivateFile(
  req: Request,
  res: Response,
  directory: string,
  filename: string,
  objectPath: string,
): Promise<void> {
  return (async () => {
    if (
      process.env["NODE_ENV"] === "production" &&
      await verifyPrivateObjectExists(objectPath)
    ) {
      res.set(PRIVATE_FILE_HEADERS);
      res.redirect(302, await createPrivateDownloadUrl(objectPath));
      return;
    }

    const extension = path.extname(filename).toLowerCase();
    const inlineImage = [".jpg", ".jpeg", ".png"].includes(extension);

    res.sendFile(
      filename,
      {
        root: directory,
        dotfiles: "deny",
        headers: {
          ...PRIVATE_FILE_HEADERS,
          "Content-Disposition": inlineImage
            ? "inline"
            : `attachment; filename="${filename}"`,
        },
      },
      (error) => {
        if (!error || res.headersSent) return;
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : undefined;
        if (statusCode === 404) {
          res.status(404).json({ error: "Berkas tidak ditemukan." });
          return;
        }
        req.log.error(
          {
            code:
              typeof error === "object" && error !== null && "code" in error
                ? error.code
                : undefined,
          },
          "Failed to serve private upload",
        );
        res.status(500).json({ error: "Berkas tidak dapat dibuka." });
      },
    );
  })();
}

async function userOwnsKycFile(userId: string, url: string): Promise<boolean> {
  const [owner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, userId),
        or(eq(usersTable.ktpPhotoUrl, url), eq(usersTable.selfieWithKtpUrl, url)),
      ),
    )
    .limit(1);
  return !!owner;
}

async function userCanReadDocument(userId: string, role: string, url: string): Promise<boolean> {
  const [owner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, userId),
        or(eq(usersTable.defaultCvUrl, url), eq(usersTable.defaultPortfolioUrl, url)),
      ),
    )
    .limit(1);
  if (owner) return true;
  if (role !== "perusahaan") return false;

  const [application] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.employerId, userId),
        or(
          eq(applicationsTable.submittedCvUrl, url),
          eq(applicationsTable.submittedPortfolioUrl, url),
        ),
      ),
    )
    .limit(1);
  return !!application;
}

async function requireUser(req: Request, res: Response) {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return null;
  }
  return user;
}

router.get("/kyc/:filename", async (req, res): Promise<void> => {
  const filename = param(req.params["filename"]);
  if (!allowedExtension("kyc", filename)) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  const [user, adminId] = await Promise.all([
    getSessionUser(req.cookies?.[SESSION_COOKIE]),
    adminSessionId(req.cookies?.[ADMIN_COOKIE]),
  ]);
  if (!user && !adminId) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }

  const url = `/api/uploads/kyc/${filename}`;
  const allowed = !!adminId || (!!user && await userOwnsKycFile(user.id, url));
  if (!allowed) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  await sendPrivateFile(
    req,
    res,
    path.join(UPLOAD_ROOT, "kyc"),
    filename,
    `/objects/uploads/kyc/${filename}`,
  );
});

// Foto profil boleh dilihat pengguna yang sudah login (pemberi kerja melihat foto pelamar,
// dst.), tetapi hanya berkas yang benar-benar terdaftar sebagai avatar seseorang.
router.get("/avatar/:filename", async (req, res): Promise<void> => {
  const filename = param(req.params["filename"]);
  if (!allowedExtension("avatar", filename)) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }
  const [user, adminId] = await Promise.all([
    getSessionUser(req.cookies?.[SESSION_COOKIE]),
    adminSessionId(req.cookies?.[ADMIN_COOKIE]),
  ]);
  if (!user && !adminId) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const url = `/api/uploads/avatar/${filename}`;
  const [owner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.avatarUrl, url))
    .limit(1);
  if (!owner) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }
  await sendPrivateFile(
    req,
    res,
    path.join(UPLOAD_ROOT, "avatar"),
    filename,
    `/objects/uploads/avatar/${filename}`,
  );
});

router.get("/documents/:filename", async (req, res): Promise<void> => {
  const filename = param(req.params["filename"]);
  if (!allowedExtension("documents", filename)) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;

  const url = `/api/uploads/documents/${filename}`;
  if (!(await userCanReadDocument(user.id, user.role, url))) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  await sendPrivateFile(
    req,
    res,
    path.join(UPLOAD_ROOT, "documents"),
    filename,
    `/objects/uploads/documents/${filename}`,
  );
});

router.get("/chat/:jobId/:workerId/:filename", async (req, res): Promise<void> => {
  const jobId = Number(param(req.params["jobId"]));
  const workerId = param(req.params["workerId"]);
  const filename = param(req.params["filename"]);
  if (
    !Number.isSafeInteger(jobId) ||
    jobId <= 0 ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(workerId) ||
    !allowedExtension("chat", filename)
  ) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  const participant = await resolveParticipant(req, res, jobId, workerId);
  if (!participant) return;

  await sendPrivateFile(
    req,
    res,
    path.join(UPLOAD_ROOT, "chat", String(jobId), workerId),
    filename,
    `/objects/uploads/chat/${jobId}/${workerId}/${filename}`,
  );
});

// Preserve previously sent root-level chat attachments, but only for the
// conversation that first recorded the exact URL. New uploads use scoped paths.
router.get("/chat/:filename", async (req, res): Promise<void> => {
  const filename = param(req.params["filename"]);
  if (!allowedExtension("chat", filename)) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }
  if (!(await requireUser(req, res))) return;

  const url = `/api/uploads/chat/${filename}`;
  const [origin] = await db
    .select({
      jobId: chatMessagesTable.jobId,
      workerId: chatMessagesTable.workerId,
    })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.attachmentUrl, url))
    .orderBy(asc(chatMessagesTable.id))
    .limit(1);
  if (!origin) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  const participant = await resolveParticipant(req, res, origin.jobId, origin.workerId);
  if (!participant) return;
  await sendPrivateFile(
    req,
    res,
    path.join(UPLOAD_ROOT, "chat"),
    filename,
    `/objects/uploads/chat/${filename}`,
  );
});

export default router;
