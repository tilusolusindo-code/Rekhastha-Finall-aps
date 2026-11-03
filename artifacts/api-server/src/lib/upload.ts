import multer from "multer";
import path from "node:path";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { uploadPrivateObject } from "./private-application-storage";
import type { Request } from "express";

/**
 * Resolved root directory for uploaded files.
 * Default: <api-server-cwd>/uploads
 * Override via UPLOAD_ROOT env var.
 */
export const UPLOAD_ROOT = path.resolve(
  process.env["UPLOAD_ROOT"] ?? path.join(process.cwd(), "uploads"),
);

// Local development only. In production (Vercel) the filesystem is read-only
// and uploads go straight to Supabase Storage from memory.
if (process.env["NODE_ENV"] !== "production") {
  for (const sub of ["chat", "kyc", "documents"]) {
    try {
      fs.mkdirSync(path.join(UPLOAD_ROOT, sub), { recursive: true });
    } catch {
      /* non-fatal: multer reports the error if a write is attempted */
    }
  }
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "application/pdf":
      return ".pdf";
    default:
      return ".bin";
  }
}

function makeStorage(subdir: string) {
  if (process.env["NODE_ENV"] === "production") {
    return multer.memoryStorage();
  }
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(UPLOAD_ROOT, subdir));
    },
    filename(_req, file, cb) {
      const name = randomBytes(16).toString("hex");
      cb(null, `${name}${extensionForMimeType(file.mimetype)}`);
    },
  });
}

function makeChatStorage() {
  if (process.env["NODE_ENV"] === "production") {
    return multer.memoryStorage();
  }
  return multer.diskStorage({
    destination(req: Request, _file, cb) {
      const jobId = String(req.params["jobId"] ?? "");
      const workerId = String(req.params["workerId"] ?? "");
      if (!/^[1-9]\d*$/.test(jobId) || !/^[A-Za-z0-9_-]{1,128}$/.test(workerId)) {
        cb(new Error("Percakapan tidak valid."), "");
        return;
      }

      const destination = path.join(UPLOAD_ROOT, "chat", jobId, workerId);
      fs.mkdir(destination, { recursive: true }, (error) => {
        cb(error, destination);
      });
    },
    filename(_req, file, cb) {
      const name = randomBytes(16).toString("hex");
      cb(null, `${name}${extensionForMimeType(file.mimetype)}`);
    },
  });
}

/** Multer-generated names only; never accept user-controlled filesystem paths. */
export function isSafeUploadFilename(filename: string): boolean {
  return /^[a-f0-9]{32}\.(?:jpg|jpeg|png|pdf|bin)$/.test(filename);
}

/**
 * Check the leading bytes of a file against the content type it claims.
 * Used for browser-to-storage uploads (application attachments), where the
 * server never sees the bytes until the upload is "completed".
 */
export function matchesDeclaredSignature(contentType: string, bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes);
  switch (contentType) {
    case "image/jpeg":
    case "image/png":
    case "application/pdf":
      return hasValidFileSignature({ mimetype: contentType, buffer: buf } as Express.Multer.File);
    case "image/webp":
      return (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "application/msword": // legacy .doc = OLE2 compound file
      return (
        buf.length >= 8 &&
        buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
      );
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": // .docx = ZIP
      return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    default:
      return false;
  }
}

function hasValidFileSignature(file: Express.Multer.File): boolean {
  const bytes = file.buffer;
  if (!bytes) return false;
  switch (file.mimetype) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "application/pdf":
      return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    default:
      return false;
  }
}

/**
 * Persist a validated upload in private object storage in production.
 * Development and tests retain their existing local-file behavior.
 */
export async function persistPrivateUpload(
  file: Express.Multer.File,
  objectSegments: string[],
): Promise<string> {
  if (process.env["NODE_ENV"] !== "production") {
    if (!file.filename) throw new Error("Nama berkas lokal tidak tersedia.");
    return file.filename;
  }

  if (
    objectSegments.length === 0 ||
    objectSegments.some((segment) => !/^[A-Za-z0-9_-]{1,128}$/.test(segment)) ||
    !hasValidFileSignature(file)
  ) {
    throw new Error("Isi berkas tidak valid.");
  }

  const filename = `${randomBytes(16).toString("hex")}${extensionForMimeType(file.mimetype)}`;
  const objectPath = `/objects/uploads/${objectSegments.join("/")}/${filename}`;
  await uploadPrivateObject(objectPath, file.buffer, file.mimetype);
  return filename;
}

const ALLOWED_CHAT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

const ALLOWED_KYC_MIME = new Set(["image/jpeg", "image/png"]);

/** CV/Portfolio uploads are PDF-only — plain resume files, never images. */
const ALLOWED_DOCUMENT_MIME = new Set(["application/pdf"]);

/**
 * Vercel functions reject request bodies over 4.5 MB, and the KYC (KTP +
 * selfie) and CV/portfolio endpoints each carry TWO files in one request, so
 * per-file limits are kept small enough that a pair still fits. Application
 * attachments are unaffected: they upload directly to Supabase Storage.
 */
/** Chat attachments (single file per request). */
const MAX_SIZE_BYTES = 4 * 1024 * 1024;

/** KYC photos / CV + portfolio PDFs (two files per request). */
const MAX_PAIR_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_SIZE_BYTES = MAX_PAIR_FILE_SIZE_BYTES;

export const chatUpload = multer({
  storage: makeChatStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_CHAT_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Hanya JPG, PNG, dan PDF yang diizinkan untuk lampiran chat."));
    }
  },
});

export const kycUpload = multer({
  storage: makeStorage("kyc"),
  limits: { fileSize: MAX_PAIR_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_KYC_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Hanya JPG dan PNG yang diizinkan untuk dokumen KYC."));
    }
  },
});

/**
 * CV / Portfolio resume uploads — used both for the worker's profile master
 * files (default_cv_url/default_portfolio_url) and for a per-application
 * override (submitted_cv_url/submitted_portfolio_url) on Regular jobs.
 * PDF-only, 10MB max — distinct from the 5MB image/PDF chat attachment limit.
 */
export const documentUpload = multer({
  storage: makeStorage("documents"),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_DOCUMENT_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Hanya PDF yang diizinkan untuk CV/Portofolio (maks 2MB per berkas)."));
    }
  },
});
