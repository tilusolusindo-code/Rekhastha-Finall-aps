import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applicationsTable,
  chatMessagesTable,
  db,
  gigsTable,
  pool,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { createSession, deleteSession, SESSION_COOKIE } from "../lib/auth.js";
import {
  ADMIN_COOKIE,
  createAdminSession,
  deleteAdminSession,
} from "../lib/admin.js";
import { UPLOAD_ROOT } from "../lib/upload.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

afterAll(async () => {
  await pool.end();
});

function filename(extension: string): string {
  return `${randomUUID().replace(/-/g, "")}${extension}`;
}

async function createUser(
  role: "pekerja" | "perusahaan",
  extra: Partial<{
    ktpPhotoUrl: string | null;
    selfieWithKtpUrl: string | null;
    defaultCvUrl: string | null;
    defaultPortfolioUrl: string | null;
  }> = {},
): Promise<{ id: string; token: string }> {
  const id = `upload-test-${randomUUID()}`;
  await db.insert(usersTable).values({
    id,
    email: `${id}@example.test`,
    passwordHash: "test-only-not-a-real-password-hash",
    name: `Upload test ${role}`,
    role,
    ...extra,
  });
  cleanups.push(async () => {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  });

  const token = await createSession(id);
  cleanups.push(async () => {
    await deleteSession(token);
  });
  return { id, token };
}

async function createFile(relativeDirectory: string, name: string): Promise<void> {
  const directory = path.join(UPLOAD_ROOT, relativeDirectory);
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, name);
  await writeFile(filePath, Buffer.from("private test fixture"));
  cleanups.push(async () => {
    await rm(filePath, { force: true });
  });
}

async function createAcceptedThread(
  workerId: string,
  employerId: string,
  submittedCvUrl: string | null = null,
): Promise<number> {
  const jobId = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
  await db.insert(gigsTable).values({
    id: jobId,
    posisi: "Pekerjaan uji",
    pembayaran: "per_hari",
    nominal: 100_000,
    lat: -6.2,
    lng: 106.8,
    employerId,
  });
  cleanups.push(async () => {
    await db.delete(gigsTable).where(eq(gigsTable.id, jobId));
  });

  await db.insert(applicationsTable).values({
    jobId,
    workerId,
    employerId,
    status: "diterima",
    submittedCvUrl,
  });
  cleanups.push(async () => {
    await db
      .delete(applicationsTable)
      .where(
        and(
          eq(applicationsTable.jobId, jobId),
          eq(applicationsTable.workerId, workerId),
        ),
      );
  });
  return jobId;
}

