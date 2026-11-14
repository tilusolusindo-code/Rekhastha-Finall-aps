import { X, Download, Printer } from "lucide-react";
import { CustomJob, calcTotal, paymentLabels, paymentUnits } from "@/types/custom-job";
import { WorkerProfile } from "@/types/worker-profile";

interface PaySlipModalProps {
  job: CustomJob;
  workerProfile: WorkerProfile;
  clockedInAt: Date | null;
  clockedOutAt: Date | null;
  onClose: () => void;
}

function formatRp(v: number) {
  return "Rp " + v.toLocaleString("id-ID");
}

function formatDate(d: Date) {
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

export default function PaySlipModal({ job, workerProfile, clockedInAt, clockedOutAt, onClose }: PaySlipModalProps) {
  const jumlahHari = job.jumlahHari ?? 1;
  const daysPaid = job.daysPaid ?? 0;
  const isMultiDay = job.hiringMode === "lama" && jumlahHari > 1;
  // For partial lama contracts (contract ended before all days completed), use
  // the actual days paid so the payslip total matches the escrow release amount.
  const isPartial = isMultiDay && daysPaid > 0 && daysPaid < jumlahHari;
  const effectiveDays = isPartial ? daysPaid : jumlahHari;
  const gross = isMultiDay
    ? job.nominal * effectiveDays
    : calcTotal(job.nominal, job.pembayaran);
  const net = gross;

  const durationHours = clockedInAt && clockedOutAt
    ? ((clockedOutAt.getTime() - clockedInAt.getTime()) / 3600000).toFixed(1)
    : "8.0";

  const slipDate = clockedOutAt ?? new Date();

  // Print the existing slip in place so its app styling remains available.
  const handlePrint = () => window.print();

  return (
    <div
      id="pay-slip-modal"
      className="fixed inset-0 z-[300] flex flex-col justify-end"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
    >
      <div className="pay-slip-backdrop absolute inset-0" onClick={onClose} />
      <div
        id="pay-slip-shell"
        className="relative bg-white rounded-t-3xl w-full max-h-[90vh] overflow-y-auto"
        style={{ animation: "slideUp 0.28s cubic-bezier(0.32,0.72,0,1)" }}
      >
        <div className="pay-slip-drag-handle flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-gray-200" /></div>

        <div id="pay-slip-header" className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Slip Gaji</h2>
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(slipDate)}</p>
          </div>
          <div className="flex gap-2">
            <button
              data-testid="button-print-slip"
              onClick={handlePrint}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200"
            >
              <Printer className="w-4 h-4 text-gray-600" />
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100">
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Slip content */}
        <div className="px-5 py-4" id="pay-slip-content">
          <div className="pay-slip-card font-mono text-[12px] border border-dashed border-gray-300 rounded-xl p-4 space-y-0 bg-gray-50">
            {/* Header */}
            <div className="text-center pb-3 border-b border-dashed border-gray-300">
              <p className="font-bold text-base text-gray-900">REKHASTHA</p>
              <p className="text-gray-500 text-[11px]">Platform Tenaga Kerja Harian Indonesia</p>
              <p className="text-gray-500 text-[11px]">Indonesia</p>
              <p className="font-bold text-sm mt-2 text-gray-800">SLIP GAJI</p>
              <p className="text-[11px] text-gray-500">No: RKH/{slipDate.getFullYear()}/{String(job.id).padStart(4, "0")}</p>
            </div>

            {/* Worker identity */}
            <div className="py-3 border-b border-dashed border-gray-300 space-y-1">
              <Row label="Nama Pekerja" value={workerProfile.namaLengkap} />
              <Row label="NIK" value={workerProfile.nik} />
              <Row label="NPWP" value={workerProfile.belumPunyaNpwp ? "Tidak ada" : workerProfile.npwp || "—"} />
              <Row label="Bank / Rekening" value={`${workerProfile.namaBank} · ${workerProfile.nomorRekening}`} />
            </div>

            {/* Job info */}
            <div className="py-3 border-b border-dashed border-gray-300 space-y-1">
              <Row label="Posisi / Pekerjaan" value={job.posisi} />
              <Row label="Sistem Bayaran" value={paymentLabels[job.pembayaran]} />
              <Row
                label="Tarif"
                value={`${formatRp(job.nominal)} / ${paymentUnits[job.pembayaran]}`}
              />
              <Row label="Durasi Kerja" value={`${durationHours} Jam`} />
              {clockedInAt && <Row label="Clock-In" value={clockedInAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} />}
              {clockedOutAt && <Row label="Clock-Out" value={clockedOutAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} />}
            </div>

            {/* Earnings breakdown */}
            <div className="py-3 border-b border-dashed border-gray-300 space-y-1">
              <p className="font-bold text-[11px] text-gray-700 mb-1.5">RINCIAN PENGHASILAN</p>
              {isMultiDay ? (
                <>
                  <Row label="Tarif Harian" value={`${formatRp(job.nominal)} / hari`} />
                  {isPartial ? (
                    <>
                      <Row label="Durasi Kontrak" value={`${jumlahHari} hari (penuh)`} />
                      <Row label="Hari Terbayar" value={`${effectiveDays} hari`} />
                      <Row
                        label="Rincian Aktual"
                        value={`${formatRp(job.nominal)}/hari × ${effectiveDays} hari`}
                      />
                    </>
                  ) : (
                    <Row
                      label="Rincian Kontrak"
                      value={`${formatRp(job.nominal)}/hari × ${jumlahHari} hari × ${job.kuota} orang`}
                    />
                  )}
                  <Row label="Total Kotor Pekerja" value={formatRp(gross)} />
                </>
              ) : (
                <Row label={`Total Kotor (${paymentLabels[job.pembayaran]})`} value={formatRp(gross)} />
              )}
            </div>

            {/* Deductions */}
            <div className="py-3 border-b border-dashed border-gray-300 space-y-1">
              <p className="font-bold text-[11px] text-gray-700 mb-1.5">POTONGAN</p>
              <Row label="Potongan Pekerja" value={`- ${formatRp(0)}`} />
              <Row label="Biaya admin flat (dibayar perusahaan)" value={job.adminFeeAmount == null ? "—" : formatRp(job.adminFeeAmount)} />
            </div>

            {/* Net */}
            <div className="pt-3 space-y-1">
              <div className="flex justify-between font-bold text-sm text-gray-900">
                <span>PENGHASILAN BERSIH</span>
                <span className="text-primary">{formatRp(net)}</span>
              </div>
              <Row label="Ditransfer ke" value={`${workerProfile.namaBank} · ${workerProfile.nomorRekening}`} />
              <Row label="Atas nama" value={workerProfile.namaRekening || workerProfile.namaLengkap} />
            </div>

            {/* Footer */}
            <div className="pt-4 text-center text-[11px] text-gray-500 border-t border-dashed border-gray-300 mt-3 space-y-0.5">
              <p className="leading-tight">Segala kewajiban perpajakan menjadi tanggung jawab</p>
              <p className="leading-tight">mandiri masing-masing pihak sesuai hukum yang berlaku.</p>
              <p className="mt-1">Dicetak: {new Date().toLocaleString("id-ID")}</p>
            </div>
          </div>
        </div>

        {/* Download button */}
        <div id="pay-slip-actions" className="px-5 pb-8 pt-2">
          <button
            data-testid="button-download-slip"
            onClick={handlePrint}
            className="w-full bg-primary text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all"
            style={{ boxShadow: "0 4px 16px rgba(6,95,70,0.3)" }}
          >
            <Download className="w-5 h-5" />
            Unduh / Cetak Slip Gaji
          </button>
        </div>
      </div>
      <style>{`
        @keyframes slideUp { from{transform:translateY(100%);opacity:0.6} to{transform:translateY(0);opacity:1} }
        @page { size: A4; margin: 12mm; }
        @media print {
          html, body, #root {
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
          }
          body * { visibility: hidden !important; }
          #pay-slip-modal, #pay-slip-modal * { visibility: visible !important; }
          #pay-slip-modal {
            display: block !important;
            position: static !important;
            inset: auto !important;
            width: auto !important;
            height: auto !important;
            min-height: 0 !important;
            background: transparent !important;
            backdrop-filter: none !important;
          }
          .pay-slip-backdrop,
          #pay-slip-header,
          #pay-slip-actions,
          .pay-slip-drag-handle { display: none !important; }
          #pay-slip-shell {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: none !important;
            max-height: none !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            animation: none !important;
          }
          #pay-slip-content {
            display: block !important;
            position: static !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: transparent !important;
          }
          #pay-slip-content, #pay-slip-content * {
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
          #pay-slip-content .pay-slip-card {
            border: 1px dashed #d1d5db !important;
            border-radius: 12px !important;
            padding: 16px !important;
            background: #f9fafb !important;
            color: #111827 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value}</span>
    </div>
  );
}
