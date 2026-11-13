import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  applicationsTable,
  applicationUploadsTable,
  gigsTable,
  usersTable,
  favoriteWorkersTable,
  notificationsTable,
  walletEntriesTable,
} from "@workspace/db";
import { escrowAllowsPayout } from "../lib/wage-ledger";
import { notifyByEmail } from "../lib/notify";
import { teamCan } from "../lib/team-access";
import { getWorkerStats } from "../lib/worker-stats";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import {
  createPrivateDownloadUrl,
  createPrivateUploadTarget,
  deletePrivateObject,
  readPrivateObjectHead,
  verifyPrivateObjectExists,
} from "../lib/private-application-storage";
import { matchesDeclaredSignature } from "../lib/upload";
import {
  broadcastApplication,
  broadcastApplicationStatus,
} from "../lib/realtime";

const router: IRouter = Router();

const MAX_APPLICATION_FILE_SIZE = 10 * 1024 * 1024;
const applicationFileMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const applicationFileKindSchema = z.enum(["cv", "portfolio", "file", "photo"]);

router.post("/applications/uploads/request-url", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang dapat mengunggah berkas lamaran." });
    return;
  }

  const parsed = z.object({
    jobId: z.coerce.number().int().positive(),
    fileName: z.string().trim().min(1).max(180),
    fileSize: z.number().int().positive().max(MAX_APPLICATION_FILE_SIZE),
    contentType: z.enum(applicationFileMimeTypes),
    kind: applicationFileKindSchema,
    questionId: z.string().min(1).max(80).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Berkas tidak valid. Gunakan PDF, DOC, DOCX, JPG, PNG, atau WEBP maksimal 10MB.",
    });
    return;
  }
  if (
    parsed.data.kind === "photo" &&
    !parsed.data.contentType.startsWith("image/")
  ) {
    res.status(400).json({ error: "Jenis lampiran foto harus berupa gambar." });
    return;
  }
  if (
    (parsed.data.kind === "cv" || parsed.data.kind === "file") &&
    parsed.data.contentType.startsWith("image/")
  ) {
    res.status(400).json({ error: "Pilih dokumen untuk jenis lampiran ini." });
    return;
  }

  const [gig] = await db
    .select({
      employerId: gigsTable.employerId,
      paymentStatus: gigsTable.paymentStatus,
      applicationQuestions: gigsTable.applicationQuestions,
    })
    .from(gigsTable)
    .where(eq(gigsTable.id, parsed.data.jobId))
    .limit(1);
  if (!gig || gig.paymentStatus !== "confirmed" || !gig.employerId) {
    res.status(404).json({ error: "Lowongan tidak tersedia." });
    return;
  }
  // Unggahan untuk syarat perekrut: pertanyaannya harus ada, bertipe foto/file, dan jenis berkas harus cocok.
  if (parsed.data.questionId) {
    const question = (gig.applicationQuestions ?? []).find((q) => q.id === parsed.data.questionId);
    if (!question || (question.answerType !== "photo" && question.answerType !== "file")) {
      res.status(400).json({ error: "Syarat unggahan tidak ditemukan pada lowongan ini." });
      return;
    }
    if (parsed.data.kind !== question.answerType) {
      res.status(400).json({ error: "Jenis berkas tidak sesuai dengan syarat yang diminta." });
      return;
    }
    // Satu syarat = satu berkas; unggahan lama yang belum terpakai untuk syarat ini diganti.
    await db
      .delete(applicationUploadsTable)
      .where(and(
        eq(applicationUploadsTable.workerId, user.id),
        eq(applicationUploadsTable.jobId, parsed.data.jobId),
        eq(applicationUploadsTable.questionId, parsed.data.questionId),
        isNull(applicationUploadsTable.applicationId),
      ));
  }
  if (gig.employerId === user.id) {
    res.status(403).json({ error: "Anda tidak dapat melamar lowongan sendiri." });
    return;
  }

  try {
    const target = await createPrivateUploadTarget();
    const [upload] = await db
      .insert(applicationUploadsTable)
      .values({
        workerId: user.id,
        jobId: parsed.data.jobId,
        objectPath: target.objectPath,
        fileName: parsed.data.fileName.replace(/[\\/]/g, "_"),
        contentType: parsed.data.contentType,
        fileSize: parsed.data.fileSize,
        kind: parsed.data.kind,
        questionId: parsed.data.questionId ?? null,
      })
      .returning({ id: applicationUploadsTable.id });

    if (!upload) {
      res.status(500).json({ error: "Gagal menyiapkan unggahan." });
      return;
    }
    res.status(201).json({
      id: upload.id,
      uploadUrl: target.uploadUrl,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create private application upload URL");
    res.status(503).json({ error: "Penyimpanan berkas sedang tidak tersedia." });
  }
});

