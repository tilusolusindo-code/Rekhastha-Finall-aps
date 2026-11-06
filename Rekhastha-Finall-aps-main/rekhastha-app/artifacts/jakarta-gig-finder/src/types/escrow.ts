export type EscrowStatus =
  | "pending"
  | "pending_payment"
  | "locked"
  | "disputed"
  | "disputed_active"
  | "released"
  | "refunded";

export interface EscrowEvent {
  id: number;
  jobId: number;
  jobTitle: string;
  fromStatus?: EscrowStatus;
  toStatus: EscrowStatus;
  actor: "system" | "company" | "worker" | "admin";
  actorName?: string;
  amount?: number;
  timestamp: Date;
  note?: string;
}

export interface WalletTransaction {
  id: number;
  type: "credit" | "debit";
  amount: number;
  label: string;
  jobTitle: string;
  timestamp: Date;
  note?: string;
}

// ── New posting fees and legacy escrow rates ────────────────────────
export type JobCategory = "umum" | "terampil" | "profesional";

/** Fixed one-time admin fee charged on a newly posted gig. */
export const FLAT_ADMIN_FEES: Record<JobCategory, number> = {
  umum: 50_000,
  terampil: 50_000,
  profesional: 50_000,
};

/** Reference price shown before the current posting discount. */
export const FLAT_ADMIN_LIST_PRICES: Record<JobCategory, number> = {
  umum: 75_000,
  terampil: 75_000,
  profesional: 75_000,
};

/** Kept only for settling legacy escrow rows that have no saved fee rate. */
export const PLATFORM_FEE_RATES: Record<JobCategory, number> = {
  umum: 0.03,
  terampil: 0.05,
  profesional: 0.08,
};
export const DEFAULT_FEE_RATE = PLATFORM_FEE_RATES.terampil;
export const ADMIN_DISPUTE_FEE = 0.05;

export function getFlatAdminFee(category?: JobCategory | null): number {
  return category ? FLAT_ADMIN_FEES[category] : FLAT_ADMIN_FEES.umum;
}

/** Resolve the legacy escrow split rate. Do not use this for new posting fees. */
export function getFeeRate(category?: JobCategory | null): number {
  return category ? (PLATFORM_FEE_RATES[category] ?? DEFAULT_FEE_RATE) : DEFAULT_FEE_RATE;
}

export const CANCELLATION_FEE_1HR = 20_000; // Rp 20.000 potongan jika pemberi kerja batal <1 jam

// ── Kedisiplinan & jendela sengketa ───────────────────
export const CLOCKIN_GRACE_MS = 15 * 60 * 1000;      // 15 menit masa tenggang Clock-In sejak shift dimulai
export const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 jam jendela validasi/sengketa pasca Clock-Out
export const MAX_BYPASS_STRIKES = 3;                  // 3 blocked messages pause this chat view

export const DURATION_DAYS: Record<string, number> = {
  harian: 1,
  "1_bulan": 22,
  "3_bulan": 66,
  "6_bulan": 132,
};

export function calcEscrowAmount(
  nominal: number,
  pembayaran: string,
  jumlahHari: number,
  kuota: number
): number {
  if (pembayaran === "per_projek") return nominal * kuota;
  const perDay = nominal;
  return perDay * jumlahHari * kuota;
}

/** Split a legacy total deposit using the rate saved on that gig. */
export function calcSplit(totalDeposit: number, feeRate = DEFAULT_FEE_RATE) {
  const workerNet = Math.round(totalDeposit / (1 + feeRate));
  return { platformCut: totalDeposit - workerNet, workerNet };
}

/** Legacy wage mark-up helper; new gigs store feeRate 0 and pay a separate flat fee. */
export function calcEmployerFee(baseWage: number, feeRate = DEFAULT_FEE_RATE): number {
  return Math.round(baseWage * feeRate);
}

/** Legacy deposit helper; new gigs store feeRate 0 and bill a separate flat fee. */
export function calcEmployerDeposit(baseWage: number, feeRate = DEFAULT_FEE_RATE): number {
  return baseWage + calcEmployerFee(baseWage, feeRate);
}

/**
 * On-site borongan daily fractional wage.
 *
 * Splits the TOTAL escrow deposit evenly across the contract duration so each
 * verified daily QR check-out releases exactly one day's share: the worker's net
 * (`netToWorker`) plus the corporate fee (`platformFee`). `grossFraction` is
 * the day's gross before the fee.
 *
 * Uses Math.floor (not Math.round) so that k × netToWorker ≤ floor(baseWage × k / days)
 * strictly for all k ≤ days — guaranteeing the cumulative payout for any partial
 * completion never exceeds the proportional share of the base wage. Any residual
 * (totalDeposit − grossFraction × days) stays in escrow and is refunded to the
 * employer at contract close.
 */
export function calcDailyFraction(totalDeposit: number, jumlahHari: number, feeRate = DEFAULT_FEE_RATE) {
  const days = Math.max(1, jumlahHari);
  const { workerNet, platformCut } = calcSplit(totalDeposit, feeRate);
  const netToWorker = Math.floor(workerNet / days);
  const platformFee = Math.floor(platformCut / days);
  const grossFraction = netToWorker + platformFee;
  return { grossFraction, platformFee, netToWorker };
}
