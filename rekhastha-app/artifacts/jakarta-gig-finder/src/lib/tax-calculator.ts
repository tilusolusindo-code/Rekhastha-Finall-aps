/**
 * Kalkulator Pajak & BPJS untuk Rekhastha
 *
 * Regulasi yang dipakai:
 *  - PPh 21 tarif progresif 2024 (PMK 168/2023)
 *  - BPJS Ketenagakerjaan: JKK 0.24%, JKM 0.3%, JHT 3.7% (employer) + 2% (pekerja), JP 2% (employer) + 1% (pekerja)
 *  - BPJS Kesehatan: 4% (employer) + 1% (pekerja), maks gaji Rp12 juta
 *
 * Catatan: Ini adalah estimasi. Untuk payroll resmi, konsultasikan dengan akuntan.
 */

export interface TaxInput {
  grossMonthly: number;      // Gaji bruto per bulan (Rp)
  status: "TK0" | "K0" | "K1" | "K2" | "K3"; // TK = tidak kawin, K = kawin + tanggungan
  isEmployee: boolean;       // true = karyawan tetap, false = pekerja harian/lepas
  workDaysPerMonth?: number; // Untuk pekerja harian (default 22 hari)
}

export interface TaxResult {
  grossMonthly: number;
  // BPJS Kesehatan
  bpjsKesehatanEmployee: number;
  bpjsKesehatanEmployer: number;
  // BPJS Ketenagakerjaan
  bpjsJhtEmployee: number;    // JHT 2% pekerja
  bpjsJhtEmployer: number;    // JHT 3.7% pemberi kerja
  bpjsJpEmployee: number;     // JP 1% pekerja
  bpjsJpEmployer: number;     // JP 2% pemberi kerja
  bpjsJkk: number;            // JKK 0.24% (pemberi kerja)
  bpjsJkm: number;            // JKM 0.3% (pemberi kerja)
  // PPh 21
  pph21Monthly: number;
  // Ringkasan
  totalDeductionEmployee: number; // potongan dari gaji pekerja
  totalEmployerCost: number;      // total beban pemberi kerja
  netMonthly: number;             // gaji bersih pekerja
  effectiveTaxRate: number;       // persen pajak efektif
  // Slip detail
  breakdown: TaxBreakdownItem[];
}

export interface TaxBreakdownItem {
  label: string;
  amount: number;
  paidBy: "pekerja" | "perusahaan";
  type: "deduction" | "addition";
}

/** PTKP 2024 (Penghasilan Tidak Kena Pajak) per tahun */
const PTKP: Record<string, number> = {
  TK0: 54_000_000,
  K0:  58_500_000,
  K1:  63_000_000,
  K2:  67_500_000,
  K3:  72_000_000,
};

/** Tarif PPh 21 progresif (Pasal 17 UU PPh) per tahun */
const TAX_BRACKETS = [
  { max:    60_000_000, rate: 0.05 },
  { max:   250_000_000, rate: 0.15 },
  { max:   500_000_000, rate: 0.25 },
  { max: 5_000_000_000, rate: 0.30 },
  { max: Infinity,      rate: 0.35 },
];

function calcPph21Annual(grossAnnual: number, status: TaxInput["status"]): number {
  const ptkp = PTKP[status] ?? PTKP.TK0;
  const pkp = Math.max(0, grossAnnual - ptkp);
  let tax = 0;
  let remaining = pkp;
  let prevMax = 0;
  for (const bracket of TAX_BRACKETS) {
    const slice = Math.min(remaining, bracket.max - prevMax);
    if (slice <= 0) break;
    tax += slice * bracket.rate;
    remaining -= slice;
    prevMax = bracket.max;
    if (remaining <= 0) break;
  }
  return Math.round(tax);
}