router.post("/applications/uploads/:id/complete", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang dapat menyelesaikan unggahan." });
    return;
  }
  const id = Number(Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID unggahan tidak valid." });
    return;
  }

  const [upload] = await db
    .select()
    .from(applicationUploadsTable)
    .where(and(
      eq(applicationUploadsTable.id, id),
      eq(applicationUploadsTable.workerId, user.id),
    ))
    .limit(1);
  if (!upload) {
    res.status(404).json({ error: "Unggahan tidak ditemukan." });
    return;
  }

  try {
    const exists = await verifyPrivateObjectExists(upload.objectPath, upload.fileSize);
    if (!exists) {
      res.status(400).json({ error: "Berkas belum selesai diunggah." });
      return;
    }

    // The browser uploaded straight to storage, so the declared content type is
    // only a claim. Verify the real leading bytes before accepting the file;
    // a renamed executable (or anything else) is deleted on the spot.
    const head = await readPrivateObjectHead(upload.objectPath, 16);
    if (!head || !matchesDeclaredSignature(upload.contentType, head)) {
      await deletePrivateObject(upload.objectPath);
      await db
        .delete(applicationUploadsTable)
        .where(eq(applicationUploadsTable.id, upload.id));
      res.status(400).json({
        error: "Isi berkas tidak sesuai dengan jenisnya. Unggah PDF, DOC, DOCX, JPG, PNG, atau WEBP yang asli.",
      });
      return;
    }
    await db
      .update(applicationUploadsTable)
      .set({ uploaded: true })
      .where(eq(applicationUploadsTable.id, upload.id));
    res.json({
      id: upload.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      kind: upload.kind,
    });
  } catch (error) {
    req.log.error({ err: error, uploadId: upload.id }, "Failed to verify application upload");
    res.status(503).json({ error: "Gagal memverifikasi berkas yang diunggah." });
  }
});

router.get("/applications/files/:id", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const id = Number(Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID berkas tidak valid." });
    return;
  }

  const [upload] = await db
    .select()
    .from(applicationUploadsTable)
    .where(and(
      eq(applicationUploadsTable.id, id),
      eq(applicationUploadsTable.uploaded, true),
    ))
    .limit(1);
  if (!upload) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  let allowed = upload.workerId === user.id;
  if (!allowed && upload.applicationId != null) {
    const [application] = await db
      .select({ id: applicationsTable.id, employerId: applicationsTable.employerId })
      .from(applicationsTable)
      .where(eq(applicationsTable.id, upload.applicationId))
      .limit(1);
    if (application) {
      // Pemilik lowongan, atau anggota tim HR perusahaan itu (paket Bisnis aktif).
      allowed =
        (user.role === "perusahaan" && application.employerId === user.id) ||
        (await teamCan(user.id, application.employerId, "applications.view"));
    }
  }
  if (!allowed) {
    res.status(404).json({ error: "Berkas tidak ditemukan." });
    return;
  }

  try {
    res.setHeader("Cache-Control", "private, no-store");
    const isImage = upload.contentType.startsWith("image/");
    res.redirect(
      302,
      await createPrivateDownloadUrl(
        upload.objectPath,
        isImage ? undefined : upload.fileName.replace(/[^\w.\- ]+/g, "_"),
      ),
    );
  } catch (error) {
    req.log.error({ err: error, uploadId: upload.id }, "Failed to create application file download URL");
    res.status(503).json({ error: "Berkas sementara tidak dapat dibuka." });
  }
});

