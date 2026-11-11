/**
 * Current discounted posting fee for every job category. Active trials and
 * subscriptions still waive the fee; the worker's wage remains separate.
 */
export const INSTANT_PRICE_BY_CATEGORY: Record<string, number> = {
  umum: 50_000,
  terampil: 50_000,
  profesional: 50_000,
};

/** Regular list price shown next to the active Rp50.000 discount. */
export const LIST_PRICE_BY_CATEGORY: Record<string, number> = {
  umum: 75_000,
  terampil: 75_000,
  profesional: 75_000,
};

export const SUBSCRIPTION_PRICE_MONTHLY = 149000;

export const FREE_APPLICANT_LIMIT = 3;

export function getInstantPrice(category: string | null | undefined): number {
  return INSTANT_PRICE_BY_CATEGORY[category ?? "umum"] ?? INSTANT_PRICE_BY_CATEGORY.umum;
}

export function getAdminFeeListAmount(category: string | null | undefined): number {
  const value = (category ?? "umum").trim().toLowerCase();
  if (value.includes("profesional") || value.includes("professional")) return LIST_PRICE_BY_CATEGORY.profesional;
  if (value.includes("terampil") || value.includes("teknis") || value.includes("skilled") || value.includes("technical")) {
    return LIST_PRICE_BY_CATEGORY.terampil;
  }
  return LIST_PRICE_BY_CATEGORY.umum;
}

/** Snapshot the one-time flat employer fee for a new job posting. */
export function getAdminFeeAmount(category: string | null | undefined): number {
  const value = (category ?? "umum").trim().toLowerCase();
  if (value.includes("profesional") || value.includes("professional")) return INSTANT_PRICE_BY_CATEGORY.profesional;
  if (value.includes("terampil") || value.includes("teknis") || value.includes("skilled") || value.includes("technical")) {
    return INSTANT_PRICE_BY_CATEGORY.terampil;
  }
  return INSTANT_PRICE_BY_CATEGORY.umum;
}

export interface FeeWaiverEmployer {
  createdAt: Date;
  isPremium: boolean;
  expiredAt: Date | null;
  freeTrialStartedAt: Date | null;
  freeTrialExpiresAt: Date | null;
}

export interface FeeWaiverSubscription {
  createdAt: Date;
  isPremium: boolean;
  expiresAt: Date | null;
}

/** Whether an employer qualified for a fee waiver at the job's creation time. */
export function hasAdminFeeWaiverAt(
  at: Date,
  employer?: FeeWaiverEmployer | null,
  subscription?: FeeWaiverSubscription | null,
): boolean {
  const trialActive = !!employer &&
    employer.createdAt <= at &&
    !!employer.freeTrialStartedAt &&
    !!employer.freeTrialExpiresAt &&
    employer.freeTrialStartedAt <= at &&
    employer.freeTrialExpiresAt > at;
  const businessPlanActive = !!employer &&
    employer.createdAt <= at &&
    ((employer.isPremium && !employer.expiredAt) ||
      (!!employer.expiredAt && employer.expiredAt > at));
  const monthlyPlanActive = !!subscription &&
    subscription.createdAt <= at &&
    ((subscription.isPremium && !subscription.expiresAt) ||
      (!!subscription.expiresAt && subscription.expiresAt > at));

  return trialActive || businessPlanActive || monthlyPlanActive;
}

/** Total contracted worker wages before the separate flat admin fee. */
export function calculateTotalWorkerPayout(
  nominal: number,
  paymentType: string,
  days: number | null | undefined,
  workers: number | null | undefined,
): number {
  const periods = paymentType === "per_projek" ? 1 : Math.max(1, days ?? 1);
  return nominal * periods * Math.max(1, workers ?? 1);
}

export function maskApplicantName(name: string): string {
  return name && name.trim() ? name : "Pelamar";
}