describe("private upload routes", () => {
  it("rejects unauthenticated KYC and profile uploads before writing files", async () => {
    const kycDirectory = path.join(UPLOAD_ROOT, "kyc");
    const documentsDirectory = path.join(UPLOAD_ROOT, "documents");
    const beforeKyc = (await readdir(kycDirectory)).sort();
    const beforeDocuments = (await readdir(documentsDirectory)).sort();

    const kyc = await request(app)
      .post("/api/auth/kyc")
      .attach("ktpPhoto", Buffer.from("unauthorized KYC fixture"), {
        filename: "ktp.jpg",
        contentType: "image/jpeg",
      });
    const documents = await request(app)
      .post("/api/auth/documents")
      .attach("cv", Buffer.from("%PDF-1.4 unauthorized fixture"), {
        filename: "cv.pdf",
        contentType: "application/pdf",
      });

    expect(kyc.status).toBe(401);
    expect(documents.status).toBe(401);
    expect((await readdir(kycDirectory)).sort()).toEqual(beforeKyc);
    expect((await readdir(documentsDirectory)).sort()).toEqual(beforeDocuments);
  });

  it("rejects unauthenticated requests to KYC, CV, and chat files", async () => {
    const name = filename(".jpg");
    const kyc = await request(app).get(`/api/uploads/kyc/${name}`);
    const cv = await request(app).get(`/api/uploads/documents/${filename(".pdf")}`);
    const chat = await request(app).get(`/api/uploads/chat/123/test-worker/${name}`);
    const uploadJobId = Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 12), 16) + 1;
    const uploadWorkerId = `upload-test-${randomUUID()}`;
    const uploadDirectory = path.join(
      UPLOAD_ROOT,
      "chat",
      String(uploadJobId),
      uploadWorkerId,
    );
    cleanups.push(async () => {
      await rm(path.join(UPLOAD_ROOT, "chat", String(uploadJobId)), {
        recursive: true,
        force: true,
      });
    });
    await expect(access(uploadDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    const upload = await request(app)
      .post(`/api/chat/${uploadJobId}/${uploadWorkerId}/upload`)
      .attach("file", Buffer.from("unauthorized fixture"), {
        filename: "proof.jpg",
        contentType: "image/jpeg",
      });

    expect(kyc.status).toBe(401);
    expect(cv.status).toBe(401);
    expect(chat.status).toBe(401);
    expect(upload.status).toBe(401);
    await expect(access(uploadDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows the KYC owner and a valid admin, but hides it from another user", async () => {
    const name = filename(".jpg");
    const url = `/api/uploads/kyc/${name}`;
    const owner = await createUser("pekerja", { ktpPhotoUrl: url });
    const other = await createUser("pekerja");
    const adminToken = await createAdminSession(`upload-test-admin-${randomUUID()}`);
    cleanups.push(async () => {
      await deleteAdminSession(adminToken);
    });
    await createFile("kyc", name);

    const ownerResponse = await request(app)
      .get(url)
      .set("Cookie", `${SESSION_COOKIE}=${owner.token}`);
    const adminResponse = await request(app)
      .get(url)
      .set("Cookie", `${ADMIN_COOKIE}=${adminToken}`);
    const otherResponse = await request(app)
      .get(url)
      .set("Cookie", `${SESSION_COOKIE}=${other.token}`);

    expect(ownerResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
    expect(otherResponse.status).toBe(404);
    expect(ownerResponse.headers["cache-control"]).toBe("private, no-store");
  });

  it("limits CV access to the worker owner and the employer on that application", async () => {
    const masterName = filename(".pdf");
    const submittedName = filename(".pdf");
    const masterUrl = `/api/uploads/documents/${masterName}`;
    const submittedUrl = `/api/uploads/documents/${submittedName}`;
    const worker = await createUser("pekerja", { defaultCvUrl: masterUrl });
    const employer = await createUser("perusahaan");
    const otherEmployer = await createUser("perusahaan");
    const otherWorker = await createUser("pekerja");
    await createAcceptedThread(worker.id, employer.id, submittedUrl);
    await createFile("documents", masterName);
    await createFile("documents", submittedName);

    const ownMaster = await request(app)
      .get(masterUrl)
      .set("Cookie", `${SESSION_COOKIE}=${worker.token}`);
    const employerSubmission = await request(app)
      .get(submittedUrl)
      .set("Cookie", `${SESSION_COOKIE}=${employer.token}`);
    const unrelatedEmployer = await request(app)
      .get(submittedUrl)
      .set("Cookie", `${SESSION_COOKIE}=${otherEmployer.token}`);
    const unrelatedWorker = await request(app)
      .get(submittedUrl)
      .set("Cookie", `${SESSION_COOKIE}=${otherWorker.token}`);
    const employerMaster = await request(app)
      .get(masterUrl)
      .set("Cookie", `${SESSION_COOKIE}=${employer.token}`);

    expect(ownMaster.status).toBe(200);
    expect(employerSubmission.status).toBe(200);
    expect(unrelatedEmployer.status).toBe(404);
    expect(unrelatedWorker.status).toBe(404);
    expect(employerMaster.status).toBe(404);
    expect(employerSubmission.headers["content-disposition"]).toContain("attachment");
  });

  it("scopes new and legacy chat attachments to their original accepted thread", async () => {
    const worker = await createUser("pekerja");
    const employer = await createUser("perusahaan");
    const anotherEmployer = await createUser("perusahaan");
    const outsider = await createUser("pekerja");
    const jobId = await createAcceptedThread(worker.id, employer.id);
    const anotherJobId = await createAcceptedThread(worker.id, anotherEmployer.id);

    const scopedName = filename(".png");
    const legacyName = filename(".jpg");
    const scopedUrl = `/api/uploads/chat/${jobId}/${worker.id}/${scopedName}`;
    const legacyUrl = `/api/uploads/chat/${legacyName}`;
    await createFile(path.join("chat", String(jobId), worker.id), scopedName);
    await createFile("chat", legacyName);

    for (const attachmentUrl of [scopedUrl, legacyUrl]) {
      const [message] = await db
        .insert(chatMessagesTable)
        .values({
          jobId,
          workerId: worker.id,
          senderId: worker.id,
          senderRole: "pekerja",
          text: "",
          attachmentUrl,
          attachmentType: "image/jpeg",
          fileSize: 21,
        })
        .returning({ id: chatMessagesTable.id });
      cleanups.push(async () => {
        await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, message.id));
      });
    }

    const workerFile = await request(app)
      .get(scopedUrl)
      .set("Cookie", `${SESSION_COOKIE}=${worker.token}`);
    const employerFile = await request(app)
      .get(scopedUrl)
      .set("Cookie", `${SESSION_COOKIE}=${employer.token}`);
    const outsiderFile = await request(app)
      .get(scopedUrl)
      .set("Cookie", `${SESSION_COOKIE}=${outsider.token}`);
    const legacyFile = await request(app)
      .get(legacyUrl)
      .set("Cookie", `${SESSION_COOKIE}=${worker.token}`);
    const validMessage = await request(app)
      .post(`/api/chat/${jobId}/${worker.id}`)
      .set("Cookie", `${SESSION_COOKIE}=${worker.token}`)
      .send({ text: "Lampiran dalam percakapan yang benar.", attachmentUrl: scopedUrl });
    const crossThreadMessage = await request(app)
      .post(`/api/chat/${anotherJobId}/${worker.id}`)
      .set("Cookie", `${SESSION_COOKIE}=${worker.token}`)
      .send({ text: "Lampiran dari percakapan lain.", attachmentUrl: scopedUrl });
    const uploaded = await request(app)
      .post(`/api/chat/${jobId}/${worker.id}/upload`)
      .set("Cookie", `${SESSION_COOKIE}=${worker.token}`)
      .attach("file", Buffer.from("authorized upload fixture"), {
        filename: "proof.jpg",
        contentType: "image/jpeg",
      });
    const uploadedUrl = uploaded.body?.attachmentUrl;
    if (typeof uploadedUrl === "string") {
      const uploadedPath = path.join(
        UPLOAD_ROOT,
        "chat",
        String(jobId),
        worker.id,
        path.basename(uploadedUrl),
      );
      cleanups.push(async () => {
        await rm(uploadedPath, { force: true });
      });
    }
    const uploadedFile = typeof uploadedUrl === "string"
      ? await request(app)
          .get(uploadedUrl)
          .set("Cookie", `${SESSION_COOKIE}=${worker.token}`)
      : null;

    expect(workerFile.status).toBe(200);
    expect(employerFile.status).toBe(200);
    expect(outsiderFile.status).toBe(404);
    expect(legacyFile.status).toBe(200);
    expect(validMessage.status).toBe(201);
    expect(crossThreadMessage.status).toBe(400);
    expect(uploaded.status).toBe(201);
    expect(uploadedUrl).toMatch(
      new RegExp(`^/api/uploads/chat/${jobId}/${worker.id}/[a-f0-9]{32}\\.jpg$`),
    );
    expect(uploadedFile?.status).toBe(200);
  });
});