/**
 * Worker submits an application for a gig.
 *
 * Sensitive fields (NIK, NPWP, rekening) arrive already-masked — masking runs
 * on the worker's device in `handleApply` before the payload is sent here.
 * The server looks up the gig's employer_id so subsequent GET/PATCH endpoints
 * can enforce row-level ownership without relying on client-supplied data.
 * The row is persisted and immediately fanned out over the WebSocket hub.
 */
const applyBody = z.object({
  jobId: z.coerce.number().int().positive(),
  jobTitle: z.string().default(""),
  workerName: z.string().default(""),
  workerNikMasked: z.string().default(""),
  workerNpwpMasked: z.string().default(""),
  hasNpwp: z.boolean().default(false),
  bank: z.string().default(""),
  rekening: z.string().default(""),
  /** Optional link to the worker's CV / resume. */
  cvLink: z.string().optional(),
  /** Optional link to the worker's portfolio. */
  portfolioLink: z.string().optional(),
  /**
   * Regular-job dual-entry CV/Portfolio. When provided, these are a fresh
   * upload made specifically for this application (apply-modal "unggah
   * berkas baru" choice). When omitted, the server falls back to the
   * worker's profile master files (default_cv_url/default_portfolio_url) —
   * the apply-modal "gunakan CV/Portofolio dari profil" choice. Instant jobs
   * never send these — Instant stays direct click-to-apply.
   */
  submittedCvUrl: z.string().optional(),
  submittedPortfolioUrl: z.string().optional(),
  applicationAnswers: z.record(z.string().max(80), z.string().max(4000)).default({}),
  supportingInfo: z.object({
    experience: z.string().max(2000).optional(),
    education: z.string().max(500).optional(),
    skills: z.string().max(1000).optional(),
    availability: z.string().max(500).optional(),
  }).default({}),
  uploadIds: z.array(z.coerce.number().int().positive()).max(8).default([]),
});

function hasCompleteWorkerProfile(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  const nested = root["workerProfile"];
  const profile =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : root;
  const text = (key: string) => typeof profile[key] === "string" ? profile[key].trim() : "";
  const npwpDigits = text("npwp").replace(/\D/g, "");
  return (
    !!text("namaLengkap") &&
    /^\d{16}$/.test(text("nik")) &&
    !!text("tempatLahir") &&
    /^\d{4}-\d{2}-\d{2}$/.test(text("tanggalLahir")) &&
    (profile["jenisKelamin"] === "L" || profile["jenisKelamin"] === "P") &&
    /^\d{10,20}$/.test(text("whatsapp")) &&
    (profile["belumPunyaNpwp"] === true || /^\d{15,16}$/.test(npwpDigits)) &&
    !!text("namaBank") &&
    !!text("nomorRekening") &&
    !!text("namaRekening") &&
    profile["ktpUploaded"] === true &&
    profile["selfieUploaded"] === true
  );
}

function toApplicationAttachment(upload: {
  id: number;
  fileName: string;
  contentType: string;
  kind: string;
  questionId?: string | null;
}) {
  return {
    id: upload.id,
    questionId: upload.questionId ?? null,
    fileName: upload.fileName,
    contentType: upload.contentType,
    kind: upload.kind,
    url: `/api/applications/files/${upload.id}`,
  };
}

export async function getApplicationAttachments(applicationIds: number[]) {
  if (applicationIds.length === 0) return new Map<number, ReturnType<typeof toApplicationAttachment>[]>();
  const rows = await db
    .select({
      id: applicationUploadsTable.id,
      applicationId: applicationUploadsTable.applicationId,
      fileName: applicationUploadsTable.fileName,
      contentType: applicationUploadsTable.contentType,
      kind: applicationUploadsTable.kind,
      questionId: applicationUploadsTable.questionId,
    })
    .from(applicationUploadsTable)
    .where(and(
      inArray(applicationUploadsTable.applicationId, applicationIds),
      eq(applicationUploadsTable.uploaded, true),
    ));
  const grouped = new Map<number, ReturnType<typeof toApplicationAttachment>[]>();
  for (const row of rows) {
    if (row.applicationId == null) continue;
    const attachments = grouped.get(row.applicationId) ?? [];
    attachments.push(toApplicationAttachment(row));
    grouped.set(row.applicationId, attachments);
  }
  return grouped;
}

