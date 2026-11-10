/**
 * Browser client for the QR attendance (Presensi) endpoints.
 *
 *   • the EMPLOYER device requests a short-lived token and renders it as a real
 *     QR code (masuk = check-in, pulang = check-out),
 *   • the WORKER device scans that QR with a live camera and redeems the token.
 *
 * The successful scan is persisted server-side and fanned out over the
 * WebSocket (see `subscribeAttendance` in central-server.ts) so both devices
 * react instantly.
 */

const API_BASE = "/api";

export type AttendanceKind = "masuk" | "pulang";

export interface AttendanceToken {
  token: string;
  expiresAt: number;
  /** Masa berlaku token di server (ms). QR perlu diganti sebelum ini habis. */
  ttlMs?: number;
}

export interface AcceptedWorker {
  workerId: string;
  workerName: string;
}

/** Employer: pekerja yang lamarannya sudah diterima untuk sebuah lowongan (untuk QR khusus pekerja). */
export async function fetchAcceptedWorkers(jobId: number): Promise<AcceptedWorker[]> {
  const res = await fetch(`${API_BASE}/applications?jobId=${jobId}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return [];
  const rows = (await res.json().catch(() => [])) as Array<{ workerId: string; workerName: string; status: string }>;
  const seen = new Set<string>();
  const out: AcceptedWorker[] = [];
  for (const r of rows) {
    if (r.status !== "diterima" || seen.has(r.workerId)) continue;
    seen.add(r.workerId);
    out.push({ workerId: r.workerId, workerName: r.workerName });
  }
  return out;
}

/** Employer: mint a single-use, short-lived QR token for a job + presence kind. */
export async function requestAttendanceToken(
  jobId: number,
  kind: AttendanceKind,
  branchId?: number,
  workerId?: string,
): Promise<AttendanceToken> {
  const res = await fetch(`${API_BASE}/attendance/token`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, kind, ...(branchId ? { branchId } : {}), ...(workerId ? { workerId } : {}) }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Gagal membuat QR Presensi.");
  }
  return (await res.json()) as AttendanceToken;
}

export interface AttendanceRow {
  id: number;
  jobId: number;
  branchId: number | null;
  workerName: string;
  kind: AttendanceKind;
  at: string;
}

export interface AttendanceStatus {
  scannedIn: boolean;
  scannedOut: boolean;
  clockedInAt: string | null;
  clockedOutAt: string | null;
}

/** Restore the worker's persisted check-in/check-out state after a refresh. */
export async function fetchAttendanceStatus(jobId: number): Promise<AttendanceStatus> {
  const res = await fetch(`${API_BASE}/attendance/status?jobId=${jobId}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as AttendanceStatus & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? "Gagal memeriksa status presensi.");
  }
  return data;
}

/** Worker: redeem a scanned QR token. Server validates, persists and broadcasts. */
export async function submitAttendanceScan(
  token: string,
  location?: { latitude: number; longitude: number; accuracy: number },
): Promise<AttendanceRow> {
  const res = await fetch(`${API_BASE}/attendance/scan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...(location ?? {}) }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "QR tidak valid atau sudah kadaluarsa.");
  }
  return (await res.json()) as AttendanceRow;
}
