import { useEffect, useRef, useState } from "react";
import {
  ApplicationSupportingInfo, CustomJob, calcTotal, paymentLabels,
  durasiKontrakOptions,
} from "@/types/custom-job";
import { WorkerProfile, isProfileComplete, isVerified } from "@/types/worker-profile";
import { AuthUser } from "@/types/auth";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { uploadApplicationFiles } from "@/lib/central-server";
import {
  Users, FileText, Shirt, Banknote, CheckCircle, ShieldCheck,
  Loader2, MessageSquare, AlertTriangle, Calendar, Building2,
   Upload,
} from "lucide-react";

interface JobSheetProps {
  job: CustomJob | null;
  onClose: () => void;
  workerProfile?: WorkerProfile | null;
  currentUser?: AuthUser | null;
  onApply?: (
    job: CustomJob,
    profile: WorkerProfile,
    application?: {
      applicationAnswers?: Record<string, string>;
      supportingInfo?: ApplicationSupportingInfo;
      uploadIds?: number[];
    },
  ) => void | boolean | Promise<void | boolean>;
  onOpenChat?: (job: CustomJob) => void;
  onReportSuspect?: (jobId: number) => void;
  /** Called when the worker tries to apply without a completed profile — should open onboarding. */
  onRequireProfile?: () => void;
}

function formatRp(value: number): string {
  return "Rp " + value.toLocaleString("id-ID");
}

type ApplyState = "idle" | "sending" | "done";