router.post("/applications", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang dapat melamar pekerjaan." });
    return;
  }
  const parsed = applyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (new Set(parsed.data.uploadIds).size !== parsed.data.uploadIds.length) {
    res.status(400).json({ error: "Daftar berkas lamaran berisi ID duplikat." });
    return;
  }

  // Persist the application and its durable notification atomically. This
  // prevents a failed notification write from leaving an application that
  // appears to the worker as a failed request and never reaches the employer.
  const result = await db.transaction(async (tx) => {
    // Serialize retries only for this worker/job pair. A row-level UPDATE lock
    // on the gig made every applicant for the same popular job wait in line.
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${parsed.data.jobId}:${user.id}`}, 0)
      )
    `);
    const [gig] = await tx
      .select({
        employerId: gigsTable.employerId,
        hiringMode: gigsTable.hiringMode,
        title: gigsTable.posisi,
        paymentStatus: gigsTable.paymentStatus,
        applicationQuestions: gigsTable.applicationQuestions,
        requestedApplicationDocuments: gigsTable.requestedApplicationDocuments,
      })
      .from(gigsTable)
      .where(eq(gigsTable.id, parsed.data.jobId))
      .limit(1)
      .for("share");

    if (!gig) return { kind: "missing_gig" as const };
    if (!gig.employerId) return { kind: "missing_employer" as const };
    if (gig.paymentStatus !== "confirmed") return { kind: "unavailable_gig" as const };
    if (gig.employerId === user.id) return { kind: "self_application" as const };

    // A repeated submit from a double tap or a retried network request should
    // not create duplicate rows or duplicate realtime notifications.
    const [existing] = await tx
      .select()
      .from(applicationsTable)
      .where(
        and(
          eq(applicationsTable.jobId, parsed.data.jobId),
          eq(applicationsTable.workerId, user.id),
        ),
      )
      .orderBy(desc(applicationsTable.createdAt))
      .limit(1);
    if (existing && existing.status !== "ditolak") {
      return { kind: "existing" as const, row: existing, gig };
    }
    if (!hasCompleteWorkerProfile(user.profile)) {
      return { kind: "incomplete_profile" as const };
    }

    const questions = gig.applicationQuestions ?? [];
    const allowedQuestionIds = new Set(questions.map((question) => question.id));
    if (Object.keys(parsed.data.applicationAnswers).some((id) => !allowedQuestionIds.has(id))) {
      return { kind: "invalid_answers" as const };
    }
    for (const question of questions) {
      const answer = parsed.data.applicationAnswers[question.id] ?? "";
      const isUploadQuestion = question.answerType === "photo" || question.answerType === "file";
      if (isUploadQuestion) {
        // Jawabannya berupa berkas, bukan teks.
        if (answer.trim()) return { kind: "invalid_answers" as const };
        continue;
      }
      if (question.required && !answer.trim()) {
        return { kind: "required_answers" as const };
      }
      if (question.answerType === "yes_no" && answer && answer !== "ya" && answer !== "tidak") {
        return { kind: "invalid_answers" as const };
      }
    }

    const uploadRows = parsed.data.uploadIds.length > 0
      ? await tx
          .select()
          .from(applicationUploadsTable)
          .where(and(
            inArray(applicationUploadsTable.id, parsed.data.uploadIds),
            eq(applicationUploadsTable.workerId, user.id),
            eq(applicationUploadsTable.jobId, parsed.data.jobId),
            eq(applicationUploadsTable.uploaded, true),
            isNull(applicationUploadsTable.applicationId),
          ))
          .for("update")
      : [];
    if (uploadRows.length !== parsed.data.uploadIds.length) {
      return { kind: "invalid_uploads" as const };
    }

    // Syarat foto/file dari perekrut: berkas harus menunjuk pertanyaan yang benar, maksimal satu per syarat,
    // dan semua syarat wajib harus terpenuhi.
    const uploadQuestions = questions.filter((q) => q.answerType === "photo" || q.answerType === "file");
    const perQuestion = new Map<string, number>();
    for (const upload of uploadRows) {
      if (!upload.questionId) continue;
      const q = uploadQuestions.find((x) => x.id === upload.questionId);
      if (!q || q.answerType !== upload.kind) return { kind: "invalid_uploads" as const };
      perQuestion.set(q.id, (perQuestion.get(q.id) ?? 0) + 1);
    }
    if ([...perQuestion.values()].some((n) => n > 1)) return { kind: "invalid_uploads" as const };
    if (uploadQuestions.some((q) => q.required && !perQuestion.has(q.id))) {
      return { kind: "required_documents" as const };
    }

    // Berkas tanpa questionId = dokumen generik (CV/portofolio/file/foto); yang bertaut ke pertanyaan
    // tidak boleh dihitung memenuhi syarat dokumen generik.
    const uploadedKinds = new Set(uploadRows.filter((upload) => !upload.questionId).map((upload) => upload.kind));
    const requestedDocuments = gig.requestedApplicationDocuments ?? [];
    const needsProfileDocuments =
      gig.hiringMode !== "cepat" ||
      requestedDocuments.includes("cv") ||
      requestedDocuments.includes("portfolio");
    const [profileUser] = needsProfileDocuments
      ? await tx
          .select({
            defaultCvUrl: usersTable.defaultCvUrl,
            defaultPortfolioUrl: usersTable.defaultPortfolioUrl,
          })
          .from(usersTable)
          .where(eq(usersTable.id, user.id))
          .limit(1)
      : [];
    const hasRequestedDocument = (kind: string, profileUrl?: string | null) =>
      uploadedKinds.has(kind) || !!profileUrl;
    if (
      (requestedDocuments.includes("cv") && !hasRequestedDocument("cv", profileUser?.defaultCvUrl)) ||
      (requestedDocuments.includes("portfolio") && !hasRequestedDocument("portfolio", profileUser?.defaultPortfolioUrl)) ||
      (requestedDocuments.includes("file") && !uploadedKinds.has("file")) ||
      (requestedDocuments.includes("photo") && !uploadedKinds.has("photo"))
    ) {
      return { kind: "required_documents" as const };
    }

    const isRegular = gig.hiringMode !== "cepat";
    let submittedCvUrl = parsed.data.submittedCvUrl;
    let submittedPortfolioUrl = parsed.data.submittedPortfolioUrl;

    if (isRegular) {
      if (!submittedCvUrl && !uploadedKinds.has("cv")) {
        submittedCvUrl = profileUser?.defaultCvUrl ?? undefined;
      }
      if (!submittedPortfolioUrl && !uploadedKinds.has("portfolio")) {
        submittedPortfolioUrl = profileUser?.defaultPortfolioUrl ?? undefined;
      }
    }

    const {
      applicationAnswers,
      supportingInfo,
      uploadIds: _uploadIds,
      ...applicationData
    } = parsed.data;
    const [row] = await tx
      .insert(applicationsTable)
      .values({
        ...applicationData,
        jobTitle: gig.title,
        submittedCvUrl: isRegular ? submittedCvUrl : undefined,
        submittedPortfolioUrl: isRegular ? submittedPortfolioUrl : undefined,
        applicationQuestions: questions,
        applicationAnswers,
        supportingInfo,
        workerId: user.id,
        employerId: gig.employerId,
        status: "baru",
      })
      .returning();
    if (!row) return { kind: "insert_failed" as const };

    if (uploadRows.length > 0) {
      await tx
        .update(applicationUploadsTable)
        .set({ applicationId: row.id })
        .where(inArray(applicationUploadsTable.id, uploadRows.map((upload) => upload.id)));
    }

    await tx.insert(notificationsTable).values({
      userId: gig.employerId,
      message: `${row.workerName || "Seorang pekerja"} baru saja melamar lowongan ${row.jobTitle || "Anda"}`,
      type: "application",
      jobId: row.jobId,
      applicationId: row.id,
    });

    return {
      kind: "created" as const,
      row,
      gig,
      uploadedFiles: uploadRows.map(toApplicationAttachment),
    };
  });

  if (result.kind === "unavailable_gig") {
    res.status(404).json({ error: "Lowongan belum tersedia untuk menerima lamaran." });
    return;
  }
  if (result.kind === "incomplete_profile") {
    res.status(409).json({ error: "Lengkapi profil pekerja sebelum mengirim lamaran." });
    return;
  }
  if (result.kind === "self_application") {
    res.status(403).json({ error: "Anda tidak dapat melamar lowongan sendiri." });
    return;
  }
  if (result.kind === "invalid_answers") {
    res.status(400).json({ error: "Jawaban lamaran tidak sesuai dengan pertanyaan lowongan." });
    return;
  }
  if (result.kind === "required_answers") {
    res.status(400).json({ error: "Lengkapi semua pertanyaan wajib sebelum mengirim lamaran." });
    return;
  }
  if (result.kind === "invalid_uploads") {
    res.status(400).json({ error: "Satu atau lebih berkas belum valid atau bukan milik Anda." });
    return;
  }
  if (result.kind === "required_documents") {
    res.status(400).json({ error: "Unggah semua dokumen yang diwajibkan perekrut." });
    return;
  }
  if (result.kind === "missing_gig") {
    res.status(404).json({ error: "Lowongan tidak ditemukan di server." });
    return;
  }
  if (result.kind === "missing_employer") {
    res.status(409).json({ error: "Lowongan belum terhubung ke akun perusahaan." });
    return;
  }
  if (result.kind === "insert_failed") {
    res.status(500).json({ error: "Gagal menyimpan lamaran. Silakan coba lagi." });
    return;
  }

  if (result.kind === "existing") {
    const attachmentMap = await getApplicationAttachments([result.row.id]);
    res.json({
      ...result.row,
      hiringMode: result.gig.hiringMode ?? "lama",
      uploadedFiles: attachmentMap.get(result.row.id) ?? [],
      reused: true,
    });
    return;
  }

  // Push only after the application and durable notification commit together.
  broadcastApplication(
    {
      ...result.row,
      hiringMode: result.gig.hiringMode ?? "lama",
      uploadedFiles: result.uploadedFiles,
    },
    result.gig.employerId!,
  );

  if (result.gig.employerId) {
    void notifyByEmail(result.gig.employerId, {
      kind: "applicant",
      applicantName: result.row.workerName,
      jobTitle: result.row.jobTitle || result.gig.title,
      jobId: result.row.jobId,
    });
  }

  req.log.info(
    {
      applicationId: result.row.id,
      jobId: result.row.jobId,
      workerId: result.row.workerId,
      employerId: result.gig.employerId,
    },
    "New job application persisted and delivered",
  );
  res.status(201).json({
    ...result.row,
    hiringMode: result.gig.hiringMode ?? "lama",
    uploadedFiles: result.uploadedFiles,
  });
});

