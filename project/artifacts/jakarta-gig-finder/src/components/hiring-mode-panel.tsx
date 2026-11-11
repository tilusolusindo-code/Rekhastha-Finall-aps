import { useState, useMemo, useCallback, useEffect } from "react";
import LocationPickerSection from "@/components/location-picker-section";
import {
  Zap, CalendarDays, Lock, LockOpen, Radio, Users, Banknote,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  MapPin, Clock, MessageSquare, ShieldCheck, Briefcase,
  QrCode, XCircle, Sparkles, CreditCard,
  Plus, Trash2,
} from "lucide-react";
import { CustomJob, PaymentType, HiringMode, JobApplicationQuestion, RequestedApplicationDocument, DurasiKontrak, paymentLabels, paymentInputLabels, paymentUnits, durasiKontrakOptions } from "@/types/custom-job";
import { ApplicationNotification, ApplicationStatus, maskName } from "@/types/notification";
import { JobCategory, CANCELLATION_FEE_1HR } from "@/types/escrow";
import { INSTANT_PRICE_BY_CATEGORY, ORIGINAL_PRICE_BY_CATEGORY, SUBSCRIPTION_PRICE_MONTHLY, FREE_APPLICANT_LIMIT, getInstantPrice } from "@/types/monetization";
import {
  createInstantOrder,
  fetchBisnisStatus,
  fetchSubscription,
  subscribePremium,
} from "@/lib/monetization-client";
import { AuthUser } from "@/types/auth";

interface HiringModePanelProps {
  currentUser: AuthUser;
  customJobs: CustomJob[];
  notifications: ApplicationNotification[];
  onJobPosted: (data: Omit<CustomJob, "id" | "type" | "lat" | "lng" | "postedAt"> & { lat?: number; lng?: number }) => Promise<CustomJob>;
  onOpenPayments?: () => void;
  onOpenBisnis: () => void;
  onOpenAttendanceQr: (job: CustomJob) => void;
  onLockEscrow: (jobId: number, escrowAmount: number) => void;
  onDispute: (jobId: number) => void;
  onStatusChange: (notifId: number, status: ApplicationStatus) => void;
  onCancelJob?: (jobId: number, deductFee: boolean) => void;
}

// Named standby Mitra pins shown on the Butuh Cepat broadcast radar
const RADAR_WORKERS = [
  { name: "Ahmad", top: "24%", left: "28%", km: "1.2" },
  { name: "Rian",  top: "60%", left: "70%", km: "2.4" },
  { name: "Siti",  top: "42%", left: "52%", km: "0.8" },
];

function BroadcastRadar() {
  return (
    <div className="relative mx-auto w-full h-44 rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 overflow-hidden">
      {/* Radar rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="absolute rounded-full border-2 border-orange-400/40"
            style={{
              width: `${i * 72}px`,
              height: `${i * 72}px`,
              animation: "radar-expand 2.2s ease-out infinite",
              animationDelay: `${(i - 1) * 0.6}s`,
            }}
          />
        ))}
        <div className="absolute w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-white shadow-lg" />
      </div>

      {/* Named standby worker pins */}
      {RADAR_WORKERS.map(w => (
        <div
          key={w.name}
          className="absolute flex flex-col items-center gap-1 -translate-x-1/2 -translate-y-1/2"
          style={{ top: w.top, left: w.left }}
        >
          <div className="w-7 h-7 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center text-[11px] font-black text-emerald-700 shadow-md">
            {w.name.slice(0, 1)}
          </div>
          <span className="flex items-center gap-0.5 text-[9px] font-bold text-gray-800 bg-white/95 px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">
            <ShieldCheck className="w-2.5 h-2.5 text-emerald-600 shrink-0" /> {w.name} · {w.km} km
          </span>
        </div>
      ))}

      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-orange-700 bg-white/85 px-2 py-0.5 rounded-full whitespace-nowrap">
        📡 Mitra standby terdekat: Ahmad · Rian · Siti
      </div>
    </div>
  );
}

type BroadcastState = "idle" | "locking" | "broadcasting";

