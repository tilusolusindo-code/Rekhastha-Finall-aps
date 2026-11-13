import { AuthUser, UserRole } from "@/types/auth";
import type { WorkerProfile } from "@/types/worker-profile";

/**
 * Real authentication client. Talks to the api-server auth endpoints and relies
 * on an httpOnly session cookie (set by the server) — so `credentials: "include"`
 * is required on every call for the cookie to be sent/stored.
 *
 * The web app is served at `/`, so a root-relative `/api` base is correct (this
 * mirrors `central-server.ts`).
 */
const API_BASE = "/api";

export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError(
      (data as { error?: string }).error ?? "Terjadi kesalahan.",
      res.status,
      (data as { code?: string }).code,
    );
  }
  return data as T;
}

export type RegisterPayload = Omit<AuthUser, "id" | "linkedWithGoogle"> & {
  password: string;
};

export type RegisterResult = AuthUser | { needsVerification: true; email: string };

export function register(payload: RegisterPayload): Promise<RegisterResult> {
  return request<RegisterResult>("/auth/register", payload);
}

export function resendVerification(email: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/auth/resend-verification", { email });
}

export function verifyEmail(token: string): Promise<AuthUser> {
  return request<AuthUser>("/auth/verify-email", { token });
}

export function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/auth/login", { email, password });
}

export async function fetchGoogleAuthAvailability(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/config`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { googleEnabled?: boolean };
    return data.googleEnabled === true;
  } catch {
    return false;
  }
}

export function updateWorkerProfile(profile: WorkerProfile): Promise<AuthUser> {
  return request<AuthUser>("/auth/profile", profile);
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError((data as { error?: string }).error ?? "Terjadi kesalahan.", res.status);
  return data as T;
}

/** Unggah foto profil (JPG/PNG, maks 2 MB). */
export async function uploadAvatar(file: Blob): Promise<AuthUser> {
  const form = new FormData();
  form.append("avatar", file, "avatar.jpg");
  const res = await fetch(`${API_BASE}/auth/avatar`, { method: "POST", credentials: "include", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError((data as { error?: string }).error ?? "Gagal mengunggah foto.", res.status);
  return data as AuthUser;
}

export function removeAvatar(): Promise<AuthUser> {
  return sendJson<AuthUser>("/auth/avatar", "DELETE");
}

export interface AccountPayload {
  name: string;
  whatsapp?: string;
  namaPerusahaan?: string;
  alamat?: string;
}

/** Edit profil dasar: nama tampilan, WhatsApp, nama usaha/alamat (perusahaan). */
export function updateAccount(payload: AccountPayload): Promise<AuthUser> {
  return sendJson<AuthUser>("/auth/account", "POST", payload);
}

/** Start the server-side Google OAuth authorization-code flow. */
export function startGoogleLogin(): void {
  window.location.assign(`${API_BASE}/auth/google/start`);
}

/** Complete first-time Google registration after the user selects a role. */
export function loginWithGoogle(code: string, role: UserRole): Promise<AuthUser> {
  return request<AuthUser>("/auth/google/complete", { code, role });
}

/**
 * Best-effort logout. The UI clears local state optimistically, so this must not
 * throw; it retries once (with `keepalive` so it survives teardown) to minimise
 * the chance of an orphaned server session that `/me` would later restore.
 */
export async function logout(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
      });
      if (res.ok) return;
    } catch {
      // retry
    }
  }
}

export async function fetchMe(): Promise<AuthUser | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status === 401) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AuthError(
        (data as { error?: string }).error ?? "Sesi belum dapat dipulihkan.",
        res.status,
      );
    }
    return data as AuthUser;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AuthError("Pemulihan sesi melewati batas waktu. Periksa koneksi lalu coba lagi.", 0);
    }
    throw new AuthError("Sesi belum dapat dipulihkan. Periksa koneksi lalu coba lagi.", 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Submit KYC documents (KTP photo and/or selfie-with-KTP). Either or both
 * files may be provided; the server resets verificationStatus to "pending".
 */
export async function submitKyc(files: {
  ktpPhoto?: File;
  selfieWithKtp?: File;
}): Promise<AuthUser> {
  const form = new FormData();
  if (files.ktpPhoto) form.append("ktpPhoto", files.ktpPhoto);
  if (files.selfieWithKtp) form.append("selfieWithKtp", files.selfieWithKtp);

  const res = await fetch(`${API_BASE}/auth/kyc`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError((data as { error?: string }).error ?? "Gagal mengunggah dokumen.", res.status);
  }
  return data as AuthUser;
}
/**
 * Upload the worker's master CV/Portfolio to their profile (.pdf, max 10MB).
 * These become the default files auto-attached to Regular applications.
 */
export async function submitDocuments(files: {
  cv?: File;
  portfolio?: File;
}): Promise<AuthUser> {
  const form = new FormData();
  if (files.cv) form.append("cv", files.cv);
  if (files.portfolio) form.append("portfolio", files.portfolio);

  const res = await fetch(`${API_BASE}/auth/documents`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError((data as { error?: string }).error ?? "Gagal mengunggah berkas.", res.status);
  }
  return data as AuthUser;
}


/** Simpan pilihan jenis email notifikasi (hanya kunci yang dikirim yang berubah). */
export function updateNotificationPrefs(
  prefs: Partial<Record<"applicant" | "status" | "payment" | "payout" | "invite" | "reminder", boolean>>,
): Promise<AuthUser> {
  return sendJson<AuthUser>("/auth/notification-prefs", "PATCH", prefs);
}
