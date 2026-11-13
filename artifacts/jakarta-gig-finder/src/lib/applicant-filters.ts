/** Filter & urutan gaya ATS untuk daftar pelamar (dipakai panel HR; bisa dipakai panel pemilik). */
export interface FilterableApplicant {
  id: number; jobId: number; jobTitle: string; workerName: string; status: string; createdAt: string;
  shortlistedAt?: string | null; clientDecision?: "setuju" | "tidak" | null;
  workerSkills?: string[];
  workerStats?: { ratingAvg: number | null; ratingCount: number; completedJobs: number };
  applicationQuestions?: { id: string; prompt: string; required: boolean; answerType: string }[] | null;
  applicationAnswers?: Record<string, string> | null;
  uploadedFiles?: { questionId?: string | null }[] | null;
  supportingInfo?: Record<string, unknown> | null;
}

export type SortKey = "terbaru" | "rating" | "pengalaman" | "nama";
export interface ApplicantFilters {
  search: string;
  status: string;            // "" = semua
  shortlist: "" | "ya" | "belum";
  klien: "" | "setuju" | "tidak" | "belum";
  jobId: number | null;
  minRating: number;         // 0 = bebas
  minJobs: number;
  syaratLengkap: boolean;
  sort: SortKey;
}
export const EMPTY_FILTERS: ApplicantFilters = {
  search: "", status: "", shortlist: "", klien: "", jobId: null, minRating: 0, minJobs: 0, syaratLengkap: false, sort: "terbaru",
};

/** Hitung syarat wajib yang terpenuhi: jawaban teks terisi / berkas terlampir. */
export function requirementProgress(a: FilterableApplicant): { done: number; total: number } {
  const qs = (a.applicationQuestions ?? []).filter((q) => q.required);
  const files = new Set((a.uploadedFiles ?? []).map((f) => f.questionId).filter(Boolean));
  let done = 0;
  for (const q of qs) {
    if (q.answerType === "photo" || q.answerType === "file") { if (files.has(q.id)) done++; }
    else if ((a.applicationAnswers?.[q.id] ?? "").trim()) done++;
  }
  return { done, total: qs.length };
}

export function isFiltersActive(f: ApplicantFilters) {
  return JSON.stringify({ ...f, sort: "" }) !== JSON.stringify({ ...EMPTY_FILTERS, sort: "" });
}

export function filterApplicants<T extends FilterableApplicant>(rows: T[], f: ApplicantFilters): T[] {
  const q = f.search.trim().toLowerCase();
  const out = rows.filter((a) => {
    if (f.status && a.status !== f.status) return false;
    if (f.jobId != null && a.jobId !== f.jobId) return false;
    if (f.shortlist === "ya" && !a.shortlistedAt) return false;
    if (f.shortlist === "belum" && a.shortlistedAt) return false;
    if (f.klien === "setuju" && a.clientDecision !== "setuju") return false;
    if (f.klien === "tidak" && a.clientDecision !== "tidak") return false;
    if (f.klien === "belum" && (!a.shortlistedAt || a.clientDecision)) return false;
    if (f.minRating > 0 && (a.workerStats?.ratingAvg ?? 0) < f.minRating) return false;
    if (f.minJobs > 0 && (a.workerStats?.completedJobs ?? 0) < f.minJobs) return false;
    if (f.syaratLengkap) { const p = requirementProgress(a); if (p.done < p.total) return false; }
    if (q) {
      const hay = [
        a.workerName, a.jobTitle, ...(a.workerSkills ?? []),
        ...Object.values(a.applicationAnswers ?? {}),
        ...Object.values(a.supportingInfo ?? {}).map((v) => (typeof v === "string" ? v : "")),
      ].join(" \n ").toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const t = (a: FilterableApplicant) => new Date(a.createdAt).getTime() || 0;
  const sorters: Record<SortKey, (x: T, y: T) => number> = {
    terbaru: (x, y) => t(y) - t(x),
    rating: (x, y) => (y.workerStats?.ratingAvg ?? -1) - (x.workerStats?.ratingAvg ?? -1) || t(y) - t(x),
    pengalaman: (x, y) => (y.workerStats?.completedJobs ?? 0) - (x.workerStats?.completedJobs ?? 0) || t(y) - t(x),
    nama: (x, y) => x.workerName.localeCompare(y.workerName, "id"),
  };
  return out.sort(sorters[f.sort]);
}
