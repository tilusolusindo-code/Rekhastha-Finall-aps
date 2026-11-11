import { useState } from "react";
import { Calculator, ChevronDown, ChevronUp, Info } from "lucide-react";
import { calculateTax, type TaxInput, type TaxResult } from "@/lib/tax-calculator";

const IDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const STATUS_OPTS: { value: TaxInput["status"]; label: string }[] = [
  { value: "TK0", label: "TK/0 — Belum kawin, tanpa tanggungan" },
  { value: "K0",  label: "K/0 — Kawin, tanpa tanggungan" },
  { value: "K1",  label: "K/1 — Kawin, 1 tanggungan" },
  { value: "K2",  label: "K/2 — Kawin, 2 tanggungan" },
  { value: "K3",  label: "K/3 — Kawin, 3 tanggungan" },
];

export default function TaxCalculator({ onClose }: { onClose: () => void }) {
  const [gross, setGross]         = useState("3000000");
  const [status, setStatus]       = useState<TaxInput["status"]>("TK0");
  const [isEmployee, setIsEmployee] = useState(false);
  const [days, setDays]           = useState("22");
  const [result, setResult]       = useState<TaxResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const calc = () => {
    const g = Number(gross.replace(/\D/g, ""));
    if (!g || g < 1000) return;
    setResult(calculateTax({
      grossMonthly: g,
      status,
      isEmployee,
      workDaysPerMonth: Number(days) || 22,
    }));
  };

  const fmtGross = (v: string) => {
    const num = v.replace(/\D/g, "");
    if (!num) return "";
    return Number(num).toLocaleString("id-ID");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Calculator className="w-4 h-4 text-emerald-700" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">Kalkulator Pajak & BPJS</h2>
              <p className="text-[11px] text-gray-400">PPh 21 + BPJS TK + BPJS Kesehatan</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Input */}
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Gaji Bruto per Bulan</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500">Rp</span>
              <input
                type="text" inputMode="numeric"
                value={fmtGross(gross)}
                onChange={e => setGross(e.target.value.replace(/\D/g, ""))}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
                placeholder="3.000.000"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Status PTKP</label>
            <select value={status} onChange={e => setStatus(e.target.value as TaxInput["status"])}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-emerald-500 bg-white">
              {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-bold text-gray-700 block mb-1">Jenis Pekerja</label>
              <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => setIsEmployee(false)}
                  className={`flex-1 py-2.5 text-xs font-bold transition-colors ${!isEmployee ? "bg-emerald-700 text-white" : "bg-white text-gray-500"}`}>
                  Harian/Lepas
                </button>
                <button onClick={() => setIsEmployee(true)}
                  className={`flex-1 py-2.5 text-xs font-bold transition-colors ${isEmployee ? "bg-emerald-700 text-white" : "bg-white text-gray-500"}`}>
                  Karyawan Tetap
                </button>
              </div>
            </div>
            {!isEmployee && (
              <div className="w-24">
                <label className="text-xs font-bold text-gray-700 block mb-1">Hari Kerja</label>
                <input type="number" min="1" max="31" value={days}
                  onChange={e => setDays(e.target.value)}
                  className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm text-center focus:outline-none focus:border-emerald-500" />
              </div>
            )}
          </div>

          <button onClick={calc}
            className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-black py-3.5 rounded-xl text-sm transition-colors">
            Hitung Sekarang
          </button>

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {/* Take home */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                <p className="text-xs font-bold text-emerald-700 mb-1">Gaji Bersih (Take Home Pay)</p>
                <p className="text-2xl font-black text-emerald-800">{IDR(result.netMonthly)}</p>
                <p className="text-xs text-emerald-600 mt-1">dari {IDR(result.grossMonthly)} bruto · potongan {result.effectiveTaxRate}%</p>
              </div>

              {/* Quick summary */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "PPh 21", value: result.pph21Monthly, color: "text-orange-600", bg: "bg-orange-50" },
                  { label: "BPJS Kes.", value: result.bpjsKesehatanEmployee, color: "text-blue-600", bg: "bg-blue-50" },
                  { label: "BPJS TK", value: result.bpjsJhtEmployee + result.bpjsJpEmployee, color: "text-purple-600", bg: "bg-purple-50" },
                ].map(item => (
                  <div key={item.label} className={`${item.bg} rounded-xl p-3 text-center`}>
                    <p className={`text-[10px] font-bold ${item.color}`}>{item.label}</p>
                    <p className={`text-sm font-black ${item.color}`}>{IDR(item.value)}</p>
                  </div>
                ))}
              </div>

              {/* Employer cost */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-amber-800">Total Beban Perusahaan</p>
                  <p className="text-[11px] text-amber-600">Gaji + semua iuran BPJS yang ditanggung perusahaan</p>
                </div>
                <p className="text-base font-black text-amber-800 ml-3 shrink-0">{IDR(result.totalEmployerCost)}</p>
              </div>

              {/* Detail toggle */}
              <button onClick={() => setShowDetail(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-100">
                <span>Lihat Rincian Lengkap</span>
                {showDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showDetail && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500">
                        <th className="text-left px-3 py-2 font-bold">Komponen</th>
                        <th className="text-right px-3 py-2 font-bold">Jumlah</th>
                        <th className="text-center px-3 py-2 font-bold">Ditanggung</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.breakdown.map((row, i) => (
                        <tr key={i} className={row.label.includes("Bersih") ? "bg-emerald-50 font-black" : "hover:bg-gray-50"}>
                          <td className="px-3 py-2.5 text-gray-700">{row.label}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${
                            row.type === "deduction" && !row.label.includes("Bersih") ? "text-red-600" :
                            row.label.includes("Bersih") ? "text-emerald-700" : "text-gray-900"
                          }`}>{row.amount < 0 ? `(${IDR(-row.amount)})` : IDR(row.amount)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                              row.paidBy === "perusahaan" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                            }`}>{row.paidBy}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Disclaimer */}
              <div className="flex gap-2 p-3 bg-blue-50 rounded-xl">
                <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  Hasil ini adalah <b>estimasi</b> berdasarkan PMK 168/2023 dan regulasi BPJS 2024.
                  Untuk perhitungan resmi, konsultasikan dengan akuntan atau HRD Anda.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
