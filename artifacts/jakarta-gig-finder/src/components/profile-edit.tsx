import { useRef, useState } from "react";
import { Camera, Loader2, Pencil, Trash2, X } from "lucide-react";
import type { AuthUser } from "@/types/auth";
import { removeAvatar, updateAccount, updateNotificationPrefs, uploadAvatar } from "@/lib/auth-client";

/** Perkecil foto dari kamera HP (bisa 5–10 MB) menjadi JPEG maks 640px agar muat batas 2 MB. */
async function shrinkImage(file: File, maxSide = 640): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung pengolahan gambar.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Gagal memproses foto.");
  return blob;
}

function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/** Foto kecil dengan cadangan (inisial/ikon) bila belum ada foto atau gagal dimuat. */
export function AvatarImage({ src, className, fallback }: { src?: string | null; className: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt="" className={className} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
}

interface ProfileAvatarProps {
  user: AuthUser;
  size?: number;
  className?: string;
  /** Warna latar saat belum ada foto. */
  fallbackBg?: string;
  /** Bila diisi, tombol kamera muncul dan foto bisa diganti. */
  onUserUpdated?: (user: AuthUser) => void;
}

/** Foto profil bulat + tombol ganti foto. Dipakai di halaman profil pekerja dan perusahaan. */
export function ProfileAvatar({ user, size = 80, className = "", fallbackBg = "#10B981", onUserUpdated }: ProfileAvatarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photo = user.avatarUrl || user.googleAvatar;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      setError("Gunakan foto JPG atau PNG.");
      return;
    }
    setBusy(true);
    try {
      const blob = await shrinkImage(file);
      const updated = await uploadAvatar(blob);
      onUserUpdated?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengunggah foto.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError("");
    try {
      onUserUpdated?.(await removeAvatar());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      {photo ? (
        <img
          src={photo}
          alt={`Foto ${user.name}`}
          className="w-full h-full rounded-full border-4 border-white shadow-lg object-cover bg-white"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className="w-full h-full rounded-full border-4 border-white shadow-lg flex items-center justify-center"
          style={{ background: fallbackBg }}
        >
          <span className="font-black text-white" style={{ fontSize: size * 0.3 }}>{initialsOf(user.name)}</span>
        </div>
      )}

      {busy && (
        <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-white animate-spin" />
        </div>
      )}

      {onUserUpdated && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            data-testid="avatar-input"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label="Ganti foto profil"
            className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <Camera className="w-4 h-4" />
          </button>
          {user.avatarUrl && !busy && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              aria-label="Hapus foto profil"
              className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white shadow-md flex items-center justify-center text-red-500 hover:bg-red-50"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 text-center text-[11px] font-semibold text-red-100 bg-red-600/80 rounded-lg px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}

interface EditProfileButtonProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  /** Tampilkan kolom nama usaha dan alamat (akun perusahaan). */
  company?: boolean;
}

/** Tombol "Edit Profil" + dialog untuk mengubah nama, WhatsApp, dan (perusahaan) nama usaha & alamat. */
export function EditProfileButton({ user, onUserUpdated, company = false }: EditProfileButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [whatsapp, setWhatsapp] = useState(user.whatsapp ?? "");
  const [namaPerusahaan, setNamaPerusahaan] = useState(user.namaPerusahaan ?? "");
  const [alamat, setAlamat] = useState(user.alamat ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openDialog() {
    setName(user.name);
    setWhatsapp(user.whatsapp ?? "");
    setNamaPerusahaan(user.namaPerusahaan ?? "");
    setAlamat(user.alamat ?? "");
    setError("");
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await updateAccount({
        name,
        whatsapp: whatsapp.replace(/[\s-]/g, ""),
        ...(company ? { namaPerusahaan: namaPerusahaan || undefined, alamat } : {}),
      });
      onUserUpdated(updated);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        data-testid="edit-profile-button"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-white/20 hover:bg-white/30 border border-white/30 rounded-full px-3.5 py-1.5"
      >
        <Pencil className="w-3.5 h-3.5" /> Edit Profil
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Edit profil">
          <form onSubmit={save} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-gray-900">Edit Profil</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Tutup" className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-bold text-gray-600">Nama</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-bold text-gray-600">Nomor WhatsApp</span>
              <input className={field} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" placeholder="08xxxxxxxxxx" />
            </label>

            {company && (
              <>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-gray-600">Nama Usaha</span>
                  <input className={field} value={namaPerusahaan} onChange={(e) => setNamaPerusahaan(e.target.value)} maxLength={120} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold text-gray-600">Alamat</span>
                  <textarea className={field} rows={3} value={alamat} onChange={(e) => setAlamat(e.target.value)} maxLength={300} />
                </label>
              </>
            )}

            <NotificationToggles user={user} company={company} onUserUpdated={onUserUpdated} />

            <p className="text-[11px] text-gray-400 leading-relaxed">
              Email, data KTP, dan status verifikasi tidak bisa diubah dari sini.
            </p>

            {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="flex-1 border border-gray-200 text-gray-600 font-semibold py-2.5 rounded-xl text-sm">
                Batal
              </button>
              <button type="submit" disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}


type NotifKey = "applicant" | "status" | "payment" | "payout" | "invite" | "reminder";

const WORKER_TOGGLES: Array<[NotifKey, string]> = [
  ["status", "Lamaran diterima atau ditolak"],
  ["payout", "Upah masuk ke dompet"],
  ["invite", "Ajakan bekerja dari pemberi kerja"],
  ["reminder", "Pengingat jadwal kerja (H-1)"],
];
const COMPANY_TOGGLES: Array<[NotifKey, string]> = [
  ["applicant", "Pelamar baru"],
  ["payment", "Pembayaran lowongan dan langganan"],
];

/** Pilihan jenis email notifikasi; tersimpan langsung saat diubah. */
function NotificationToggles({ user, company, onUserUpdated }: { user: AuthUser; company: boolean; onUserUpdated: (u: AuthUser) => void }) {
  const [busy, setBusy] = useState<NotifKey | null>(null);
  const [err, setErr] = useState("");
  const toggles = company ? COMPANY_TOGGLES : WORKER_TOGGLES;

  async function flip(key: NotifKey, next: boolean) {
    setBusy(key);
    setErr("");
    try {
      onUserUpdated(await updateNotificationPrefs({ [key]: next }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan pengaturan.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset className="space-y-2 border-t border-gray-100 pt-3">
      <legend className="text-xs font-bold text-gray-600 mb-1">Notifikasi email</legend>
      {toggles.map(([key, label]) => {
        const on = user.notificationPrefs?.[key] !== false;
        return (
          <label key={key} className="flex items-center justify-between gap-3 text-sm text-gray-700">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={on}
              disabled={busy === key}
              onChange={(e) => void flip(key, e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
              data-testid={`notif-toggle-${key}`}
            />
          </label>
        );
      })}
      {err && <p role="alert" className="text-xs font-semibold text-red-600">{err}</p>}
    </fieldset>
  );
}