export function calculateTax(input: TaxInput): TaxResult {
  const { grossMonthly, status, isEmployee } = input;

  // ── BPJS Kesehatan ──────────────────────────────────────
  const bpjsKesBasis = Math.min(grossMonthly, 12_000_000);
  const bpjsKesehatanEmployee = Math.round(bpjsKesBasis * 0.01);
  const bpjsKesehatanEmployer = Math.round(bpjsKesBasis * 0.04);

  // ── BPJS Ketenagakerjaan ────────────────────────────────
  const bpjsJhtEmployee = Math.round(grossMonthly * 0.02);
  const bpjsJhtEmployer = Math.round(grossMonthly * 0.037);
  const bpjsJpEmployee  = Math.round(grossMonthly * 0.01);
  const bpjsJpEmployer  = Math.round(grossMonthly * 0.02);
  const bpjsJkk         = Math.round(grossMonthly * 0.0024);
  const bpjsJkm         = Math.round(grossMonthly * 0.003);

  // ── PPh 21 ─────────────────────────────────────────────
  // Untuk pekerja harian lepas: metode berbeda (harian < Rp450rb tidak kena)
  let pph21Monthly = 0;
  if (!isEmployee) {
    // Pekerja harian lepas: akumulasi bulanan
    const workDays = input.workDaysPerMonth ?? 22;
    const dailyWage = grossMonthly / workDays;
    const dailyLimit = 450_000;
    if (dailyWage > dailyLimit) {
      const taxableMonthly = (dailyWage - dailyLimit) * workDays;
      pph21Monthly = Math.round(calcPph21Annual(taxableMonthly * 12, status) / 12);
    }
  } else {
    // Karyawan tetap: metode tahunan
    const grossAnnual = grossMonthly * 12;
    // Biaya jabatan 5% maks Rp6 juta/tahun
    const biayaJabatan = Math.min(grossAnnual * 0.05, 6_000_000);
    // Iuran pensiun (JHT + JP karyawan)
    const iuranPensiun = (bpjsJhtEmployee + bpjsJpEmployee) * 12;
    const netto = grossAnnual - biayaJabatan - iuranPensiun;
    pph21Monthly = Math.round(calcPph21Annual(netto, status) / 12);
  }

  // ── Summary ─────────────────────────────────────────────
  const totalDeductionEmployee = bpjsKesehatanEmployee + bpjsJhtEmployee + bpjsJpEmployee + pph21Monthly;
  const totalEmployerAddition  = bpjsKesehatanEmployer + bpjsJhtEmployer + bpjsJpEmployer + bpjsJkk + bpjsJkm;
  const netMonthly = grossMonthly - totalDeductionEmployee;
  const effectiveTaxRate = grossMonthly > 0
    ? Math.round((totalDeductionEmployee / grossMonthly) * 100 * 10) / 10
    : 0;

  const breakdown: TaxBreakdownItem[] = [
    { label: "Gaji Bruto",                       amount: grossMonthly,            paidBy: "pekerja",    type: "addition"  },
    { label: "BPJS Kesehatan (1%)",               amount: -bpjsKesehatanEmployee,  paidBy: "pekerja",    type: "deduction" },
    { label: "BPJS JHT (2%)",                     amount: -bpjsJhtEmployee,        paidBy: "pekerja",    type: "deduction" },
    { label: "BPJS JP (1%)",                      amount: -bpjsJpEmployee,         paidBy: "pekerja",    type: "deduction" },
    { label: "PPh 21",                            amount: -pph21Monthly,           paidBy: "pekerja",    type: "deduction" },
    { label: "Gaji Bersih (Take Home Pay)",       amount: netMonthly,              paidBy: "pekerja",    type: "addition"  },
    { label: "BPJS Kesehatan Perusahaan (4%)",    amount: bpjsKesehatanEmployer,   paidBy: "perusahaan", type: "addition"  },
    { label: "BPJS JHT Perusahaan (3.7%)",        amount: bpjsJhtEmployer,         paidBy: "perusahaan", type: "addition"  },
    { label: "BPJS JP Perusahaan (2%)",           amount: bpjsJpEmployer,          paidBy: "perusahaan", type: "addition"  },
    { label: "BPJS JKK (0.24%)",                  amount: bpjsJkk,                 paidBy: "perusahaan", type: "addition"  },
    { label: "BPJS JKM (0.3%)",                   amount: bpjsJkm,                 paidBy: "perusahaan", type: "addition"  },
  ];

  return {
    grossMonthly,
    bpjsKesehatanEmployee, bpjsKesehatanEmployer,
    bpjsJhtEmployee, bpjsJhtEmployer,
    bpjsJpEmployee, bpjsJpEmployer,
    bpjsJkk, bpjsJkm,
    pph21Monthly,
    totalDeductionEmployee, totalEmployerCost: grossMonthly + totalEmployerAddition,
    netMonthly, effectiveTaxRate,
    breakdown,
  };
}
