import "./auth.css";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Mail, Lock, User, Phone, ArrowRight, ShieldCheck, Building2, Home, Landmark, MapPin, IdCard, FileText, KeyRound, CheckCircle2, Sparkles } from "lucide-react";
import { AuthUser, UserRole, EmployerCategory } from "@/types/auth";
import RoleSelectModal from "@/components/role-select-modal";
import TermsModal from "@/components/terms-modal";
import { RekhasthaLogo } from "@/components/rekhastha-logo";
import { AuthError, fetchGoogleAuthAvailability, login, loginWithGoogle, register, startGoogleLogin, type RegisterPayload } from "@/lib/auth-client";

interface AuthPageProps {
  onComplete: (user: AuthUser) => void;
  onBack: () => void;
  initialTab: AuthTab;
}

type AuthTab = "masuk" | "daftar";
type AuthMode = "main" | "forgot" | "reset" | "reset_done";

async function requestPasswordReset(email: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "same-origin", body: JSON.stringify({ email }),
  });
  return res.json();
}

async function submitPasswordReset(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "same-origin", body: JSON.stringify({ token, newPassword }),
  });
  return res.json();
}

export default function AuthPage({ onComplete, onBack, initialTab }: AuthPageProps) {
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [mode, setMode] = useState<AuthMode>("main");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [forgotEmail, setForgotEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");

  const [isEmployer, setIsEmployer] = useState(false);
  const [employerCategory, setEmployerCategory] = useState<EmployerCategory>("corporate");
  const [namaPerusahaan, setNamaPerusahaan] = useState("");
  const [npwpPerusahaan, setNpwpPerusahaan] = useState("");
  const [namaKtp, setNamaKtp] = useState("");
  const [alamat, setAlamat] = useState("");
  const [namaOrganisasi, setNamaOrganisasi] = useState("");
  const [kodeWilayah, setKodeWilayah] = useState("");

  const [pendingRegister, setPendingRegister] = useState<Omit<RegisterPayload, "role"> | null>(null);
  const [pendingGoogle, setPendingGoogle] = useState(false);
  const [googleCode, setGoogleCode] = useState<string | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("google_code");
    const googleError = url.searchParams.get("google_error");
    const resetTokenParam = url.searchParams.get("reset_token");
    if (resetTokenParam) { setResetToken(resetTokenParam); setMode("reset"); }
    if (code) { setGoogleCode(code); setPendingGoogle(true); setShowRoleModal(true); }
    if (googleError) {
      const errors: Record<string, string> = {
        not_configured: "Login Google belum aktif.",
        access_denied: "Login Google dibatalkan.",
        invalid_state: "Sesi login Google berakhir. Silakan coba lagi.",
        email_unverified: "Akun Google harus menggunakan email yang sudah terverifikasi.",
        oauth_failed: "Verifikasi Google gagal. Silakan coba lagi.",
        invalid_host: "Alamat aplikasi tidak cocok dengan konfigurasi login Google.",
        account_suspended: "Akun Anda ditangguhkan. Hubungi dukungan Rekhastha.",
      };
      setError(errors[googleError] ?? "Login Google gagal. Silakan coba lagi.");
    }
    if (code || googleError || resetTokenParam) {
      url.searchParams.delete("google_code");
      url.searchParams.delete("google_error");
      url.searchParams.delete("reset_token");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchGoogleAuthAvailability().then((enabled) => { if (active) setGoogleEnabled(enabled); });
    return () => { active = false; };
  }, []);

  const describeError = (e: unknown, fallback: string) =>
    e instanceof AuthError ? e.message : fallback;

  const handleRoleSelected = async (role: UserRole) => {
    setError(null); setLoading(true);
    try {
      const user = pendingGoogle
        ? googleCode ? await loginWithGoogle(googleCode, role) : null
        : pendingRegister ? await register({ ...pendingRegister, role }) : null;
      if (user) { setShowRoleModal(false); onComplete(user); }
    } catch (e) { setShowRoleModal(false); setError(describeError(e, "Gagal membuat akun.")); }
    finally { setLoading(false); setPendingGoogle(false); setGoogleCode(null); setPendingRegister(null); }
  };

  const handleConventional = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!email.includes("@")) { setError("Email tidak valid."); return; }
    if (password.length < 6) { setError("Password minimal 6 karakter."); return; }
    if (tab === "daftar" && password.length < 12) { setError("Gunakan kata sandi minimal 12 karakter untuk akun baru."); return; }
    if (tab === "masuk") {
      setLoading(true);
      try { onComplete(await login(email, password)); }
      catch (e) { setError(describeError(e, "Gagal masuk.")); }
      finally { setLoading(false); }
      return;
    }
    if (!name.trim()) { setError("Nama akun wajib diisi."); return; }
    const employerFields = isEmployer ? buildEmployerFields() : {};
    setPendingRegister({ name: name.trim(), email, password, whatsapp: whatsapp || undefined, ...employerFields });
    setShowRoleModal(true);
  };

  const buildEmployerFields = (): Partial<AuthUser> => {
    switch (employerCategory) {
      case "corporate": return { employerCategory, namaPerusahaan: namaPerusahaan.trim() || undefined, npwpPerusahaan: npwpPerusahaan.trim() || undefined };
      case "household": return { employerCategory, namaKtp: namaKtp.trim() || undefined, alamat: alamat.trim() || undefined };
      case "political": return { employerCategory, namaOrganisasi: namaOrganisasi.trim() || undefined, kodeWilayah: kodeWilayah.trim() || undefined };
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!forgotEmail.includes("@")) { setError("Format email tidak valid."); return; }
    setLoading(true);
    try {
      const result = await requestPasswordReset(forgotEmail);
      if (result.ok === false && result.error) setError(result.error);
      else setForgotMessage("Cek kotak masuk Anda — tautan reset berlaku 15 menit. Periksa folder spam jika tidak muncul.");
    } catch { setError("Gagal memproses permintaan. Coba lagi."); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (newPassword.length < 8) { setError("Kata sandi minimal 8 karakter."); return; }
    if (newPassword !== newPasswordConfirm) { setError("Konfirmasi kata sandi tidak cocok."); return; }
    setLoading(true);
    try {
      const result = await submitPasswordReset(resetToken, newPassword);
      if (result.ok) setMode("reset_done");
      else setError(result.error ?? "Gagal mereset kata sandi.");
    } catch { setError("Gagal mereset kata sandi. Coba lagi."); }
    finally { setLoading(false); }
  };

  // ── Forgot ─────────────────────────────────────────────
  if (mode === "forgot") return (
    <Shell subtitle="Reset kata sandi">
      <button type="button" onClick={() => { setMode("main"); setError(null); }} className="rk-auth-back">
        ← Kembali masuk
      </button>
      <div className="rk-auth-icon-wrap"><KeyRound className="rk-auth-icon" /></div>
      <h2 className="rk-auth-title">Lupa kata sandi?</h2>
      <p className="rk-auth-desc">Masukkan email terdaftar. Kami kirim tautan untuk membuat kata sandi baru.</p>
      {!forgotMessage ? (
        <form onSubmit={handleForgotPassword} className="rk-auth-form">
          <Field icon={<Mail />} type="email" placeholder="Alamat email terdaftar"
            value={forgotEmail} onChange={setForgotEmail} autoComplete="email" />
          {error && <ErrorMsg>{error}</ErrorMsg>}
          <SubmitBtn loading={loading} icon={<KeyRound />}>Kirim Tautan Reset</SubmitBtn>
        </form>
      ) : (
        <div className="rk-auth-success">
          <CheckCircle2 className="rk-success-icon" />
          <p>{forgotMessage}</p>
          <button type="button" onClick={() => { setMode("main"); setForgotEmail(""); setForgotMessage(""); setError(null); }}
            className="rk-auth-link-btn">
            Kembali ke halaman masuk →
          </button>
        </div>
      )}
    </Shell>
  );

  // ── Reset ──────────────────────────────────────────────
  if (mode === "reset") return (
    <Shell>
      <div className="rk-auth-icon-wrap"><KeyRound className="rk-auth-icon" /></div>
      <h2 className="rk-auth-title">Buat kata sandi baru</h2>
      <p className="rk-auth-desc">Gunakan minimal 8 karakter.</p>
      <form onSubmit={handleResetPassword} className="rk-auth-form">
        <PasswordField placeholder="Kata sandi baru (min. 8 karakter)" value={newPassword}
          onChange={setNewPassword} show={showNewPass} toggle={() => setShowNewPass(p => !p)} autoComplete="new-password" />
        <Field icon={<Lock />} type="password" placeholder="Konfirmasi kata sandi"
          value={newPasswordConfirm} onChange={setNewPasswordConfirm} autoComplete="new-password" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitBtn loading={loading} icon={<ShieldCheck />}>Simpan Kata Sandi</SubmitBtn>
      </form>
    </Shell>
  );

  // ── Reset Done ─────────────────────────────────────────
  if (mode === "reset_done") return (
    <Shell>
      <div className="rk-auth-success rk-auth-success--centered">
        <div className="rk-auth-icon-wrap rk-auth-icon-wrap--green"><CheckCircle2 className="rk-auth-icon" /></div>
        <h2 className="rk-auth-title">Kata sandi diperbarui!</h2>
        <p className="rk-auth-desc">Silakan masuk dengan kata sandi baru Anda.</p>
        <SubmitBtn loading={false} icon={<ArrowRight />}
          onClick={() => { setMode("main"); setPassword(""); setNewPassword(""); setNewPasswordConfirm(""); setResetToken(""); }}>
          Masuk sekarang
        </SubmitBtn>
      </div>
    </Shell>
  );

  // ── Main ───────────────────────────────────────────────
  return (
    <Shell subtitle="Temukan dan kelola pekerjaan harian">
      <button type="button" onClick={onBack} data-testid="button-back-to-landing" className="rk-auth-back">
        ← Beranda
      </button>

      {/* Tab switcher */}
      <div className="rk-auth-tabs" role="tablist">
        <div className="rk-auth-tab-indicator" style={{ transform: tab === "masuk" ? "translateX(0)" : "translateX(100%)" }} />
        <button role="tab" aria-selected={tab === "masuk"} onClick={() => { setTab("masuk"); setError(null); }}
          className={`rk-auth-tab ${tab === "masuk" ? "rk-auth-tab--active" : ""}`}>Masuk</button>
        <button role="tab" aria-selected={tab === "daftar"} onClick={() => { setTab("daftar"); setError(null); }}
          className={`rk-auth-tab ${tab === "daftar" ? "rk-auth-tab--active" : ""}`}>Daftar Baru</button>
      </div>

      {/* Google */}
      {googleEnabled && (
        <button type="button" onClick={() => { setError(null); startGoogleLogin(); }} disabled={loading}
          className="rk-google-btn">
          <GoogleIcon />
          <span>Lanjutkan dengan Google</span>
        </button>
      )}
      {googleEnabled && <Divider />}

      {/* Form */}
      <form onSubmit={handleConventional} className="rk-auth-form">
        {tab === "daftar" && (
          <Field icon={<User />} type="text" placeholder="Nama lengkap" value={name} onChange={setName} autoComplete="name" />
        )}
        <Field icon={<Mail />} type="email" placeholder="Alamat email" value={email} onChange={setEmail} autoComplete="email" />
        {tab === "daftar" && (
          <Field icon={<Phone />} type="tel" placeholder="Nomor WhatsApp (opsional)" value={whatsapp} onChange={setWhatsapp} autoComplete="tel" />
        )}
        <PasswordField placeholder={tab === "daftar" ? "Kata sandi (min. 12 karakter)" : "Kata sandi"}
          value={password} onChange={setPassword} show={showPass} toggle={() => setShowPass(p => !p)}
          autoComplete={tab === "daftar" ? "new-password" : "current-password"} />

        {tab === "masuk" && (
          <div className="rk-auth-forgot-row">
            <button type="button" onClick={() => { setMode("forgot"); setForgotEmail(email); setError(null); }}
              className="rk-auth-link-btn">Lupa kata sandi?</button>
          </div>
        )}

        {/* Employer toggle */}
        {tab === "daftar" && (
          <div className="rk-employer-box">
            <label className="rk-employer-toggle">
              <input type="checkbox" checked={isEmployer} onChange={e => setIsEmployer(e.target.checked)}
                className="rk-checkbox" data-testid="checkbox-employer" />
              <Sparkles className="rk-employer-spark" />
              <span className="rk-employer-label">Saya Pemberi Kerja</span>
              <span className="rk-employer-sub">Perusahaan / Individu / Organisasi</span>
            </label>
            {isEmployer && (
              <div className="rk-employer-fields">
                <div className="rk-category-grid">
                  {([
                    { id: "corporate" as EmployerCategory, icon: <Building2 />, label: "Perusahaan" },
                    { id: "household" as EmployerCategory, icon: <Home />, label: "Rumah Tangga" },
                    { id: "political" as EmployerCategory, icon: <Landmark />, label: "Organisasi" },
                  ]).map(c => (
                    <button key={c.id} type="button" onClick={() => setEmployerCategory(c.id)}
                      data-testid={`radio-${c.id}`}
                      className={`rk-category-btn ${employerCategory === c.id ? "rk-category-btn--active" : ""}`}>
                      <span className="rk-category-icon">{c.icon}</span>
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
                <div className="rk-auth-form">
                  {employerCategory === "corporate" && <>
                    <Field icon={<Building2 />} type="text" placeholder="Nama PT / CV" value={namaPerusahaan} onChange={setNamaPerusahaan} />
                    <Field icon={<FileText />} type="text" placeholder="Nomor NPWP (opsional)" value={npwpPerusahaan} onChange={setNpwpPerusahaan} />
                  </>}
                  {employerCategory === "household" && <>
                    <Field icon={<IdCard />} type="text" placeholder="Nama sesuai KTP" value={namaKtp} onChange={setNamaKtp} />
                    <Field icon={<MapPin />} type="text" placeholder="Alamat" value={alamat} onChange={setAlamat} />
                  </>}
                  {employerCategory === "political" && <>
                    <Field icon={<Landmark />} type="text" placeholder="Nama organisasi / sayap partai" value={namaOrganisasi} onChange={setNamaOrganisasi} />
                    <Field icon={<MapPin />} type="text" placeholder="Kode wilayah / dapil" value={kodeWilayah} onChange={setKodeWilayah} />
                  </>}
                </div>
              </div>
            )}
          </div>
        )}

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <SubmitBtn loading={loading} icon={<ArrowRight />}>
          {tab === "masuk" ? "Masuk ke Rekhastha" : "Buat Akun"}
        </SubmitBtn>
      </form>

      <p className="rk-auth-legal">
        Dengan mendaftar Anda menyetujui{" "}
        <button type="button" onClick={() => setShowTerms(true)} className="rk-auth-link-btn">
          syarat penggunaan (draf)
        </button>.{" "}
        Kebijakan privasi final sedang disiapkan.
      </p>

      {showRoleModal && <RoleSelectModal onSelect={handleRoleSelected} isGoogle={pendingGoogle} />}
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </Shell>
  );
}

// ── Shell: panel merek + formulir ──────────────────────────────
// PENTING: harus di luar AuthPage agar tidak di-recreate setiap render
function Shell({ children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rk-auth-shell">
      <div className="rk-auth-header">
        <div className="rk-auth-brand">
          <RekhasthaLogo size={38} variant="light" showSubtitle wordmarkClassName="text-[21px] font-display" />
          <p className="rk-auth-subtitle">Pekerjaan harian yang lebih mudah dicari, lebih mudah diisi.</p>
        </div>
        <p className="rk-auth-aside-foot">© {new Date().getFullYear()} Tilu Saudara Solusindo</p>
      </div>
      <div className="rk-auth-body">
        <div className="rk-auth-card">{children}</div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function Field({ icon, type, placeholder, value, onChange, autoComplete }: {
  icon: React.ReactNode; type: string; placeholder: string; value: string;
  onChange: (v: string) => void; autoComplete?: string;
}) {
  return (
    <div className="rk-field">
      <span className="rk-field-icon" aria-hidden="true">{icon}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        className="rk-field-input" />
    </div>
  );
}

function PasswordField({ placeholder, value, onChange, show, toggle, autoComplete }: {
  placeholder: string; value: string; onChange: (v: string) => void;
  show: boolean; toggle: () => void; autoComplete?: string;
}) {
  return (
    <div className="rk-field">
      <span className="rk-field-icon" aria-hidden="true"><Lock /></span>
      <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete} className="rk-field-input rk-field-input--pw" />
      <button type="button" onClick={toggle} aria-label={show ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        className="rk-field-eye">
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

function SubmitBtn({ loading, icon, children, onClick }: {
  loading: boolean; icon: React.ReactNode; children: React.ReactNode; onClick?: () => void;
}) {
  return (
    <button type={onClick ? "button" : "submit"} disabled={loading} onClick={onClick}
      className="rk-submit-btn">
      {loading
        ? <span className="rk-spinner" aria-hidden="true" />
        : <>{children}<span className="rk-submit-icon">{icon}</span></>}
    </button>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rk-error">{children}</p>;
}

function Divider() {
  return (
    <div className="rk-divider" aria-hidden="true">
      <span />
      <small>atau</small>
      <span />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
      <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
      <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
      <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
    </svg>
  );
}