function formatRp(n: number) {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

// Simulated worker distances for demo applicants
const DEMO_KM: Record<string, number> = {};
function getDemoKm(name: string): number {
  if (!DEMO_KM[name]) DEMO_KM[name] = +(0.5 + Math.random() * 4.5).toFixed(1);
  return DEMO_KM[name];
}

export default function HiringModePanel({
  currentUser, customJobs, notifications,
  onJobPosted, onOpenPayments, onOpenBisnis, onOpenAttendanceQr, onLockEscrow, onDispute, onStatusChange, onCancelJob,
}: HiringModePanelProps) {

  // ── Mode toggle ────────────────────────────────────────────────
  const [hiringMode, setHiringMode] = useState<HiringMode>("cepat");

  // ── Form state ────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(true);
  const [posisi, setPosisi] = useState("");
  const [deskripsi, setDeskripsi] = useState("");
  const [pembayaran, setPembayaran] = useState<PaymentType>("per_shift");
  const [nominalRaw, setNominalRaw] = useState("");
  const [kuota, setKuota] = useState("1");
  const [namaPerusahaan, setNamaPerusahaan] = useState(currentUser.name || "");
  const [dresscode, setDresscode] = useState("Bebas rapi");
  const [jobCategory, setJobCategory] = useState<JobCategory>("terampil");
  const [showFeeExplanation, setShowFeeExplanation] = useState(false);
  const [applicationQuestions, setApplicationQuestions] = useState<JobApplicationQuestion[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [questionRequired, setQuestionRequired] = useState(true);
  const [questionType, setQuestionType] = useState<JobApplicationQuestion["answerType"]>("short");
  const [requestedApplicationDocuments, setRequestedApplicationDocuments] = useState<RequestedApplicationDocument[]>([]);

  // ── Posting Reguler (scheduled) extra fields ──────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const [tanggalMulai, setTanggalMulai] = useState("");
  const [jamKerja, setJamKerja] = useState("");
  const [durasiKontrak, setDurasiKontrak] = useState<DurasiKontrak>("harian");
  const [pickerAddress, setPickerAddress] = useState("");
  const [pickerLat, setPickerLat] = useState<number | null>(null);
  const [pickerLng, setPickerLng] = useState<number | null>(null);

  const handleLocationChange = useCallback((lat: number | null, lng: number | null, address: string) => {
    setPickerLat(lat);
    setPickerLng(lng);
    setPickerAddress(address);
  }, []);

  // ── Butuh Cepat state ─────────────────────────────────────────
  const [broadcastState, setBroadcastState] = useState<BroadcastState>("idle");
  const [posting, setPosting] = useState(false);
  const [postingError, setPostingError] = useState("");

  // ── Bisa Lama state ───────────────────────────────────────────
  const [escrowConfirmJobId, setEscrowConfirmJobId] = useState<number | null>(null);
  const [lockedJobIds, setLockedJobIds] = useState<Set<number>>(new Set());
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

  // ── Loophole mitigation state ─────────────────────────────────
  const [lockedAtMap, setLockedAtMap] = useState<Record<number, Date>>({});
  const [cancelConfirmJobId, setCancelConfirmJobId] = useState<number | null>(null);

  // ── Monetization: subscription + Instan Kilat payment state ──────
  const [isPremium, setIsPremium] = useState(false);
  const [isBusinessPremium, setIsBusinessPremium] = useState(false);
  const [businessStatusLoading, setBusinessStatusLoading] = useState(true);
  const [payingInstant, setPayingInstant] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [adminFeeQuote, setAdminFeeQuote] = useState<number | null>(null);
  const [adminFeeListPriceQuote, setAdminFeeListPriceQuote] = useState<number | null>(null);

  useEffect(() => {
    fetchSubscription().then(sub => setIsPremium(sub.isPremium)).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    fetchBisnisStatus()
      .then((status) => {
        if (active) setIsBusinessPremium(status.isPremium);
      })
      .catch(() => {
        if (active) setIsBusinessPremium(false);
      })
      .finally(() => {
        if (active) setBusinessStatusLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/gigs/fee-quote?category=${encodeURIComponent(jobCategory)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as { adminFeeAmount?: number; listPriceAmount?: number };
        if (response.ok && active && typeof result.adminFeeAmount === "number") {
          setAdminFeeQuote(result.adminFeeAmount);
          if (typeof result.listPriceAmount === "number") {
            setAdminFeeListPriceQuote(result.listPriceAmount);
          }
        }
      })
      .catch(() => {
        if (active) {
          setAdminFeeQuote(null);
          setAdminFeeListPriceQuote(null);
        }
      });
    return () => { active = false; };
  }, [jobCategory]);

  const handleSubscribe = async () => {
    setSubscribing(true);
    setPostingError("");
    try {
      await subscribePremium();
      onOpenPayments?.();
    } catch (error) {
      setPostingError(error instanceof Error ? error.message : "Tagihan langganan gagal dibuat.");
    } finally {
      setSubscribing(false);
    }
  };

  // ── Derived calc ──────────────────────────────────────────────
  const nominalNum = parseInt(nominalRaw.replace(/\D/g, "")) || 0;
  const kuotaNum = Math.max(1, parseInt(kuota) || 1);
  const upahPokok = nominalNum * kuotaNum;
  const instantListingPrice = adminFeeQuote ?? getInstantPrice(jobCategory);
  const instantListPrice = adminFeeListPriceQuote ?? ORIGINAL_PRICE_BY_CATEGORY[jobCategory];
  const biayaSistem = instantListingPrice;
  const totalEscrow = upahPokok + biayaSistem;
  const baseValid = posisi.trim().length >= 3 && nominalNum >= 10_000;
  const catatanValid = deskripsi.trim().length > 0;
  const locationValid =
    pickerAddress.trim() !== "" && pickerLat !== null && pickerLng !== null;
  const formValid =
    hiringMode === "cepat"
      ? baseValid && catatanValid && locationValid
      : baseValid && catatanValid && tanggalMulai !== "" && jamKerja.trim() !== "" && locationValid;

  // ── Mode-filtered job lists ───────────────────────────────────
  const cepatJobs = useMemo(() => customJobs.filter(j => j.hiringMode === "cepat"), [customJobs]);
  const lamaJobs  = useMemo(() => customJobs.filter(j => j.hiringMode === "lama"),  [customJobs]);
  const legacyJobs = useMemo(() => customJobs.filter(j => !j.hiringMode),           [customJobs]);

  const handleNominalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    setNominalRaw(raw ? parseInt(raw).toLocaleString("id-ID") : "");
  };

  // ── Submit Instan Kilat ─────────────────────────────────────────
  // The server creates manual-payment records for the wage escrow and the
  // listing fee. Admin confirmation is required before workers see the gig.
  const handleCepatSubmit = async () => {
    if (!formValid || broadcastState !== "idle" || payingInstant) return;
    setBroadcastState("locking");
    setPayingInstant(true);
    setPostingError("");
    try {
      const created = await onJobPosted({
        posisi: posisi.trim(),
        deskripsi: deskripsi.trim() || `Dibutuhkan segera ${posisi} di ${pickerAddress.trim() || "lokasi kerja pilihan"}. Gaji langsung dibayar setelah shift selesai.`,
        pembayaran,
        nominal: nominalNum,
        dresscode,
        kuota: kuotaNum,
        namaPerusahaan,
        hiringMode: "cepat",
        broadcastActive: true,
        escrowStatus: "locked",
        escrowAmount: totalEscrow,
        durasiKontrak,
        jobDate: new Date(), // AUTOMATED DATE — always today for instant broadcasts
        alamat: pickerAddress.trim(),
        lat: pickerLat!,
        lng: pickerLng!,
        jobCategory,
        applicationQuestions,
        requestedApplicationDocuments,
        feeRate: 0,
      });
      await createInstantOrder(created.id, jobCategory);
      resetForm();
      setBroadcastState("idle");
      setFormOpen(false);
      onOpenPayments?.();
    } catch (error) {
      setBroadcastState("idle");
      setPostingError(error instanceof Error ? error.message : "Tagihan Instan Kilat gagal dibuat.");
    } finally {
      setPayingInstant(false);
    }
  };

  // ── Submit Posting Reguler (scheduled marketplace listing) ─────
  const handleLamaSubmit = async () => {
    if (!formValid || posting) return;
    setPosting(true);
    setPostingError("");
    try {
      await onJobPosted({
        posisi: posisi.trim(),
        deskripsi: deskripsi.trim() || `Lowongan ${posisi} untuk kontrak terjadwal.`,
        pembayaran,
        nominal: nominalNum,
        dresscode,
        kuota: kuotaNum,
        namaPerusahaan,
        hiringMode: "lama",
        broadcastActive: false,
        escrowStatus: "pending",
        durasiKontrak,
        jobDate: tanggalMulai ? new Date(tanggalMulai) : undefined,
        jamKerja: jamKerja.trim(),
        alamat: pickerAddress.trim(),
        ...(pickerLat !== null && pickerLng !== null ? { lat: pickerLat, lng: pickerLng } : {}),
        jobCategory,
        applicationQuestions,
        requestedApplicationDocuments,
        feeRate: 0,
      });
      resetForm();
      setFormOpen(false);
      onOpenPayments?.();
    } catch (error) {
      setPostingError(error instanceof Error ? error.message : "Lowongan gagal dibuat.");
    } finally {
      setPosting(false);
    }
  };

  const resetForm = () => {
    setPosisi(""); setDeskripsi(""); setNominalRaw(""); setKuota("1");
    setJobCategory("terampil");
    setApplicationQuestions([]); setQuestionDraft(""); setRequestedApplicationDocuments([]);
    setTanggalMulai(""); setJamKerja(""); setPickerAddress(""); setPickerLat(null); setPickerLng(null);
  };

  const addApplicationQuestion = () => {
    const prompt = questionDraft.trim();
    if (!prompt) return;
    if (applicationQuestions.length >= 10) {
      setPostingError("Maksimal 10 pertanyaan per lowongan.");
      return;
    }
    setApplicationQuestions((questions) => [
      ...questions,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt,
        required: questionRequired,
        answerType: questionType,
      },
    ]);
    setQuestionDraft("");
    setPostingError("");
  };

  const toggleRequestedDocument = (document: RequestedApplicationDocument) => {
    setRequestedApplicationDocuments((documents) =>
      documents.includes(document)
        ? documents.filter((value) => value !== document)
        : [...documents, document],
    );
  };

  // ── Lock escrow for Bisa Lama after candidate selection ────────
  const handleConfirmEscrow = (jobId: number) => {
    const job = customJobs.find(j => j.id === jobId);
    if (!job) return;
    const jumlahHari = job.jumlahHari ?? 1;
    const amount = job.totalWorkerPayout ?? job.nominal * jumlahHari * job.kuota;
    onLockEscrow(jobId, amount);
    setLockedJobIds(prev => new Set([...prev, jobId]));
    setLockedAtMap(prev => ({ ...prev, [jobId]: new Date() }));
    // Accept all "ditinjau" applicants for this job
    notifications
      .filter(n => n.jobId === jobId && n.status === "ditinjau")
      .forEach(n => onStatusChange(n.id, "diterima"));
    setEscrowConfirmJobId(null);
  };

  // ── Cancel job with compensation check ─────────────────────────
  const handleCancelJobConfirm = (jobId: number) => {
    const lockedAt = lockedAtMap[jobId];
    const within1hr = lockedAt
      ? (Date.now() - lockedAt.getTime()) < 3_600_000
      : true; // Cepat jobs are considered always within 1hr for demo
    onCancelJob?.(jobId, within1hr);
    setCancelConfirmJobId(null);
  };

  // ── Applicant sort ─────────────────────────────────────────────
  const sortedApplicants = (jobId: number) => {
    const list = notifications.filter(n => n.jobId === jobId);
    return [...list].sort((a, b) => getDemoKm(a.applicantName) - getDemoKm(b.applicantName));
  };

  const inputCls = "w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl placeholder-gray-400 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400 transition-all";
  const labelCls = "text-xs font-semibold text-gray-700 mb-1 block";

  return (
    <>
    {/* ── Cancel Confirmation Modal ────────────────────────────── */}
    {cancelConfirmJobId !== null && (() => {
      const job = customJobs.find(j => j.id === cancelConfirmJobId);
      const lockedAt = lockedAtMap[cancelConfirmJobId];
      const within1hr = lockedAt
        ? (Date.now() - lockedAt.getTime()) < 3_600_000
        : true;
      return (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <XCircle className="w-6 h-6 text-red-500" />
            </div>
            <div className="text-center">
              <h3 className="font-black text-gray-900">Batalkan Kontrak?</h3>
              <p className="text-sm text-gray-500 mt-1">{job?.posisi}</p>
            </div>
            {within1hr && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
                <p className="text-xs font-bold text-red-800 text-center">⚠️ Kompensasi Pembatalan</p>
                <p className="text-[11px] text-red-700 text-center leading-relaxed">
                  Pembatalan dalam 1 jam pertama mengharuskan pembayaran kompensasi <span className="font-black">Rp {CANCELLATION_FEE_1HR.toLocaleString("id-ID")}</span> kepada pekerja sesuai ketentuan Rekhastha.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleCancelJobConfirm(cancelConfirmJobId)}
                className="flex-1 bg-red-500 text-white font-bold py-3 rounded-xl text-sm hover:bg-red-600 transition-colors">
                {within1hr ? `Batalkan (Rp ${(CANCELLATION_FEE_1HR).toLocaleString("id-ID")} dipotong)` : "Batalkan Kontrak"}
              </button>
              <button
                onClick={() => setCancelConfirmJobId(null)}
                className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl text-sm hover:bg-gray-200 transition-colors">
                Kembali
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    <div className="flex-1 overflow-y-auto bg-gray-50">

      {/* ── Stats row ─────────────────────────────────────────── */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-2xl font-black text-blue-600">{customJobs.length}</p>
          <p className="text-[10px] font-medium text-gray-500 mt-0.5">Lowongan</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-2xl font-black text-violet-600">{notifications.length}</p>
          <p className="text-[10px] font-medium text-gray-500 mt-0.5">Pelamar</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center">
          <p className="text-2xl font-black text-emerald-600">
            {customJobs.filter(j => j.escrowStatus === "locked").length}
          </p>
          <p className="text-[10px] font-medium text-gray-500 mt-0.5">Escrow Aktif</p>
        </div>
      </div>

      {/* ── Mode toggle ───────────────────────────────────────── */}
      <div className="px-4 mb-3">
        <div className="flex bg-white border border-gray-200 p-1 rounded-2xl gap-1 shadow-sm">
          <button
            onClick={() => { setHiringMode("cepat"); setBroadcastState("idle"); setFormOpen(true); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-xl transition-all ${
              hiringMode === "cepat"
                ? "bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-md ring-2 ring-amber-400/70"
                : "text-gray-500 hover:text-emerald-700"
            }`}>
            <Zap className={`w-3.5 h-3.5 ${hiringMode === "cepat" ? "text-amber-300" : ""}`} />
            ⚡ Broadcast Instan
          </button>
          <button
            onClick={() => { setHiringMode("lama"); setBroadcastState("idle"); setFormOpen(true); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-xl transition-all ${
              hiringMode === "lama"
                ? "bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-md ring-2 ring-amber-400/70"
                : "text-gray-500 hover:text-emerald-700"
            }`}>
            <CalendarDays className={`w-3.5 h-3.5 ${hiringMode === "lama" ? "text-amber-300" : ""}`} />
            📅 Posting Reguler
          </button>
        </div>
        {/* Mode description pill */}
        <div className={`mt-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed font-medium border ${
          hiringMode === "cepat"
            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : "bg-emerald-50/60 text-emerald-800 border-emerald-200"
        }`}>
          {hiringMode === "cepat"
            ? `🚨 Untuk kebutuhan mendesak. Sistem broadcast ke pekerja aktif dalam radius 5km setelah admin mengonfirmasi transfer. Biaya admin flat ${instantListingPrice === 0 ? "diwaive" : formatRp(instantListingPrice)} — bukan potongan dari upah.`
            : `📅 Untuk kontrak terencana & terjadwal. Biaya admin flat ${instantListingPrice === 0 ? "diwaive" : formatRp(instantListingPrice)}. Lowongan aktif setelah transfer upah dan biaya admin dikonfirmasi.`}
        </div>
      </div>

      {/* ── Posting form ─────────────────────────────────────── */}
      <div className="px-4 mb-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Form header */}
          <button
            onClick={() => setFormOpen(o => !o)}
            className={`w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 ${
              hiringMode === "cepat" ? "bg-gradient-to-r from-orange-500 to-amber-500" : "bg-gradient-to-r from-blue-600 to-indigo-600"
            }`}>
            <div className="flex items-center gap-2 text-white">
              {hiringMode === "cepat" ? <Radio className="w-4 h-4" /> : <Briefcase className="w-4 h-4" />}
              <span className="text-sm font-bold">
                {hiringMode === "cepat" ? "Broadcast Instan" : "Posting Lowongan Terjadwal"}
              </span>
            </div>
            {formOpen ? <ChevronUp className="w-4 h-4 text-white" /> : <ChevronDown className="w-4 h-4 text-white" />}
          </button>

          {formOpen && (
            <div className="p-4 space-y-3">
              {/* Pending manual-payment banner */}
              {/* Broadcasting animation */}
              {broadcastState === "broadcasting" && (
                <>
                  <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 animate-pulse">
                    <Radio className="w-5 h-5 text-amber-600 shrink-0 animate-spin" />
                    <div>
                      <p className="text-sm font-bold text-amber-800">Sedang Broadcast...</p>
                      <p className="text-xs text-amber-700">Menjangkau pekerja aktif dalam radius 5km</p>
                    </div>
                  </div>
                  <BroadcastRadar />
                </>
              )}

              {/* Locking animation */}
              {broadcastState === "locking" && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-3 animate-pulse">
                  <Lock className="w-5 h-5 text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-blue-800">Mengunci Escrow...</p>
                    <p className="text-xs text-blue-700">Memverifikasi dana dan mengunci ke rekening Rekhastha</p>
                  </div>
                </div>
              )}

              {broadcastState === "idle" && (
                <>
                  {postingError && (
                    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      {postingError}
                    </p>
                  )}
                  <div>
                    <label className={labelCls}>Nama Posisi / Pekerjaan *</label>
                    <input value={posisi} onChange={e => setPosisi(e.target.value)}
                      placeholder="cth: Barista, Warehouse Helper, Event Crew"
                      className={inputCls} />
                  </div>

                  {/* ── Kategori Pekerjaan ── */}
                  <div>
                    <label className={labelCls}>Kategori Pekerjaan *</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(Object.entries(INSTANT_PRICE_BY_CATEGORY) as [JobCategory, number][]).map(([cat, price]) => {
                        const categoryLabels: Record<JobCategory, { name: string; desc: string }> = {
                          umum:        { name: "Umum / Manual",       desc: "Pindahan, bersih, packing" },
                          terampil:    { name: "Terampil / Teknis",   desc: "Listrik, sopir, katering" },
                          profesional: { name: "Profesional",         desc: "IT, akuntansi, medis" },
                        };
                        const active = jobCategory === cat;
                        return (
                          <button
                            key={cat} type="button"
                            onClick={() => setJobCategory(cat)}
                            className={`p-2 rounded-xl border text-left transition-all ${
                              active
                                ? "bg-primary text-white border-primary shadow-sm ring-2 ring-primary/30"
                                : "bg-white text-gray-700 border-gray-200 hover:border-primary/40"
                            }`}
                          >
                            <p className={`text-[10px] font-bold leading-tight ${active ? "text-white" : ""}`}>{categoryLabels[cat].name}</p>
                            <p className={`text-[9px] mt-0.5 leading-tight ${active ? "text-white/70" : "text-gray-400"}`}>{categoryLabels[cat].desc}</p>
                            <p className={`text-xs font-black mt-1 ${active ? "text-amber-300" : "text-primary"}`}>
                              <span className={cat === jobCategory ? "line-through opacity-60 text-[10px] mr-1" : "line-through opacity-50 text-[10px] mr-1"}>
                                {formatRp(ORIGINAL_PRICE_BY_CATEGORY[cat])}
                              </span>
                              {cat === jobCategory && instantListingPrice === 0 ? "Diwaive" : formatRp(price)}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    {/* ── Price preview card for selected category ── */}
                    {(() => {
                      const categoryLabels: Record<JobCategory, { name: string; desc: string; examples: string }> = {
                        umum:        { name: "Umum / Manual",       desc: "Pindahan, bersih, packing",     examples: "Kuli angkut, petugas kebersihan, packing gudang" },
                        terampil:    { name: "Terampil / Teknis",   desc: "Listrik, sopir, katering",      examples: "Teknisi listrik, sopir, juru masak, barista" },
                        profesional: { name: "Profesional",         desc: "IT, akuntansi, medis",          examples: "Programmer, akuntan, tenaga medis, legal" },
                      };
                      const info = categoryLabels[jobCategory];
                      return (
                        <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                          <Banknote className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-amber-900 leading-tight">
                              {info.name} —{" "}
                              <>
                                <span className="line-through text-amber-600/70 mr-1">{formatRp(instantListPrice)}</span>
                                Harga promo <span className="text-primary font-black">{instantListingPrice === 0 ? "Diwaive" : formatRp(instantListingPrice)}</span>
                              </>
                            </p>
                            <p className="text-[10px] text-amber-700 leading-tight mt-0.5">{info.examples}</p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Kenapa berbeda? ── */}
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => setShowFeeExplanation(o => !o)}
                        className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-semibold underline underline-offset-2"
                      >
                        Rincian harga posting
                        {showFeeExplanation ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {showFeeExplanation && (
                        <div className="mt-1.5 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 space-y-1.5">
                          <p className="text-[10px] font-bold text-blue-900">Harga normal untuk semua kategori adalah Rp75.000, dengan harga promo Rp50.000. Biaya berlaku untuk posting Reguler maupun Instan Kilat; biaya dapat diwaive selama masa uji coba atau langganan aktif.</p>
                          <ul className="space-y-1">
                            <li className="flex items-start gap-1.5 text-[10px] text-blue-800 leading-relaxed">
                              <span className="font-black text-primary shrink-0">{formatRp(ORIGINAL_PRICE_BY_CATEGORY.umum)} → {formatRp(INSTANT_PRICE_BY_CATEGORY.umum)}</span>
                              <span><span className="font-semibold">Umum / Manual</span> — Harga normal → harga promo.</span>
                            </li>
                            <li className="flex items-start gap-1.5 text-[10px] text-blue-800 leading-relaxed">
                              <span className="font-black text-primary shrink-0">{formatRp(ORIGINAL_PRICE_BY_CATEGORY.terampil)} → {formatRp(INSTANT_PRICE_BY_CATEGORY.terampil)}</span>
                              <span><span className="font-semibold">Terampil / Teknis</span> — Harga normal → harga promo.</span>
                            </li>
                            <li className="flex items-start gap-1.5 text-[10px] text-blue-800 leading-relaxed">
                              <span className="font-black text-primary shrink-0">{formatRp(ORIGINAL_PRICE_BY_CATEGORY.profesional)} → {formatRp(INSTANT_PRICE_BY_CATEGORY.profesional)}</span>
                              <span><span className="font-semibold">Profesional</span> — Harga normal → harga promo.</span>
                            </li>
                          </ul>
                          <p className="text-[9px] text-blue-600 leading-relaxed border-t border-blue-200 pt-1.5">
                            🟢 Pekerja selalu menerima 100% upah penuh — biaya posting flat dibayar terpisah oleh perusahaan.
                          </p>
                        </div>
                      )}
                    </div>

                    <p className="text-[10px] text-gray-400 mt-1">
                      {hiringMode === "cepat" ? "Biaya admin flat + upah ditransfer perusahaan · pekerja terima 100% upah" : "Upah + biaya admin flat ditransfer perusahaan · pekerja terima 100% upah"}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Tipe Pembayaran</label>
                      <select value={pembayaran} onChange={e => setPembayaran(e.target.value as PaymentType)}
                        className={inputCls}>
                        {(Object.entries(paymentLabels) as [PaymentType, string][]).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Jumlah Pekerja</label>
                      <input type="number" min="1" max="50" value={kuota}
                        onChange={e => setKuota(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>
                      {paymentInputLabels[pembayaran]} *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">Rp</span>
                      <input value={nominalRaw} onChange={handleNominalChange}
                        placeholder="cth: 150.000"
                        className={`${inputCls} pl-10`} />
                    </div>
                  </div>
                   {/* ── Broadcast Instan: short urgent note + automatic date ── */}
                  {hiringMode === "cepat" && (
                    <>
                      <div>
                        <label className={labelCls}>Catatan Singkat / Syarat Mendesak * (Maks 150 Karakter)</label>
                        <textarea value={deskripsi}
                          onChange={e => setDeskripsi(e.target.value.slice(0, 150))}
                          maxLength={150}
                          placeholder="cth: Butuh cepat untuk angkat barang gudang, wajib sepatu tertutup & kaos hitam. Langsung datang!"
                          rows={2} className={`${inputCls} resize-none`} />
                        <p className="text-[10px] text-gray-400 text-right mt-0.5">{deskripsi.length}/150</p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 py-2">
                        <CalendarDays className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="text-[10px] font-bold text-emerald-800 leading-tight">
                          Tanggal kerja hari ini otomatis. Tentukan lokasi penempatan di peta.
                        </span>
                      </div>
                    </>
                  )}

                  {/* ── Posting Reguler: schedule + address + full description ── */}
                  {hiringMode === "lama" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>Tanggal Mulai Kerja *</label>
                          <input type="date" value={tanggalMulai} min={todayStr}
                            onChange={e => setTanggalMulai(e.target.value)}
                            className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>Jam Kerja / Shift *</label>
                          <input value={jamKerja} onChange={e => setJamKerja(e.target.value)}
                            placeholder="cth: 08:00 - 17:00 WIB"
                            className={inputCls} />
                        </div>
                      </div>

                      {/* Durasi / Tipe Kontrak */}
                      <div>
                        <label className={labelCls}>Durasi / Tipe Kontrak *</label>
                        <div className="grid grid-cols-2 gap-2">
                          {durasiKontrakOptions.map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setDurasiKontrak(opt.value as DurasiKontrak);
                                // Kalau kontrak bulanan, set pembayaran ke per_bulan otomatis
                                if (opt.value !== "harian") setPembayaran("per_bulan");
                                else setPembayaran("per_shift");
                              }}
                              className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                                durasiKontrak === opt.value
                                  ? "border-primary bg-primary/5 text-primary"
                                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                              }`}
                            >
                              <div className="font-bold">{opt.label}</div>
                              {opt.value === "harian" && (
                                <div className="text-[10px] text-gray-400 mt-0.5">Bayar per shift · PPh 21 saja (exempt ≤ Rp 450rb/hari)</div>
                              )}
                              {opt.value !== "harian" && (
                                <div className="text-[10px] text-gray-400 mt-0.5">Bayar per bulan · PPh 21 + BPJS lengkap</div>
                              )}
                            </button>
                          ))}
                        </div>
                        {durasiKontrak !== "harian" && (
                          <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 space-y-1">
                            <p className="text-[11px] text-blue-700 font-semibold">Kontrak Bulanan — Kewajiban Pajak & BPJS</p>
                            <p className="text-[10px] text-blue-600 leading-relaxed">
                              Nominal diisi sebagai <b>gaji per bulan (bruto)</b>. Sistem pembayaran otomatis beralih ke <b>Per Bulan</b>.
                            </p>
                            <ul className="text-[10px] text-blue-600 leading-relaxed list-disc list-inside space-y-0.5">
                              <li>PPh 21 progresif (dengan biaya jabatan)</li>
                              <li>BPJS Kesehatan 1% pekerja + 4% perusahaan</li>
                              <li>BPJS Ketenagakerjaan: JHT 2%+3,7%, JP 1%+2%</li>
                            </ul>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className={labelCls}>Deskripsi Pekerjaan &amp; Kualifikasi Lengkap *</label>
                        <textarea value={deskripsi} onChange={e => setDeskripsi(e.target.value)}
                          placeholder="cth: Detail Tanggung Jawab: 1. Melakukan rekapitulasi data harian... Kualifikasi: Minimal SMA, jujur, teliti..."
                          rows={4} className={`${inputCls} resize-none`} />
                      </div>
                    </>
                  )}

                  <LocationPickerSection
                    inputCls={inputCls}
                    labelCls={labelCls}
                    onLocationChange={handleLocationChange}
                  />

                  <section className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
                    <div>
                      <p className="text-xs font-bold text-gray-800">Pertanyaan &amp; berkas lamaran</p>
                      <p className="mt-0.5 text-[10px] text-gray-500">
                        Pelamar akan mengisi pertanyaan ini dan melampirkan dokumen yang dipilih.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={questionDraft}
                        onChange={(event) => setQuestionDraft(event.target.value.slice(0, 240))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addApplicationQuestion();
                          }
                        }}
                        placeholder="Contoh: Berapa lama pengalaman Anda?"
                        className={`${inputCls} min-w-0`}
                      />
                      <button
                        type="button"
                        onClick={addApplicationQuestion}
                        disabled={!questionDraft.trim()}
                        aria-label="Tambah pertanyaan"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        aria-label="Jenis jawaban"
                        value={questionType}
                        onChange={(event) => setQuestionType(event.target.value as JobApplicationQuestion["answerType"])}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px]"
                      >
                        <option value="short">Jawaban singkat</option>
                        <option value="long">Jawaban panjang</option>
                        <option value="yes_no">Ya / Tidak</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                        <input
                          type="checkbox"
                          checked={questionRequired}
                          onChange={(event) => setQuestionRequired(event.target.checked)}
                        />
                        Wajib dijawab
                      </label>
                    </div>

                    {applicationQuestions.length > 0 && (
                      <ul className="space-y-1.5">
                        {applicationQuestions.map((question, index) => (
                          <li key={question.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                            <span className="min-w-0 flex-1 text-[11px] text-gray-700">
                              {index + 1}. {question.prompt}
                              {question.required && <span className="ml-1 font-bold text-red-500">*</span>}
                            </span>
                            <button
                              type="button"
                              onClick={() => setApplicationQuestions((items) => items.filter((item) => item.id !== question.id))}
                              aria-label={`Hapus pertanyaan ${index + 1}`}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="border-t border-gray-100 pt-2">
                      <p className="mb-2 text-[11px] font-semibold text-gray-700">Dokumen yang diminta</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ["cv", "CV / resume"],
                          ["portfolio", "Portofolio"],
                          ["file", "Dokumen pendukung"],
                          ["photo", "Foto"],
                        ] as [RequestedApplicationDocument, string][]).map(([kind, label]) => (
                          <label key={kind} className="flex items-center gap-2 text-[11px] text-gray-600">
                            <input
                              type="checkbox"
                              checked={requestedApplicationDocuments.includes(kind)}
                              onChange={() => toggleRequestedDocument(kind)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[10px] text-gray-400">
                        CV/portofolio tersimpan di profil pelamar dapat digunakan sebagai pengganti unggahan baru.
                      </p>
                    </div>
                  </section>
                </>
              )}

              {/* ── Rincian Biaya (flat-rate model) ──────────────── */}
              {nominalNum > 0 && broadcastState === "idle" && (
                <div className={`rounded-xl border p-3 space-y-2 ${
                  hiringMode === "cepat" ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Banknote className={`w-4 h-4 ${hiringMode === "cepat" ? "text-orange-600" : "text-blue-600"}`} />
                    <span className={`text-xs font-bold ${hiringMode === "cepat" ? "text-orange-800" : "text-blue-800"}`}>
                      Rincian Biaya Posting
                    </span>
                    <span className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800">
                      {instantListingPrice === 0 ? "DIWAIVE" : formatRp(instantListingPrice)}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-gray-700">
                      <span>Upah Bersih Pekerja ({kuotaNum} orang)</span>
                      <span className="font-semibold text-emerald-700">{formatRp(upahPokok)}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Biaya Admin Flat ({jobCategory})</span>
                      <span className="font-semibold">{instantListingPrice === 0 ? "Diwaive" : formatRp(instantListingPrice)}</span>
                    </div>
                    <p className="text-[10px] text-emerald-700/80 leading-relaxed pt-0.5">
                      🟢 Pekerja menerima 100% upah utuh. Biaya admin flat ditagihkan sekali ke perusahaan dan tidak memotong upah.
                    </p>
                  </div>
                  {/* Status badge */}
                  <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 mt-1 ${
                    hiringMode === "cepat" ? "bg-orange-100" : "bg-blue-100"
                  }`}>
                    {hiringMode === "cepat"
                      ? <LockOpen className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                      : <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                    <span className={`text-[10px] font-bold ${
                      hiringMode === "cepat" ? "text-orange-800" : "text-blue-800"
                    }`}>
                      Status: ⏳ Menunggu Pembayaran &amp; Konfirmasi Admin
                    </span>
                  </div>
                  {/* Tax footnote */}
                  <p className="text-[10px] text-gray-400 italic leading-relaxed border-t border-dashed border-gray-200 pt-1.5 mt-1">
                    *Catatan: Segala kewajiban perpajakan atas transaksi ini menjadi tanggung jawab mandiri masing-masing pihak sesuai hukum yang berlaku.
                  </p>
                </div>
              )}

              {/* Submit button */}
              {broadcastState === "idle" && (
                hiringMode === "cepat" ? (
                  <button
                    onClick={handleCepatSubmit}
                    disabled={!formValid || payingInstant}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${
                      formValid
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md active:scale-[0.98]"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}>
                    <CreditCard className="w-4 h-4" />
                    {payingInstant ? "Membuat tagihan…" : formValid ? "Buat Lowongan & Lanjut ke Transfer Manual" : "Isi Posisi & Upah untuk Lanjut"}
                  </button>
                ) : (
                  <button
                    onClick={handleLamaSubmit}
                    disabled={!formValid || posting}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${
                      formValid
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md active:scale-[0.98]"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}>
                    <Briefcase className="w-4 h-4" />
                    {posting ? "Membuat tagihan…" : formValid ? "Buat Lowongan & Lanjut ke Transfer Manual" : "Isi Posisi & Upah untuk Lanjut"}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Job list (mode-filtered) ───────────────────────────── */}
      <div className="px-4 pb-28 space-y-3">

        {/* Section label */}
        {customJobs.length > 0 && (
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            {hiringMode === "cepat" ? `⚡ Lowongan Broadcast Instan (${cepatJobs.length})` : `📅 Lowongan Posting Reguler (${lamaJobs.length})`}
          </p>
        )}

        {/* Bisa Lama: sort control */}

        {/* Job cards */}
        {(hiringMode === "cepat" ? cepatJobs : himaJobs(lamaJobs, legacyJobs, hiringMode)).map(job => {
          const applicants = sortedApplicants(job.id);
          const pending  = applicants.filter(n => n.status === "ditinjau").length;
          const accepted = applicants.filter(n => n.status === "diterima" || n.status === "selesai").length;
          const isJobLocked = job.escrowStatus === "locked" || lockedJobIds.has(job.id);
          const isCepatJob = job.hiringMode === "cepat";
          const confirmingEscrow = escrowConfirmJobId === job.id;
          const jobExpanded = expandedJobId === job.id;

          return (
            <div key={job.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
              isCepatJob ? "border-orange-100" : "border-blue-100"
            }`}>
              {/* Mode badge strip */}
              <div className={`h-1 ${
                isCepatJob
                  ? "bg-gradient-to-r from-orange-400 to-amber-400"
                  : "bg-gradient-to-r from-blue-500 to-indigo-500"
              }`} />

              <div className="p-4 space-y-3">
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-gray-900 text-sm">{job.posisi}</p>
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${
                        isCepatJob
                          ? "bg-orange-50 text-orange-700 border-orange-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}>
                        {isCepatJob ? "⚡ CEPAT" : "📅 TERJADWAL"}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{job.namaPerusahaan || currentUser.name}</p>
                  </div>
                  {/* Escrow status */}
                  {isJobLocked ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                      <Lock className="w-2.5 h-2.5" /> Escrow Terkunci 🔒
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
                      ⏳ Menunggu Seleksi
                    </span>
                  )}
                </div>

                {/* Pay row */}
                <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Banknote className="w-3 h-3" />
                    {formatRp(job.nominal)} / {paymentUnits[job.pembayaran]}
                  </span>
                  <span>· {job.kuota} orang</span>
                  {isJobLocked && job.escrowAmount ? (
                    <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                      <Lock className="w-3 h-3" /> {formatRp(job.escrowAmount)} di Escrow
                    </span>
                  ) : null}
                  {isCepatJob && job.broadcastActive && (
                    <span className="flex items-center gap-1 text-orange-600 font-semibold animate-pulse">
                      <Radio className="w-3 h-3" /> Broadcast Aktif
                    </span>
                  )}
                </div>

                {/* Lama fee breakdown sub-line */}
                {isJobLocked && !isCepatJob && job.jumlahHari && job.jumlahHari > 1 && (
                  <div className="flex items-center gap-1 text-[10px] text-gray-400 pl-0.5 border-l-2 border-emerald-200 ml-0.5">
                    <span>{formatRp(job.nominal)}/hari × {job.jumlahHari} hari × {job.kuota} orang</span>
                  </div>
                )}

                {/* Applicants row */}
                <button
                  onClick={() => setExpandedJobId(jobExpanded ? null : job.id)}
                  className="w-full flex items-center gap-2 bg-gray-50 hover:bg-gray-100 rounded-xl px-3 py-2 transition-colors">
                  <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-600 flex-1 text-left">
                    {applicants.length > 0 ? `${applicants.length} pelamar` : "Belum ada pelamar"}
                  </span>
                  {pending > 0 && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">{pending} menunggu</span>
                  )}
                  {accepted > 0 && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full">{accepted} diterima</span>
                  )}
                  {applicants.length > 0 && (
                    jobExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  )}
                </button>

                {/* Expanded applicant list (Bisa Lama only) */}
                {jobExpanded && applicants.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {applicants.map((notif, idx) => {
                      const km = getDemoKm(notif.applicantName);
                      const isLocked = !isPremium && idx >= FREE_APPLICANT_LIMIT;
                      return (
                        <div key={notif.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                          notif.status === "diterima" || notif.status === "selesai"
                            ? "bg-emerald-50 border-emerald-200"
                            : "bg-white border-gray-100"
                        }`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-black text-xs shrink-0 ${
                            isLocked ? "bg-gray-300" : "bg-gradient-to-br from-blue-400 to-indigo-500"
                          }`}>
                            {isLocked ? <Lock className="w-3.5 h-3.5" /> : notif.applicantName.slice(0, 1)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold truncate ${isLocked ? "text-gray-400 blur-[2px] select-none" : "text-gray-900"}`}>
                              {isLocked ? "Pelamar Terkunci" : maskName(notif.applicantName)}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {isLocked ? (
                                <span className="text-[10px] font-bold text-amber-700 flex items-center gap-0.5">
                                  <Lock className="w-2.5 h-2.5" /> Perlu Rekhastha Premium
                                </span>
                              ) : (
                                <>
                                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                    <MapPin className="w-2.5 h-2.5" /> {km} km
                                  </span>
                                  {notif.hasNpwp && (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                      <ShieldCheck className="w-2.5 h-2.5" /> Verified Mitra
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {isLocked ? (
                            <button
                              onClick={handleSubscribe}
                              disabled={subscribing}
                              className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1.5 rounded-lg hover:bg-amber-200 transition-colors shrink-0 disabled:opacity-60">
                              🔓 Buka {formatRp(SUBSCRIPTION_PRICE_MONTHLY)}/bln
                            </button>
                          ) : notif.status === "diterima" || notif.status === "selesai" ? (
                            <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1 shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Diterima
                            </span>
                          ) : !isCepatJob && !isJobLocked ? (
                            <button
                              onClick={() => setEscrowConfirmJobId(job.id)}
                              className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors shrink-0">
                              Terima & Kunci Upah
                            </button>
                          ) : (
                            <span className="text-[10px] text-gray-400 shrink-0">Menunggu</span>
                          )}
                        </div>
                      );
                    })}
                    {!isPremium && applicants.length > FREE_APPLICANT_LIMIT && (
                      <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-center">
                        Menampilkan {FREE_APPLICANT_LIMIT} dari {applicants.length} pelamar secara gratis. Berlangganan Rekhastha Premium untuk melihat semua.
                      </p>
                    )}
                  </div>
                )}

                {/* Bisa Lama: escrow confirmation inline */}
                {confirmingEscrow && !isJobLocked && (() => {
                  const confirmDays    = job.jumlahHari ?? 1;
                  const confirmBase    = job.totalWorkerPayout ?? job.nominal * confirmDays * job.kuota;
                  const confirmFee     = job.adminFeeAmount ?? 0;
                  const confirmTotal   = confirmBase + confirmFee;
                  const confirmIsFree  = confirmFee === 0;
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        <span className="text-xs font-bold text-blue-900">Konfirmasi Penguncian Upah</span>
                        <span className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-full ${
                          confirmIsFree ? "bg-emerald-200 text-emerald-800" : "bg-blue-200 text-blue-800"
                        }`}>
                          {confirmIsFree ? "BIAYA DIWAIVE" : "TERMASUK TAGIHAN"}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-[11px]">
                        <div className="flex justify-between text-gray-700">
                          <span>Upah Bersih Pekerja ({job.kuota} orang{confirmDays > 1 ? ` × ${confirmDays} hari` : ""})</span>
                          <span className="font-semibold text-emerald-700">{formatRp(confirmBase)}</span>
                        </div>
                        {confirmDays > 1 && (
                          <div className="flex justify-between text-gray-500 text-[10px] pl-2 border-l-2 border-emerald-200">
                            <span>{formatRp(job.nominal)}/hari × {confirmDays} hari × {job.kuota} orang</span>
                            <span>= {formatRp(confirmBase)}</span>
                          </div>
                        )}
                        {!confirmIsFree && (
                          <div className="flex justify-between text-gray-600">
                            <span>Biaya admin flat (sudah ditagihkan)</span>
                            <span className="font-semibold">{formatRp(confirmFee)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-blue-900 border-t border-blue-200 pt-1.5 text-xs">
                          <span>Total Dana yang Dikunci</span>
                          <span>{formatRp(confirmTotal)}</span>
                        </div>
                        <p className="text-[10px] text-emerald-700/80 leading-relaxed pt-0.5">
                          🟢 Pekerja menerima 100% upah utuh. Biaya admin terpisah dari escrow upah.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleConfirmEscrow(job.id)}
                          className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]">
                          <Lock className="w-3.5 h-3.5" /> Kunci Sekarang
                        </button>
                        <button onClick={() => setEscrowConfirmJobId(null)}
                          className="px-4 bg-gray-100 text-gray-600 text-xs font-bold py-2 rounded-xl hover:bg-gray-200 transition-colors">
                          Batal
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Use the shared token-backed attendance QR flow. */}
                {isJobLocked && job.escrowStatus !== "disputed" && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (isBusinessPremium) onOpenAttendanceQr(job);
                          else onOpenBisnis();
                        }}
                        disabled={businessStatusLoading}
                        className="flex-1 flex items-center justify-center gap-1.5 border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold py-2 rounded-xl hover:bg-emerald-100 transition-colors disabled:cursor-wait disabled:opacity-60">
                        <QrCode className="w-3.5 h-3.5" />
                        {businessStatusLoading
                          ? "Memeriksa akses..."
                          : isBusinessPremium
                            ? "Tampilkan QR Absensi"
                            : "Lihat Paket Rekhastha Bisnis"}
                      </button>
                      <button onClick={() => onDispute(job.id)}
                        className="flex-1 flex items-center justify-center gap-2 border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold py-2 rounded-xl hover:bg-amber-100 transition-colors">
                        <AlertTriangle className="w-3.5 h-3.5" /> Ajukan Sengketa
                      </button>
                    </div>
                    {/* Cancellation button */}
                    <button
                      onClick={() => setCancelConfirmJobId(job.id)}
                      className="w-full flex items-center justify-center gap-1.5 border border-red-200 bg-red-50 text-red-600 text-xs font-semibold py-2 rounded-xl hover:bg-red-100 transition-colors">
                      <XCircle className="w-3.5 h-3.5" />
                      Batalkan Kontrak {lockedAtMap[job.id] ? "(Kompensasi Berlaku)" : "(Rp20rb jika &lt;1 Jam)"}
                    </button>
                  </div>
                )}
                {job.escrowStatus === "disputed" && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <p className="text-[10px] text-red-600 flex-1">Dana dibekukan · Menunggu resolusi admin Rekhastha</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Legacy jobs (no hiring mode) */}
        {hiringMode === "lama" && legacyJobs.length > 0 && (
          <>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-4">📁 Lowongan Lama</p>
            {legacyJobs.map(job => {
              const applicants = notifications.filter(n => n.jobId === job.id);
              const pending = applicants.filter(n => n.status === "ditinjau").length;
              const accepted = applicants.filter(n => n.status === "diterima" || n.status === "selesai").length;
              return (
                <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{job.posisi}</p>
                      <p className="text-[10px] text-gray-400">{job.namaPerusahaan || currentUser.name}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      job.escrowStatus === "locked" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                      job.escrowStatus === "disputed" ? "bg-red-50 text-red-700 border-red-200" :
                      "bg-gray-50 text-gray-500 border-gray-200"
                    }`}>
                      {job.escrowStatus === "locked" ? "🔒 Dikunci" : job.escrowStatus === "disputed" ? "⚠️ Sengketa" : "⏳ Pending"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 text-xs">
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-gray-600 flex-1">{applicants.length > 0 ? `${applicants.length} pelamar` : "Belum ada pelamar"}</span>
                    {pending > 0 && <span className="text-[10px] font-bold text-amber-600">{pending} menunggu</span>}
                    {accepted > 0 && <span className="text-[10px] font-bold text-emerald-600">{accepted} diterima</span>}
                  </div>
                  {job.escrowStatus === "locked" && (
                    <button onClick={() => onDispute(job.id)}
                      className="w-full border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold py-2 rounded-xl hover:bg-amber-100 transition-colors">
                      Ajukan Sengketa
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Empty state */}
        {customJobs.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
              hiringMode === "cepat" ? "bg-orange-100" : "bg-blue-100"
            }`}>
              {hiringMode === "cepat" ? <Zap className="w-7 h-7 text-orange-500" /> : <CalendarDays className="w-7 h-7 text-blue-600" />}
            </div>
            <div>
              <p className="font-bold text-gray-900">Belum Ada Lowongan</p>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                {hiringMode === "cepat"
                  ? "Isi form di atas lalu kunci escrow untuk broadcast instan ke pekerja terdekat."
                  : "Posting lowongan terjadwal dan pilih kandidat terbaik dari daftar pelamar."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function himaJobs(lamaJobs: CustomJob[], _legacyJobs: CustomJob[], mode: HiringMode): CustomJob[] {
  return mode === "lama" ? lamaJobs : [];
}
