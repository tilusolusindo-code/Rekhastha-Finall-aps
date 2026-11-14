import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { EMPTY_FILTERS, isFiltersActive, type ApplicantFilters, type SortKey } from "../lib/applicant-filters";

/** Bilah filter ATS untuk panel pemilik. Status dikontrol penuh lewat `filters`. */
export function ApplicantFilterBar({
  filters, onChange, jobs, shown, total,
}: {
  filters: ApplicantFilters;
  onChange: (f: ApplicantFilters) => void;
  jobs: [number, string][];
  shown: number;
  total: number;
}) {
  const [more, setMore] = useState(false);
  const set = <K extends keyof ApplicantFilters>(k: K, v: ApplicantFilters[K]) => onChange({ ...filters, [k]: v });
  const active = isFiltersActive(filters);
  const chip = (on: boolean) => `px-2.5 py-1 rounded-full text-[12px] font-bold border ${on ? "bg-primary text-white border-primary" : "bg-white text-gray-600 border-gray-200"}`;
  const sel = "px-2.5 py-2 border border-gray-200 rounded-xl text-xs bg-white";
  return (
    <div className="px-5 py-3 border-b border-gray-100 space-y-2 bg-white">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input data-testid="input-owner-ats-search" value={filters.search} onChange={(e) => set("search", e.target.value)}
            placeholder="Cari nama, keahlian, atau isi jawaban" className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-xs" />
        </div>
        <button onClick={() => setMore((v) => !v)}
          className={`px-3 rounded-xl border text-xs font-bold flex items-center gap-1 ${more || active ? "border-primary/30 text-primary bg-primary/5" : "border-gray-200 text-gray-600"}`}>
          Filter <ChevronDown className={`w-3 h-3 transition-transform ${more ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[["", "Semua"], ["baru", "Baru"], ["ditinjau", "Ditinjau"], ["diterima", "Diterima"], ["ditolak", "Ditolak"]].map(([v, l]) => (
          <button key={v} onClick={() => set("status", v)} className={chip(filters.status === v)}>{l}</button>
        ))}
      </div>
      {more && (
        <div className="grid grid-cols-2 gap-2">
          <select value={filters.jobId ?? ""} onChange={(e) => set("jobId", e.target.value ? Number(e.target.value) : null)} className={`${sel} col-span-2`}>
            <option value="">Semua lowongan</option>
            {jobs.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
          </select>
          <select value={filters.shortlist} onChange={(e) => set("shortlist", e.target.value as ApplicantFilters["shortlist"])} className={sel}>
            <option value="">Shortlist: semua</option><option value="ya">Sudah di shortlist</option><option value="belum">Belum di shortlist</option>
          </select>
          <select value={filters.klien} onChange={(e) => set("klien", e.target.value as ApplicantFilters["klien"])} className={sel}>
            <option value="">Klien: semua</option><option value="setuju">Disetujui klien</option><option value="tidak">Ditolak klien</option><option value="belum">Menunggu klien</option>
          </select>
          <select value={filters.minRating} onChange={(e) => set("minRating", Number(e.target.value))} className={sel}>
            <option value={0}>Rating: bebas</option><option value={3}>★ 3+</option><option value={4}>★ 4+</option><option value={4.5}>★ 4.5+</option>
          </select>
          <select value={filters.minJobs} onChange={(e) => set("minJobs", Number(e.target.value))} className={sel}>
            <option value={0}>Pengalaman: bebas</option><option value={1}>1+ pekerjaan</option><option value={5}>5+ pekerjaan</option><option value={10}>10+ pekerjaan</option>
          </select>
          <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-gray-600">
            <input type="checkbox" checked={filters.syaratLengkap} onChange={(e) => set("syaratLengkap", e.target.checked)} /> Hanya yang syarat wajibnya lengkap
          </label>
          <select value={filters.sort} onChange={(e) => set("sort", e.target.value as SortKey)} className={`${sel} col-span-2`}>
            <option value="terbaru">Urutkan: terbaru</option><option value="rating">Urutkan: rating tertinggi</option>
            <option value="pengalaman">Urutkan: pekerjaan terbanyak</option><option value="nama">Urutkan: nama A–Z</option>
          </select>
        </div>
      )}
      <div className="flex items-center justify-between text-[12px] text-gray-500">
        <span data-testid="text-owner-ats-count">{shown} dari {total} pelamar</span>
        {active && <button onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })} className="font-bold text-primary">Reset filter</button>}
      </div>
    </div>
  );
}
