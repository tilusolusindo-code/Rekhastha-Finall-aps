/**
 * Browser client for the flat-rate + freemium monetization endpoints:
 * Instan Kilat pay-per-post orders, the payment webhook (simulated gateway
 * callback), and the applicant-contact subscription paywall. Mirrors the
 * `credentials: "include"` + `/api` base pattern from auth-client.ts.
 */
const API_BASE = "/api";

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "Terjadi kesalahan.");
  }
  return data as T;
}

export interface InstantOrder {
  id: number;
  jobId: number;
  companyId: string;
  amount: number;
  status: string;
  orderIdGateway: string | null;
}

export function createInstantOrder(jobId: number, category: string): Promise<InstantOrder> {
  return request<InstantOrder>("/instant-orders", "POST", { jobId, category });
}

/** Simulates the Midtrans/Xendit gateway calling back after payment succeeds. */
export function confirmInstantPayment(orderId: number): Promise<InstantOrder> {
  return request<InstantOrder>("/webhook/payment", "POST", { orderId, status: "success" });
}

export interface SubscriptionInfo {
  isPremium: boolean;
  expiresAt: string | null;
  price: number;
}

export function fetchSubscription(): Promise<SubscriptionInfo> {
  return request<SubscriptionInfo>("/subscriptions/me", "GET");
}

export function subscribePremium(): Promise<unknown> {
  return request("/subscriptions/subscribe", "POST");
}

// ── Rekhastha Bisnis (new tiered subscription system) ──────────────

export interface SubscriptionPlan {
  id: number;
  label: string;
  durationMonths: number;
  durationDays: number;
  originalPrice: number;
  promoPrice: number;
}

export interface BisnisStatus {
  isPremium: boolean;
  expiredAt: string | null;
}

export interface SubscriptionOrder {
  id: number;
  companyId: string;
  planId: number;
  amount: number;
  status: string;
  orderIdGateway: string | null;
}

export function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  return request<SubscriptionPlan[]>("/subscription-plans", "GET");
}

export function fetchBisnisStatus(): Promise<BisnisStatus> {
  return request<BisnisStatus>("/subscriptions/status", "GET");
}

export function createSubscriptionOrder(planId: number): Promise<{ order: SubscriptionOrder; plan: SubscriptionPlan }> {
  return request("/subscriptions/orders", "POST", { planId });
}

export function confirmSubscriptionPayment(orderId: number): Promise<unknown> {
  return request("/webhook/subscription-payment", "POST", { orderId, status: "success" });
}

// ── Midtrans Snap ──────────────────────────────────────────────────────────

export interface MidtransCreatePaymentParams {
  orderId: string;
  jobId?: string;
  jobType: "gig" | "escrow" | "subscription" | "instant";
  grossAmount: number;
  customerDetails: {
    firstName: string;
    lastName?: string;
    email: string;
    phone?: string;
  };
  itemDetails?: {
    id: string;
    price: number;
    quantity: number;
    name: string;
  }[];
}

export interface MidtransPaymentResult {
  snapToken: string;
  redirectUrl: string;
  orderId: string;
}

export interface MidtransPaymentStatus {
  orderId: string;
  status: "pending" | "paid" | "deny" | "cancel" | "expire" | "fraud" | string;
  grossAmount: number;
  paymentType: string | null;
  transactionStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Buat Snap transaction di backend dan dapatkan snapToken. */
export function createMidtransPayment(
  params: MidtransCreatePaymentParams,
): Promise<MidtransPaymentResult> {
  return request<MidtransPaymentResult>("/payments/midtrans/create", "POST", params);
}

/** Cek status pembayaran berdasarkan orderId. */
export function getMidtransPaymentStatus(orderId: string): Promise<MidtransPaymentStatus> {
  return request<MidtransPaymentStatus>(
    `/payments/midtrans/status/${encodeURIComponent(orderId)}`,
    "GET",
  );
}

/**
 * Buka Snap popup di browser.
 * Membutuhkan script Midtrans Snap sudah di-load di index.html.
 *
 * @param snapToken - token dari createMidtransPayment
 * @param callbacks - { onSuccess, onPending, onError, onClose }
 */
export function openMidtransSnap(
  snapToken: string,
  callbacks: {
    onSuccess?: (result: Record<string, unknown>) => void;
    onPending?: (result: Record<string, unknown>) => void;
    onError?: (result: Record<string, unknown>) => void;
    onClose?: () => void;
  } = {},
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = (window as any).snap;
  if (!snap) {
    console.error(
      "[Midtrans] snap.js belum ter-load. Pastikan script Midtrans ada di index.html.",
    );
    return;
  }
  snap.pay(snapToken, {
    onSuccess: callbacks.onSuccess ?? (() => {}),
    onPending: callbacks.onPending ?? (() => {}),
    onError: callbacks.onError ?? (() => {}),
    onClose: callbacks.onClose ?? (() => {}),
  });
}

/**
 * Helper: buat order ID unik untuk Midtrans.
 * Format: RKS-{type}-{timestamp}-{random4}
 */
export function generateMidtransOrderId(type: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RKS-${type.toUpperCase()}-${ts}-${rnd}`;
}
