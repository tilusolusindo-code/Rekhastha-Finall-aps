const API_BASE = "/api";

/** Klien Web Push: aktifkan/matikan notifikasi di perangkat ini. */
export type PushSupport = "unsupported" | "ios-needs-install" | "denied" | "available";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iPhone/iPad hanya mendukung push untuk aplikasi yang sudah dipasang ke layar utama.
    return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "available";
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.ready); } catch { return null; }
}

/** Apakah perangkat ini sedang berlangganan? */
export async function isSubscribed(): Promise<boolean> {
  const reg = await registration();
  if (!reg) return false;
  return Boolean(await reg.pushManager.getSubscription());
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function api(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
}

/** Minta izin (harus dari ketukan pengguna), berlangganan, lalu simpan di server. */
export async function enablePush(): Promise<void> {
  const cfg = await (await api("/push/config")).json().catch(() => null) as { enabled?: boolean; publicKey?: string } | null;
  if (!cfg?.enabled || !cfg.publicKey) throw new Error("Notifikasi push belum diaktifkan di server.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi ditolak. Aktifkan lewat pengaturan browser.");
  const reg = await registration();
  if (!reg) throw new Error("Service worker belum siap. Muat ulang halaman lalu coba lagi.");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) as BufferSource,
  }));
  const res = await api("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Gagal menyimpan langganan.");
  }
}

/** Matikan di perangkat ini dan hapus di server. Tidak pernah melempar galat. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api("/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  } catch { /* abaikan */ }
}
