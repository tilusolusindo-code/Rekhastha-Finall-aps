import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "rekhastha_pwa_dismissed_at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // tawarkan lagi setelah 14 hari

function snoozed(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return t > 0 && Date.now() - t < SNOOZE_MS;
  } catch { return false; }
}
function snooze() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* abaikan */ }
}
function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Kartu ajakan "Pasang aplikasi": Android/Chrome lewat prompt bawaan, iPhone lewat petunjuk manual. */
export function PwaInstallCard() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setPromptEvent(e as InstallPromptEvent); };
    const onInstalled = () => { setPromptEvent(null); setShowIos(false); snooze(); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIosSafari()) setShowIos(true);
    // Jangan langsung muncul: beri pengguna waktu melihat aplikasi dulu.
    const t = window.setTimeout(() => setReady(true), 25_000);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(t);
    };
  }, []);

  if (!ready || (!promptEvent && !showIos)) return null;

  const close = () => { snooze(); setPromptEvent(null); setShowIos(false); };
  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => undefined);
    close();
  };

  return (
    <div role="dialog" aria-label="Pasang aplikasi Rekhastha" data-testid="pwa-install-card"
      className="fixed inset-x-3 bottom-24 z-[60] mx-auto max-w-md rounded-2xl border border-primary/20 bg-white p-4 shadow-[0_12px_32px_-12px_rgba(6,95,70,0.45)]">
      <button onClick={close} aria-label="Tutup" className="absolute right-2 top-2 rounded-full p-1.5 text-gray-400 hover:bg-gray-100">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="text-sm font-black text-gray-900">Pasang Rekhastha di HP Anda</p>
          {promptEvent ? (
            <p className="mt-0.5 text-xs leading-snug text-gray-500">Buka langsung dari layar utama, layar penuh, tanpa mengetik alamat. Tidak memakan banyak memori.</p>
          ) : (
            <p className="mt-0.5 text-xs leading-snug text-gray-500">Ketuk tombol <b>Bagikan</b> di Safari, lalu pilih <b>Tambah ke Layar Utama</b>.</p>
          )}
        </div>
      </div>
      {promptEvent && (
        <div className="mt-3 flex gap-2">
          <button onClick={close} className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-bold text-gray-600">Nanti saja</button>
          <button onClick={install} data-testid="button-pwa-install" className="flex-1 rounded-xl bg-primary py-2 text-xs font-black text-white">Pasang</button>
        </div>
      )}
    </div>
  );
}