/**
 * Employer fetches their applications.
 *
 * Requires an active session with role "perusahaan". Returns only rows where
 * `employer_id` matches the authenticated user — no other employer's
 * applications are ever returned. An optional `?jobId=` narrows the result
 * further to a single gig.
 */
router.get("/applications/mine", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Endpoint ini hanya tersedia untuk pekerja." });
    return;
  }

  const rows = await db
    .select({
      application: applicationsTable,
      hiringMode: gigsTable.hiringMode,
    })
    .from(applicationsTable)
    .leftJoin(gigsTable, eq(applicationsTable.jobId, gigsTable.id))
    .where(eq(applicationsTable.workerId, user.id))
    .orderBy(desc(applicationsTable.createdAt));
  const attachments = await getApplicationAttachments(rows.map(({ application }) => application.id));

  res.setHeader("Cache-Control", "no-store");
  res.json(
    rows.map(({ application, hiringMode }) => ({
      ...application,
      hiringMode: hiringMode ?? "lama",
      uploadedFiles: attachments.get(application.id) ?? [],
    })),
  );
});

router.get("/applications", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "perusahaan") {
    res.status(403).json({ error: "Hanya pemberi kerja yang dapat melihat lamaran." });
    return;
  }

  const jobId = req.query.jobId ? Number(req.query.jobId) : null;
  const conditions = jobId && !isNaN(jobId)
    ? and(
        eq(applicationsTable.employerId, user.id),
        eq(applicationsTable.jobId, jobId),
      )
    : eq(applicationsTable.employerId, user.id);

  const rows = await db
    .select({
      application: applicationsTable,
      hiringMode: gigsTable.hiringMode,
      workerAvatarUrl: usersTable.avatarUrl,
      workerSkills: usersTable.skills,
    })
    .from(applicationsTable)
    .leftJoin(gigsTable, eq(applicationsTable.jobId, gigsTable.id))
    .leftJoin(usersTable, eq(applicationsTable.workerId, usersTable.id))
    .where(conditions)
    .orderBy(desc(applicationsTable.createdAt));
  const attachments = await getApplicationAttachments(rows.map(({ application }) => application.id));
  const stats = await getWorkerStats(rows.map(({ application }) => application.workerId));
  const favorites = new Set(
    (
      await db
        .select({ workerId: favoriteWorkersTable.workerId })
        .from(favoriteWorkersTable)
        .where(eq(favoriteWorkersTable.employerId, user.id))
    ).map((f) => f.workerId),
  );
  res.setHeader("Cache-Control", "no-store");
  res.json(
    rows.map(({ application, hiringMode, workerAvatarUrl, workerSkills }) => ({
      ...application,
      hiringMode: hiringMode ?? "lama",
      uploadedFiles: attachments.get(application.id) ?? [],
      workerAvatarUrl: workerAvatarUrl ?? null,
      workerSkills: workerSkills ?? [],
      workerStats: stats.get(application.workerId) ?? { ratingAvg: null, ratingCount: 0, completedJobs: 0 },
      isFavorite: favorites.has(application.workerId),
    })),
  );
});