export default function JobSheet({
  job, onClose, workerProfile, currentUser, onApply, onOpenChat, onReportSuspect, onRequireProfile,
}: JobSheetProps) {
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [applySlow, setApplySlow] = useState(false);
  // Regular jobs and gigs with recruiter requirements collect application data
  // before submission. Instant gigs without requirements retain one-tap apply.
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [docsUploading, setDocsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
  const [docsError, setDocsError] = useState<string | null>(null);
  const [newCvFile, setNewCvFile] = useState<File | null>(null);
  const [newPortfolioFile, setNewPortfolioFile] = useState<File | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [applicationAnswers, setApplicationAnswers] = useState<Record<string, string>>({});
  const [supportingInfo, setSupportingInfo] = useState<ApplicationSupportingInfo>({});
  const cvInputRef = useRef<HTMLInputElement>(null);
  const portfolioInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApplyState("idle");
    setApplySlow(false);
    setShowDocsModal(false);
    setDocsUploading(false);
    setUploadProgress({ completed: 0, total: 0 });
    setDocsError(null);
    setNewCvFile(null);
    setNewPortfolioFile(null);
    setDocumentFiles([]);
    setPhotoFiles([]);
    setApplicationAnswers({});
    setSupportingInfo({});
  }, [job?.id]);

  useEffect(() => {
    const isWaiting = docsUploading || applyState === "sending";
    if (!isWaiting) {
      setApplySlow(false);
      return;
    }
    setApplySlow(false);
    const timer = window.setTimeout(() => setApplySlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [applyState, docsUploading, job?.id]);

  if (!job) return null;

  const total = calcTotal(job.nominal, job.pembayaran);
  const adminFeeAmount = job.adminFeeAmount;
  const workerGets = total;
  const verified = workerProfile ? isVerified(workerProfile) : false;
  const durasiLabel = durasiKontrakOptions.find((o) => o.value === (job.durasiKontrak ?? "harian"))?.label ?? "Harian";
  const isRegular = job.hiringMode !== "cepat";
  const hasProfileDocs = !!(currentUser?.defaultCvUrl || currentUser?.defaultPortfolioUrl);

  const submitApplication = async (application: {
    applicationAnswers?: Record<string, string>;
    supportingInfo?: ApplicationSupportingInfo;
    uploadIds?: number[];
  } = {}): Promise<boolean> => {
    // Guard: without a completed worker profile there is nothing to send to
    // the server, so never fake a "Lamaran Terkirim!" success — that used to
    // silently drop the application (no POST /api/applications was ever
    // made) while the worker saw a green checkmark and the employer never
    // received anything.
    if (!isProfileComplete(workerProfile) || !onApply) {
      setDocsError("Lengkapi profil Anda terlebih dahulu untuk melamar.");
      onRequireProfile?.();
      return false;
    }
    setDocsError(null);
    setApplyState("sending");
    try {
      const accepted = await onApply(job, workerProfile, application);
      if (accepted === false) {
        setApplyState("idle");
        setDocsError("Lamaran belum berhasil dikirim ke server. Periksa koneksi lalu coba lagi.");
        return false;
      }
      setApplyState("done");
      return true;
    } catch (error) {
      setApplyState("idle");
      setDocsError(error instanceof Error
        ? error.message
        : "Lamaran belum berhasil dikirim ke server. Periksa koneksi lalu coba lagi.");
      return false;
    }
  };

  const handleApply = () => {
    if (applyState !== "idle") return;
    if (!isProfileComplete(workerProfile) || !onApply) {
      setDocsError("Lengkapi profil Anda terlebih dahulu untuk melamar.");
      onRequireProfile?.();
      return;
    }
    const hasRecruiterRequirements =
      (job.applicationQuestions?.length ?? 0) > 0 ||
      (job.requestedApplicationDocuments?.length ?? 0) > 0;
    if (isRegular || hasRecruiterRequirements) {
      setShowDocsModal(true);
      return;
    }
    void submitApplication();
  };

  const handleSubmitApplication = async () => {
    const questions = job.applicationQuestions ?? [];
    if (questions.some((question) => question.required && !applicationAnswers[question.id]?.trim())) {
      setDocsError("Jawab semua pertanyaan wajib sebelum mengirim lamaran.");
      return;
    }
    const requested = job.requestedApplicationDocuments ?? [];
    const profileHasCv = !!currentUser?.defaultCvUrl;
    const profileHasPortfolio = !!currentUser?.defaultPortfolioUrl;
    if (
      (requested.includes("cv") && !newCvFile && !profileHasCv) ||
      (requested.includes("portfolio") && !newPortfolioFile && !profileHasPortfolio) ||
      (requested.includes("file") && documentFiles.length === 0) ||
      (requested.includes("photo") && photoFiles.length === 0)
    ) {
      setDocsError("Lengkapi semua dokumen yang diminta perekrut.");
      return;
    }

    const files = [
      ...(newCvFile ? [{ file: newCvFile, kind: "cv" as const }] : []),
      ...(newPortfolioFile ? [{ file: newPortfolioFile, kind: "portfolio" as const }] : []),
      ...documentFiles.map((file) => ({ file, kind: "file" as const })),
      ...photoFiles.map((file) => ({ file, kind: "photo" as const })),
    ];
    if (files.length > 8) {
      setDocsError("Maksimal 8 berkas per lamaran.");
      return;
    }
    if (files.some(({ file }) => file.size > 10 * 1024 * 1024)) {
      setDocsError("Ukuran setiap berkas maksimal 10MB.");
      return;
    }

    setDocsError(null);
    setDocsUploading(true);
    setUploadProgress({ completed: 0, total: files.length });
    try {
      const uploaded = await uploadApplicationFiles(job.id, files, (completed, total) => {
        setUploadProgress({ completed, total });
      });
      setUploadProgress({ completed: 0, total: 0 });
      const success = await submitApplication({
        applicationAnswers: Object.fromEntries(
          Object.entries(applicationAnswers).map(([id, answer]) => [id, answer.trim()]),
        ),
        supportingInfo: Object.fromEntries(
          Object.entries(supportingInfo).map(([key, value]) => [key, value?.trim() ?? ""]),
        ),
        uploadIds: uploaded.map((file) => file.id),
      });
      if (success) setShowDocsModal(false);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : "Gagal mengunggah berkas.");
    } finally {
      setDocsUploading(false);
    }
  };

  return (
    <>
    <Sheet
      open={!!job && !showDocsModal}
      onOpenChange={(open) => {
        if (!open && !showDocsModal) onClose();
      }}
    >
      <SheetContent side="bottom" className="rounded-t-2xl p-6 h-[82vh] sm:h-auto overflow-y-auto">
        <div className="flex flex-col gap-5 pt-4">

          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
              <FileText className="w-7 h-7 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900 leading-tight">{job.posisi}</h2>
                <Badge className="bg-emerald-100 text-emerald-800 border-0 text-xs font-semibold">Lowongan Kustom</Badge>
                <Badge className={`border-0 text-xs font-semibold ${isRegular ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                  {isRegular ? "Reguler" : "Instan"}
                </Badge>
                {job.flaggedSuspect && (
                  <Badge className="bg-yellow-100 text-yellow-700 border-0 text-xs">⚠️ Sedang Ditinjau</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-sm text-gray-500">{job.kuota} orang dibutuhkan</span>
                {job.namaPerusahaan && (
                  <span className="flex items-center gap-1 text-[10px] text-gray-500">
                    <Building2 className="w-3 h-3" /> {job.namaPerusahaan}
                  </span>
                )}
                {job.nibPerusahaan?.length === 13 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3 h-3" /> NIB Terverifikasi
                  </span>
                )}
                {verified && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3 h-3" /> Akun Terverifikasi
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Durasi kontrak */}
          <div className="flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-xl px-4 py-2.5">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <div>
              <p className="text-xs font-semibold text-primary">{durasiLabel}</p>
              <p className="text-[10px] text-gray-500">Biaya admin flat sesuai kategori, dibayar perusahaan</p>
            </div>
          </div>

          {/* Deskripsi */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Deskripsi & Tugas</h3>
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3.5 rounded-xl border border-gray-100">
              {job.deskripsi}
            </p>
          </div>

          {/* Dresscode */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
              <Shirt className="w-4 h-4" /> Persyaratan Pakaian
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3.5 rounded-xl border border-gray-100">
              {job.dresscode}
            </p>
          </div>

          {/* Kalkulasi */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
              <Banknote className="w-4 h-4" /> Kalkulasi Penghasilan Bersih
            </h3>
            <div className="bg-primary/5 border border-primary/10 p-4 rounded-xl space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Sistem Bayaran</span>
                <span className="font-semibold text-gray-900">{paymentLabels[job.pembayaran]}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  Total kotor ({paymentLabels[job.pembayaran]})
                </span>
                <span className="font-medium text-gray-900">{formatRp(total)}</span>
              </div>
              <div className="border-t border-primary/10 pt-2 space-y-1.5">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Biaya admin flat (dibayar terpisah saat posting)</span>
                  <span>{adminFeeAmount == null ? "—" : formatRp(adminFeeAmount)}</span>
                </div>
              </div>
              <div className="flex justify-between border-t border-primary/10 pt-2.5">
                <span className="font-bold text-gray-800">Anda terima bersih (100%)</span>
                <span className="font-bold text-primary text-lg">{formatRp(workerGets)}</span>
              </div>
              <p className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 leading-relaxed">
                Segala kewajiban perpajakan menjadi tanggung jawab mandiri masing-masing pihak sesuai hukum yang berlaku.
              </p>
            </div>
          </div>

          {/* Worker identity */}
          {workerProfile && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-gray-600">Data yang akan dikirim ke perusahaan:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
                {[
                  ["Nama", workerProfile.namaLengkap],
                  ["NIK", `${workerProfile.nik.slice(0, 4)}••••••••${workerProfile.nik.slice(-4)}`],
                  ["NPWP", workerProfile.belumPunyaNpwp ? "Belum ada" : `••••••${workerProfile.npwp.slice(-4)}`],
                  ["Bank", workerProfile.namaBank || "—"],
                ].map(([label, val]) => (
                  <div key={label}>
                    <p className="text-[10px] text-gray-400">{label}</p>
                    <p className="text-xs font-semibold text-gray-800 truncate">{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="pt-1 pb-2 space-y-3">
            {applyState === "idle" && (
              <>
                <button
                  data-testid="button-apply-job"
                  className="w-full bg-primary hover:bg-primary/90 active:scale-[0.98] text-white font-bold py-3.5 rounded-xl text-base transition-all shadow-lg"
                  style={{ boxShadow: "0 4px 16px rgba(6,95,70,0.35)" }}
                  onClick={handleApply}
                >
                  Lamar Pekerjaan Ini
                </button>
                {!isRegular &&
                  !(job.applicationQuestions?.length || job.requestedApplicationDocuments?.length) && (
                    <button
                      type="button"
                      onClick={() => setShowDocsModal(true)}
                      className="w-full text-xs font-semibold text-primary hover:underline"
                    >
                      Tambahkan informasi atau berkas pendukung (opsional)
                    </button>
                  )}
                {docsError && !showDocsModal && (
                  <p className="text-xs font-semibold text-red-500 text-center" data-testid="text-apply-profile-error">
                    {docsError}
                  </p>
                )}
              </>
            )}

            {applyState === "sending" && (
              <div className="w-full bg-primary/10 border border-primary/20 text-primary font-semibold py-3.5 rounded-xl text-sm flex items-center justify-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin" />
                {applySlow ? "Lamaran masih diproses. Jangan refresh halaman..." : "Mengirim data legalitas secara aman..."}
              </div>
            )}

            {applyState === "done" && (
              <div className="space-y-3">
                <div className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl text-sm flex items-center justify-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  Lamaran Terkirim!
                </div>
                {onOpenChat && (
                  <button
                    data-testid="button-open-chat-from-sheet"
                    onClick={() => { onClose(); onOpenChat(job); }}
                    className="w-full flex items-center justify-center gap-2 border-2 border-primary text-primary font-bold py-3 rounded-xl text-sm hover:bg-primary/5 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Buka Chat Aplikasi
                  </button>
                )}
                <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-700 text-center leading-relaxed">
                    Perusahaan akan memvalidasi identitas dan kelengkapan data Anda.
                  </p>
                </div>
              </div>
            )}

            {/* Report suspicious */}
            {onReportSuspect && applyState === "idle" && (
              <button
                data-testid="button-report-suspect"
                onClick={() => { onReportSuspect(job.id); onClose(); }}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-red-500 border border-red-200 bg-red-50 py-2.5 rounded-xl hover:bg-red-100 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Laporkan Lowongan Mencurigakan
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>

      {/* Keep the application dialog outside the sheet root: two simultaneous modal roots can
          trap pointer events and scroll locking. The sheet closes while this dialog is open. */}
      <Dialog
        open={showDocsModal && !!job}
        onOpenChange={(open) => {
          if (!docsUploading) setShowDocsModal(open);
        }}
      >
          <DialogContent
            data-testid="application-form-dialog"
            className="z-[70] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto overscroll-y-contain touch-pan-y rounded-2xl p-5"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-base font-bold text-gray-900">Formulir Lamaran</DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-gray-500">
                  Jawaban dan lampiran ini hanya dapat dilihat oleh Anda dan perekrut pemilik lowongan.
                </DialogDescription>
              </div>
            </div>

            {docsError && <p className="text-xs font-semibold text-red-500">{docsError}</p>}

            {(job.applicationQuestions?.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h4 className="text-xs font-bold text-gray-800">Pertanyaan perekrut</h4>
                {job.applicationQuestions?.map((question) => (
                  <label key={question.id} className="block space-y-1">
                    <span className="block text-xs font-semibold text-gray-700">
                      {question.prompt}
                      {question.required && <span className="ml-1 text-red-500">*</span>}
                    </span>
                    {question.answerType === "yes_no" ? (
                      <select
                        value={applicationAnswers[question.id] ?? ""}
                        onChange={(event) => setApplicationAnswers((answers) => ({ ...answers, [question.id]: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                      >
                        <option value="">Pilih jawaban</option>
                        <option value="ya">Ya</option>
                        <option value="tidak">Tidak</option>
                      </select>
                    ) : question.answerType === "long" ? (
                      <textarea
                        value={applicationAnswers[question.id] ?? ""}
                        onChange={(event) => setApplicationAnswers((answers) => ({ ...answers, [question.id]: event.target.value.slice(0, 4000) }))}
                        maxLength={4000}
                        rows={3}
                        className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <input
                        value={applicationAnswers[question.id] ?? ""}
                        onChange={(event) => setApplicationAnswers((answers) => ({ ...answers, [question.id]: event.target.value.slice(0, 4000) }))}
                        maxLength={4000}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                      />
                    )}
                  </label>
                ))}
              </section>
            )}

            <section className="space-y-2.5">
              <h4 className="text-xs font-bold text-gray-800">Informasi pendukung</h4>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600">Pengalaman kerja</span>
                <textarea
                  value={supportingInfo.experience ?? ""}
                  onChange={(event) => setSupportingInfo((info) => ({ ...info, experience: event.target.value.slice(0, 2000) }))}
                  rows={2}
                  maxLength={2000}
                  placeholder="Jabatan, bidang, dan lama pengalaman"
                  className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600">Pendidikan</span>
                <input
                  value={supportingInfo.education ?? ""}
                  onChange={(event) => setSupportingInfo((info) => ({ ...info, education: event.target.value.slice(0, 500) }))}
                  maxLength={500}
                  placeholder="Pendidikan terakhir / jurusan"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600">Keahlian</span>
                <input
                  value={supportingInfo.skills ?? ""}
                  onChange={(event) => setSupportingInfo((info) => ({ ...info, skills: event.target.value.slice(0, 1000) }))}
                  maxLength={1000}
                  placeholder="Contoh: barista, kasir, Microsoft Excel"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-gray-600">Ketersediaan mulai kerja</span>
                <input
                  value={supportingInfo.availability ?? ""}
                  onChange={(event) => setSupportingInfo((info) => ({ ...info, availability: event.target.value.slice(0, 500) }))}
                  maxLength={500}
                  placeholder="Contoh: langsung, mulai 20 Oktober"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"
                />
              </label>
            </section>

            <section className="border-t border-gray-100 pt-3 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-gray-800">CV dan dokumen pendukung</h4>
                <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                  {hasProfileDocs
                    ? "Jika CV atau portofolio baru tidak dipilih, berkas profil Anda akan digunakan."
                    : "PDF, DOC, DOCX, JPG, PNG, atau WEBP; maksimal 10MB per berkas."}
                </p>
              </div>

              <input ref={cvInputRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
                onChange={(e) => setNewCvFile(e.target.files?.[0] ?? null)} />
              <button
                onClick={() => cvInputRef.current?.click()}
                disabled={docsUploading}
                className="w-full flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-xs font-semibold text-gray-700 truncate">
                  {newCvFile ? newCvFile.name : `Unggah CV baru${job.requestedApplicationDocuments?.includes("cv") ? " · wajib" : " · opsional"}`}
                </span>
              </button>

              <input ref={portfolioInputRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => setNewPortfolioFile(e.target.files?.[0] ?? null)} />
              <button
                onClick={() => portfolioInputRef.current?.click()}
                disabled={docsUploading}
                className="w-full flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-xs font-semibold text-gray-700 truncate">
                  {newPortfolioFile ? newPortfolioFile.name : `Unggah portofolio${job.requestedApplicationDocuments?.includes("portfolio") ? " · wajib" : " · opsional"}`}
                </span>
              </button>

              <input ref={documentInputRef} type="file" multiple accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
                onChange={(event) => setDocumentFiles(Array.from(event.target.files ?? []).slice(0, 8))} />
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                disabled={docsUploading}
                className="w-full flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-xs font-semibold text-gray-700 truncate">
                  {documentFiles.length
                    ? `${documentFiles.length} dokumen dipilih`
                    : `Dokumen pendukung${job.requestedApplicationDocuments?.includes("file") ? " · wajib" : " · opsional"}`}
                </span>
              </button>
              {documentFiles.length > 0 && (
                <p className="text-[10px] text-gray-500">{documentFiles.map((file) => file.name).join(", ")}</p>
              )}

              <input ref={photoInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(event) => setPhotoFiles(Array.from(event.target.files ?? []).slice(0, 8))} />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={docsUploading}
                className="w-full flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-xs font-semibold text-gray-700 truncate">
                  {photoFiles.length
                    ? `${photoFiles.length} foto dipilih`
                    : `Foto${job.requestedApplicationDocuments?.includes("photo") ? " · wajib" : " · opsional"}`}
                </span>
              </button>
              {photoFiles.length > 0 && (
                <p className="text-[10px] text-gray-500">{photoFiles.map((file) => file.name).join(", ")}</p>
              )}

              <button
                data-testid="button-upload-new-docs"
                onClick={handleSubmitApplication}
                disabled={docsUploading || applyState === "sending"}
                className="w-full flex items-center justify-center gap-2 bg-primary text-white font-bold py-3 rounded-xl text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {docsUploading || applyState === "sending" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {docsUploading && uploadProgress.total > 0
                  ? applySlow
                    ? `Unggahan ${uploadProgress.completed}/${uploadProgress.total} masih diproses...`
                    : `Mengunggah berkas ${uploadProgress.completed}/${uploadProgress.total}...`
                  : applyState === "sending"
                    ? applySlow ? "Lamaran masih disimpan..." : "Menyimpan lamaran..."
                    : docsUploading
                      ? applySlow ? "Menyiapkan lamaran lebih lama dari biasanya..." : "Menyiapkan lamaran..."
                      : "Kirim Lamaran"}
              </button>
              </section>
          </DialogContent>
      </Dialog>
    </>
  );
}
