import { ArrowRight, ArrowUpRight, BriefcaseBusiness, CalendarClock, Clock3, MapPin, Search, Store, UserRoundSearch } from "lucide-react";
import { RekhasthaCrest } from "../components/rekhastha-logo";
import heroImage from "./rekhastha-marketplace-hero.jpg";
import "./marketing-landing.css";

export default function MarketingLanding(props: { onLogin: () => void; onRegister: () => void }) {
  const { onLogin, onRegister } = props;

  return (
    <main className="rekha-landing">
      <header className="rk-header">
        <div className="rk-container rk-header-inner">
          <div className="rk-brand" data-testid="brand-rekhastha">
            <RekhasthaCrest size={43} />
            <div className="rk-brand-copy">
              <span className="rk-brand-name">Rekhastha</span>
              <span className="rk-brand-by">by Tilu Saudara Solusindo</span>
            </div>
          </div>
          <nav className="rk-nav" aria-label="Navigasi utama">
            <a href="#cara-kerja" data-testid="link-cara-kerja">Cara kerja</a>
            <a href="#jenis-pekerjaan" data-testid="link-jenis-pekerjaan">Jenis pekerjaan</a>
            <a href="#untuk-siapa" data-testid="link-untuk-siapa">Untuk siapa</a>
          </nav>
          <div className="rk-header-actions">
            <button type="button" className="rk-button rk-button-quiet" onClick={onLogin} data-testid="button-login-header">Masuk</button>
            <button type="button" className="rk-button rk-button-primary" onClick={onRegister} data-testid="button-register-header">Daftar</button>
          </div>
        </div>
      </header>

      <section className="rk-hero" aria-labelledby="rk-hero-title">
        <div className="rk-container rk-hero-grid">
          <div className="rk-hero-copy">
            <div className="rk-eyebrow"><span className="rk-eyebrow-mark" />Peluang kerja harian di seluruh Indonesia</div>
            <h1 className="rk-display" id="rk-hero-title" data-testid="text-hero-title">Kerja yang pas,<br />di <em>waktu</em> yang tepat.</h1>
            <p className="rk-hero-lede" data-testid="text-hero-description">
              Rekhastha mempertemukan pemberi kerja yang butuh bantuan dengan orang yang siap bekerja. Cari gig harian, atau temukan tenaga untuk kebutuhan usaha Anda.
            </p>
            <div className="rk-hero-ctas">
              <button type="button" className="rk-button rk-button-primary" onClick={onRegister} data-testid="button-register-worker">
                Cari pekerjaan <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button type="button" className="rk-button rk-button-gold" onClick={onRegister} data-testid="button-register-employer">
                Pasang gig <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>
            <p className="rk-hero-note"><strong>Satu tempat untuk dua kebutuhan.</strong> Pilih peran saat mendaftar.</p>
          </div>

          <div className="rk-visual" aria-label="Suasana kerja di usaha lokal Indonesia">
            <div className="rk-photo-frame">
              <img src={heroImage} alt="Pekerja menyiapkan pesanan di sebuah kafe lingkungan Indonesia" data-testid="img-hero-worker" />
              <span className="rk-photo-label">Kesempatan tumbuh, dekat dari rumah</span>
            </div>
            <svg className="rk-sunburst" viewBox="0 0 80 80" fill="none" aria-hidden="true">
              <circle cx="40" cy="40" r="13" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="40" cy="40" r="4" fill="currentColor" />
              {Array.from({ length: 12 }, (_, index) => (
                <line key={index} x1="40" y1="7" x2="40" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${index * 30} 40 40)`} />
              ))}
            </svg>
            <div className="rk-float-card rk-gig-card" aria-label="Contoh gig mendesak">
              <small><span className="rk-gig-dot" />Gig mendesak</small>
              <strong>Bantuan kru acara</strong>
              <span><MapPin size={12} aria-hidden="true" /> Lokasi pilihan</span>
            </div>
            <div className="rk-float-card rk-time-card">
              <div className="rk-time-icon"><Clock3 size={19} aria-hidden="true" /></div>
              <div><strong>Atur waktumu</strong><small>Gig cepat atau terjadwal</small></div>
            </div>
          </div>
        </div>
      </section>

      <div className="rk-ribbon" aria-label="Fitur utama Rekhastha">
        <div className="rk-container rk-ribbon-inner">
          <div className="rk-ribbon-item"><span className="rk-ribbon-icon"><Clock3 size={17} /></span>Gig instan saat dibutuhkan</div>
          <div className="rk-ribbon-item"><span className="rk-ribbon-icon"><CalendarClock size={17} /></span>Pekerjaan terjadwal</div>
          <div className="rk-ribbon-item"><span className="rk-ribbon-icon"><MapPin size={17} /></span>Peluang di seluruh Indonesia</div>
        </div>
      </div>

      <section className="rk-section" id="untuk-siapa" aria-labelledby="rk-pathways-title">
        <div className="rk-container">
          <div className="rk-section-heading">
            <span className="rk-section-kicker">Dua sisi, satu tujuan</span>
            <h2 id="rk-pathways-title" className="rk-display">Temukan yang Anda cari.</h2>
            <p>Butuh bantuan untuk hari ini, atau mencari tambahan penghasilan? Mulai dari kebutuhan Anda.</p>
          </div>
          <div className="rk-pathways">
            <article className="rk-path-card employer" data-testid="card-employer">
              <div className="rk-path-top">
                <span className="rk-path-icon"><Store size={22} aria-hidden="true" /></span>
                <span className="rk-path-number">UNTUK PEMBERI KERJA</span>
              </div>
              <h3>Butuh tenaga untuk usaha?</h3>
              <p>Pasang gig untuk kebutuhan mendesak atau rencanakan pekerjaan di tanggal yang Anda tentukan. Jelaskan peran, waktu, dan lokasi.</p>
              <button type="button" className="rk-button rk-button-primary" onClick={onRegister} data-testid="button-register-employer-card">Mulai pasang gig <ArrowRight size={15} /></button>
            </article>
            <article className="rk-path-card worker" data-testid="card-worker">
              <div className="rk-path-top">
                <span className="rk-path-icon"><UserRoundSearch size={22} aria-hidden="true" /></span>
                <span className="rk-path-number">UNTUK PENCARI KERJA</span>
              </div>
              <h3>Cari gig yang cocok.</h3>
              <p>Jelajahi peluang kerja harian, lihat detail gig, lalu ajukan diri untuk pekerjaan yang sesuai dengan waktu dan minat Anda.</p>
              <button type="button" className="rk-button rk-button-gold" onClick={onRegister} data-testid="button-register-worker-card">Jelajahi pekerjaan <Search size={15} /></button>
            </article>
          </div>
        </div>
      </section>

      <section className="rk-gig-section" id="jenis-pekerjaan" aria-labelledby="rk-gig-title">
        <div className="rk-container rk-gig-layout">
          <div className="rk-gig-copy">
            <span className="rk-section-kicker">Fleksibel sesuai kebutuhan</span>
            <h2 id="rk-gig-title" className="rk-display">Hari ini atau nanti. Anda yang tentukan.</h2>
            <p>Setiap kebutuhan punya waktunya sendiri. Rekhastha menyediakan dua cara untuk menemukan atau mengisi pekerjaan harian.</p>
          </div>
          <div className="rk-gig-list">
            <article className="rk-gig-row" data-testid="card-gig-instan">
              <span className="rk-gig-symbol"><Clock3 size={20} aria-hidden="true" /></span>
              <div className="rk-gig-row-copy"><strong>Gig instan</strong><span>Untuk kebutuhan mendesak yang perlu ditangani segera.</span></div>
              <span className="rk-gig-tag">Butuh cepat</span>
            </article>
            <article className="rk-gig-row" data-testid="card-gig-terjadwal">
              <span className="rk-gig-symbol"><CalendarClock size={20} aria-hidden="true" /></span>
              <div className="rk-gig-row-copy"><strong>Pekerjaan terjadwal</strong><span>Rencanakan pekerjaan pada tanggal dan waktu tertentu.</span></div>
              <span className="rk-gig-tag">Atur jadwal</span>
            </article>
            <article className="rk-gig-row" data-testid="card-gig-lokasi">
              <span className="rk-gig-symbol"><MapPin size={20} aria-hidden="true" /></span>
              <div className="rk-gig-row-copy"><strong>Detail yang jelas</strong><span>Periksa informasi peran, waktu, dan lokasi sebelum melamar.</span></div>
              <span className="rk-gig-tag">Pilih sesuai</span>
            </article>
          </div>
        </div>
      </section>

      <section className="rk-how" id="cara-kerja" aria-labelledby="rk-how-title">
        <div className="rk-container">
          <div className="rk-section-heading">
            <span className="rk-section-kicker">Mulai dengan mudah</span>
            <h2 id="rk-how-title" className="rk-display">Dari kebutuhan jadi kesempatan.</h2>
            <p>Langkah yang jelas, baik Anda ingin mengisi gig maupun mengajukan diri.</p>
          </div>
          <div className="rk-steps">
            <article className="rk-step" data-testid="step-one">
              <span className="rk-step-no">01</span>
              <h3>Buat akun</h3>
              <p>Daftar dan tentukan apakah Anda ingin mencari pekerjaan atau merekrut tenaga.</p>
            </article>
            <article className="rk-step" data-testid="step-two">
              <span className="rk-step-no">02</span>
              <h3>Temukan kecocokan</h3>
              <p>Pemberi kerja pasang gig; pencari kerja menelusuri detail dan peluang yang tersedia.</p>
            </article>
            <article className="rk-step" data-testid="step-three">
              <span className="rk-step-no">03</span>
              <h3>Ambil langkah berikutnya</h3>
              <p>Ajukan diri ke gig yang sesuai, atau tinjau pelamar untuk kebutuhan usaha Anda.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="rk-closing" aria-labelledby="rk-closing-title">
        <div className="rk-container">
          <div className="rk-closing-panel">
            <div className="rk-closing-content">
              <span className="rk-section-kicker" style={{ color: "#e7c46d" }}>Langkah pertama dimulai di sini</span>
              <h2 id="rk-closing-title" className="rk-display">Ada gig untuk dicari. Ada bantuan untuk ditemukan.</h2>
              <p>Gabung Rekhastha untuk menjelajahi pekerjaan harian atau menemukan orang yang tepat untuk kebutuhan usaha Anda.</p>
              <div className="rk-closing-actions">
                <button type="button" className="rk-button rk-button-gold" onClick={onRegister} data-testid="button-register-footer">Daftar sekarang <ArrowRight size={15} /></button>
                <button type="button" className="rk-button rk-button-quiet" onClick={onLogin} data-testid="button-login-footer">Sudah punya akun? Masuk</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="rk-footer">
        <div className="rk-container rk-footer-inner">
          <div className="rk-brand">
            <RekhasthaCrest size={33} />
            <div className="rk-brand-copy">
              <span className="rk-brand-name" style={{ fontSize: 16 }}>Rekhastha</span>
              <span className="rk-brand-by">by Tilu Saudara Solusindo</span>
            </div>
          </div>
          <p className="rk-footer-copy" data-testid="text-footer-description">Marketplace gig harian untuk pemberi kerja dan pencari kerja di seluruh Indonesia.</p>
          <span className="rk-footer-meta">© {new Date().getFullYear()} <strong>Tilu Saudara Solusindo</strong></span>
        </div>
      </footer>
    </main>
  );
}