/**
 * Employer updates the status of an application (ditinjau / diterima / ditolak).
 *
 * Row-level ownership is enforced: the update is only applied when `employer_id`
 * matches the session user (or is empty for gigs not yet stored in the DB, e.g.
 * demo seeds). The change is persisted and immediately broadcast so the worker's
 * device can update its notification badge without polling.
 */
const statusBody = z.object({
  status: z.enum(["baru", "ditinjau", "diterima", "ditolak", "selesai"]),
});

router.patch("/applications/:id/status", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "ID lamaran tidak valid." });
    return;
  }
  const parsed = statusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Status tidak valid." });
    return;
  }

  // Siapa yang bertindak: pemilik lowongan, atau anggota tim HR perusahaan itu.
  // HR hanya boleh menandai ditinjau/diterima/ditolak (tidak "selesai"/"baru") dan tidak
  // boleh memutuskan lamarannya sendiri.
  const [ref] = await db
    .select({ employerId: applicationsTable.employerId, workerId: applicationsTable.workerId })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, id))
    .limit(1);
  let actingEmployerId: string | null = null;
  if (ref && user.role === "perusahaan" && ref.employerId === user.id) {
    actingEmployerId = user.id;
  } else if (ref && (await teamCan(user.id, ref.employerId, "applications.decide"))) {
    if (ref.workerId === user.id) {
      res.status(403).json({ error: "Anda tidak dapat memutuskan lamaran Anda sendiri." });
      return;
    }
    if (!["ditinjau", "diterima", "ditolak"].includes(parsed.data.status)) {
      res.status(403).json({ error: "Peran HR hanya boleh menandai lamaran ditinjau, diterima, atau ditolak." });
      return;
    }
    actingEmployerId = ref.employerId;
  }
  if (!actingEmployerId) {
    if (user.role !== "perusahaan") {
      res.status(403).json({ error: "Hanya pemberi kerja atau anggota tim HR yang dapat mengubah status lamaran." });
      return;
    }
    // Tidak ditemukan ATAU bukan milik pemanggil → 404 agar tidak membocorkan keberadaan.
    res.status(404).json({ error: "Lamaran tidak ditemukan." });
    return;
  }

  // Seluruh keputusan (kuota, pendanaan, KYC, transisi) diambil di dalam satu
  // transaksi dengan baris lowongan terkunci, supaya dua permintaan paralel tidak
  // bisa sama-sama lolos batas kuota (audit K1).
  const outcome = await db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ jobId: applicationsTable.jobId })
      .from(applicationsTable)
      .where(and(eq(applicationsTable.id, id), eq(applicationsTable.employerId, actingEmployerId)))
      .limit(1);
    // Tidak ditemukan ATAU bukan milik pemanggil → 404 agar tidak membocorkan keberadaan.
    if (!owned) return { error: "not_found" as const };

    const [gig] = await tx
      .select()
      .from(gigsTable)
      .where(eq(gigsTable.id, owned.jobId))
      .for("update")
      .limit(1);
    const [current] = await tx
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.id, id), eq(applicationsTable.employerId, actingEmployerId)))
      .for("update")
      .limit(1);
    if (!current) return { error: "not_found" as const };

    const prev = current.status;
    const next = parsed.data.status;
    if (next === prev) return { row: current, changed: false as const };

    // Upah sudah cair → status final.
    if (prev === "selesai") return { error: "locked" as const };
    const [credited] = await tx
      .select({ id: walletEntriesTable.id })
      .from(walletEntriesTable)
      .where(and(
        eq(walletEntriesTable.sourceType, "gig_wage"),
        eq(walletEntriesTable.sourceId, String(id)),
      ))
      .limit(1);
    if (credited) return { error: "locked" as const };

    // "selesai" hanya boleh dari "diterima" (pencairan upah ada di release-wage).
    if (next === "selesai" && prev !== "diterima") return { error: "invalid_transition" as const };

    const holdsSlot = prev === "diterima" || prev === "selesai";
    const consumesSlot = next === "diterima" || next === "selesai";
    if (consumesSlot && !holdsSlot) {
      if (!gig || gig.paymentStatus !== "confirmed" || !escrowAllowsPayout(gig.escrowStatus)) {
        return { error: "gig_not_funded" as const };
      }
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(applicationsTable)
        .where(and(
          eq(applicationsTable.jobId, owned.jobId),
          inArray(applicationsTable.status, ["diterima", "selesai"]),
        ));
      if (n >= Math.max(1, gig.kuota ?? 1)) return { error: "quota_full" as const };

      // Hanya pekerja yang lolos KYC yang boleh diterima (dan akhirnya dibayar).
      const [worker] = await tx
        .select({ verificationStatus: usersTable.verificationStatus })
        .from(usersTable)
        .where(eq(usersTable.id, current.workerId))
        .limit(1);
      if (worker?.verificationStatus !== "verified") return { error: "worker_unverified" as const };
    }

    const [updated] = await tx
      .update(applicationsTable)
      .set({ status: next })
      .where(eq(applicationsTable.id, id))
      .returning();
    return { row: updated, changed: true as const };
  });

  if ("error" in outcome) {
    const messages = {
      not_found: [404, "Lamaran tidak ditemukan."],
      locked: [409, "Status tidak dapat diubah karena upah sudah dikreditkan."],
      invalid_transition: [409, "Perubahan status tidak valid."],
      gig_not_funded: [409, "Lowongan belum didanai atau sedang dalam sengketa/refund."],
      quota_full: [409, "Kuota pekerja untuk lowongan ini sudah terpenuhi."],
      worker_unverified: [409, "Pekerja ini belum lolos verifikasi KYC."],
    } as const;
    const [status, error] = messages[outcome.error as keyof typeof messages];
    res.status(status).json({ error });
    return;
  }
  const row = outcome.row;

  broadcastApplicationStatus(row.id, row.status, row.jobId, row.workerId);
  if (outcome.changed && (row.status === "diterima" || row.status === "ditolak")) {
    void notifyByEmail(row.workerId, { kind: "status", status: row.status, jobTitle: row.jobTitle });
  }
  req.log.info(
    { applicationId: row.id, status: row.status, actorId: user.id, onBehalfOf: actingEmployerId !== user.id ? actingEmployerId : undefined },
    "Application status updated",
  );
  res.json(row);
});

export default router;
