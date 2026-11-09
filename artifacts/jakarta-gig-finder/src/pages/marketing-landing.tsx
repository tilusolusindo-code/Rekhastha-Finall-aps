import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronDown, Menu, X } from "lucide-react";
import { RekhasthaCrest } from "../components/rekhastha-logo";
import heroImage from "./rekhastha-marketplace-hero.jpg";
import "./marketing-landing.css";

const NAV_LINKS = [
  { href: "#untuk-siapa", label: "Untuk siapa", testId: "link-untuk-siapa" },
  { href: "#cara-kerja", label: "Cara kerja", testId: "link-cara-kerja" },
  { href: "#transparansi", label: "Aturan main", testId: "link-transparansi" },
  { href: "#pertanyaan", label: "Pertanyaan", testId: "link-pertanyaan" },
];

const WORKER_POINTS = [
  "Peta radar menampilkan gig terdekat, dan notifikasi berbunyi saat ada gig baru di sekitar Anda.",
  "Peran, upah, waktu, dan lokasi terlihat jelas sebelum Anda memutuskan melamar.",
  "Berkomunikasi dengan pemberi kerja lewat chat di dalam aplikasi.",
  "Catat kehadiran dengan QR dan pantau penghasilan Anda di satu tempat.",
];

const EMPLOYER_POINTS = [
  "Pasang gig instan untuk kebutuhan hari ini, atau posting reguler untuk jadwal yang sudah pasti.",
  "Rincian biaya ditampilkan saat lowongan dibuat, sebelum Anda melakukan pembayaran.",
  "Tinjau pelamar, lalu beri penilaian setelah pekerjaan selesai.",
  "Rekhastha Bisnis menambahkan QR presensi berbasis lokasi dan kalkulator upah harian untuk tim Anda.",
];

const STEPS = [
  {
    title: "Daftar dan pilih peran",
    body: "Tentukan apakah Anda mencari pekerjaan atau memasang lowongan. Jika diminta verifikasi, pemeriksaan identitas dilakukan oleh tim Rekhastha.",
  },
  {
    title: "Pasang atau temukan gig",
    body: "Pemberi kerja mengisi peran, waktu, lokasi, dan upah. Pencari kerja menelusuri gig di sekitarnya lalu melamar.",
  },
  {
    title: "Bekerja dan selesaikan",
    body: "Catat kehadiran lewat aplikasi, kerjakan gig sesuai kesepakatan, lalu saling memberi penilaian.",
  },
];

const RULES = [
  {
    title: "Biaya dan pembayaran",
    body: "Rincian biaya tampil saat lowongan dibuat. Pembayaran lewat transfer dikonfirmasi secara manual, dan lowongan aktif setelah status pembayarannya dikonfirmasi di aplikasi.",
  },
  {
    title: "Verifikasi identitas",
    body: "Pemeriksaan identitas dilakukan oleh tim Rekhastha. Aplikasi tidak melakukan pencocokan biometrik otomatis.",
  },
  {
    title: "Jaminan sosial",
    body: "Presensi di Rekhastha tidak dengan sendirinya memberikan BPJS Ketenagakerjaan, asuransi, atau jaminan sosial lain.",
  },
];

const FAQ = [
  {
    q: "Siapa yang bisa memakai Rekhastha?",
    a: "Pencari kerja yang ingin mengambil pekerjaan harian, serta pemberi kerja, baik usaha maupun perorangan, yang membutuhkan tenaga tambahan. Peran dipilih saat mendaftar.",
  },
  {
    q: "Apa bedanya gig instan dan pekerjaan terjadwal?",
    a: "Gig instan untuk kebutuhan yang harus terisi segera dan disiarkan ke pekerja di sekitar lokasi. Pekerjaan terjadwal untuk kebutuhan yang tanggal dan jamnya sudah ditentukan lebih dulu.",
  },
  {
    q: "Apakah gig tersedia di kota saya?",
    a: "Anda dapat memilih provinsi dan kota saat mencari atau memasang gig. Ketersediaan pekerjaan bergantung pada pemberi kerja yang memasang gig di wilayah Anda.",
  },
  {
    q: "Bagaimana jika ada masalah dengan suatu pekerjaan?",
    a: "Gunakan fitur keluhan atau sengketa di aplikasi. Pengajuan Anda ditinjau oleh tim Rekhastha.",
  },
];

function SampleDevice() {
  return (
    <figure className="rl-device-wrap">
      <div className="rl-device" aria-hidden="true">
        <div className="rl-device-bar">
          <span className="rl-device-title">Gig di sekitar Anda</span>
          <span className="rl-device-live"><i />Radar aktif</span>
        </div>
        <ul className="rl-device-list">
          <li className="is-new">
            <div>
              <span className="rl-device-badge">Baru</span>
              <strong>Barista</strong>
              <small>Kafe lokal · 1,2 km</small>
              <small>Hari ini, 14.00 – 22.00</small>
            </div>
            <b>Rp 280.000<small>per shift</small></b>
          </li>
          <li>
            <div>
              <strong>Kru acara</strong>
              <small>Gedung pertemuan · 3,8 km</small>
              <small>Besok, 08.00 – 18.00</small>
            </div>
            <b>Rp 200.000<small>per hari</small></b>
          </li>
          <li>
            <div>
              <strong>Pelayan restoran</strong>
              <small>Rumah makan · 4,5 km</small>
              <small>Sabtu, 10.00 – 18.00</small>
            </div>
            <b>Rp 200.000<small>per shift</small></b>
          </li>
        </ul>
      </div>
      <figcaption>Contoh tampilan. Nama, jarak, dan upah hanya ilustrasi.</figcaption>
    </figure>
  );
}

export default function MarketingLanding(props: { onLogin: () => void; onRegister: () => void }) {
  const { onLogin, onRegister } = props;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="rekha-landing">
      <header className={`rl-header${scrolled || menuOpen ? " is-scrolled" : ""}`}>
        <div className="rl-container rl-header-inner">
          <a className="rl-brand" href="#top" onClick={closeMenu} data-testid="brand-rekhastha" aria-label="Rekhastha, beranda">
            <RekhasthaCrest size={38} />
            <span className="rl-brand-copy">
              <span className="rl-brand-name">Rekhastha</span>
              <span className="rl-brand-by">by Tilu Saudara Solusindo</span>
            </span>
          </a>

          <nav className="rl-nav" aria-label="Navigasi utama">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} data-testid={link.testId}>{link.label}</a>
            ))}
          </nav>

          <div className="rl-header-actions">
            <button type="button" className="rl-btn rl-btn-text" onClick={onLogin} data-testid="button-login-header">Masuk</button>
            <button type="button" className="rl-btn rl-btn-primary" onClick={onRegister} data-testid="button-register-header">Daftar</button>
            <button
              type="button"
              className="rl-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="rl-mobile-menu"
              aria-label={menuOpen ? "Tutup menu" : "Buka menu"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="rl-mobile-menu" id="rl-mobile-menu" aria-label="Menu seluler">
            <div className="rl-container">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} onClick={closeMenu}>{link.label}</a>
              ))}
              <button type="button" className="rl-btn rl-btn-outline" onClick={() => { closeMenu(); onLogin(); }}>Masuk ke akun</button>
            </div>
          </nav>
        )}
      </header>

      <main id="top">
        <section className="rl-hero" aria-labelledby="rl-hero-title">
          <div className="rl-container rl-hero-grid">
            <div className="rl-hero-copy">
              <h1 id="rl-hero-title" data-testid="text-hero-title">
                Pekerjaan harian yang lebih mudah dicari, lebih mudah diisi.
              </h1>
              <p className="rl-lede" data-testid="text-hero-description">
                Rekhastha adalah marketplace gig harian di Indonesia. Pemberi kerja memasang kebutuhannya, pencari kerja melihat peluang di sekitarnya, lalu keduanya terhubung lewat aplikasi.
              </p>
              <div className="rl-hero-actions">
                <button type="button" className="rl-btn rl-btn-primary rl-btn-lg" onClick={onRegister} data-testid="button-register-worker">
                  Saya cari pekerjaan <ArrowRight size={17} aria-hidden="true" />
                </button>
                <button type="button" className="rl-btn rl-btn-outline rl-btn-lg" onClick={onRegister} data-testid="button-register-employer">
                  Saya mau pasang gig
                </button>
              </div>
              <p className="rl-hero-login">
                Sudah punya akun?{" "}
                <button type="button" onClick={onLogin} data-testid="button-login-hero">Masuk</button>
              </p>
            </div>

            <div className="rl-hero-media" data-testid="img-hero-worker-frame">
              <img
                src={heroImage}
                alt="Pekerja menyiapkan pesanan di sebuah kafe lingkungan di Indonesia"
                width={1024}
                height={1024}
                data-testid="img-hero-worker"
              />
            </div>
          </div>
        </section>

        <section className="rl-facts" aria-label="Ringkasan layanan">
          <div className="rl-container rl-facts-grid">
            <div>
              <h2>Gig instan</h2>
              <p>Disiarkan ke pekerja di sekitar lokasi, lengkap dengan notifikasi.</p>
            </div>
            <div>
              <h2>Pekerjaan terjadwal</h2>
              <p>Tetapkan tanggal dan jam untuk pekerjaan yang bisa direncanakan.</p>
            </div>
            <div>
              <h2>Seluruh Indonesia</h2>
              <p>Pilih provinsi dan kota saat mencari atau memasang gig.</p>
            </div>
          </div>
        </section>

        <section className="rl-section" id="untuk-siapa" aria-labelledby="rl-who-title">
          <div className="rl-container">
            <h2 className="rl-h2" id="rl-who-title">Dua kebutuhan, satu aplikasi</h2>
            <div className="rl-split">
              <article className="rl-split-col" data-testid="card-worker">
                <p className="rl-split-label">Pencari kerja</p>
                <h3>Temukan gig yang cocok dengan waktu Anda</h3>
                <ul className="rl-checks">
                  {WORKER_POINTS.map((point) => (
                    <li key={point}><Check size={18} aria-hidden="true" /><span>{point}</span></li>
                  ))}
                </ul>
                <button type="button" className="rl-btn rl-btn-primary" onClick={onRegister} data-testid="button-register-worker-card">
                  Daftar sebagai pencari kerja
                </button>
              </article>
              <article className="rl-split-col" data-testid="card-employer">
                <p className="rl-split-label">Pemberi kerja</p>
                <h3>Isi kebutuhan tenaga tanpa proses yang berbelit</h3>
                <ul className="rl-checks">
                  {EMPLOYER_POINTS.map((point) => (
                    <li key={point}><Check size={18} aria-hidden="true" /><span>{point}</span></li>
                  ))}
                </ul>
                <button type="button" className="rl-btn rl-btn-outline" onClick={onRegister} data-testid="button-register-employer-card">
                  Daftar sebagai pemberi kerja
                </button>
              </article>
            </div>
          </div>
        </section>

        <section className="rl-section rl-section-tint" id="cara-kerja" aria-labelledby="rl-how-title">
          <div className="rl-container rl-how-grid">
            <div>
              <h2 className="rl-h2" id="rl-how-title">Cara kerjanya</h2>
              <ol className="rl-steps">
                {STEPS.map((step, index) => (
                  <li key={step.title} data-testid={`step-${index + 1}`}>
                    <span className="rl-step-no">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <SampleDevice />
          </div>
        </section>

        <section className="rl-section" id="transparansi" aria-labelledby="rl-rules-title">
          <div className="rl-container">
            <h2 className="rl-h2" id="rl-rules-title">Aturan main yang perlu Anda ketahui sejak awal</h2>
            <p className="rl-section-intro">
              Beberapa hal sering disalahpahami di platform kerja harian. Berikut penjelasan singkatnya.
            </p>
            <div className="rl-rules">
              {RULES.map((rule) => (
                <div key={rule.title} className="rl-rule">
                  <h3>{rule.title}</h3>
                  <p>{rule.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rl-section rl-section-tint" id="pertanyaan" aria-labelledby="rl-faq-title">
          <div className="rl-container rl-faq-grid">
            <h2 className="rl-h2" id="rl-faq-title">Pertanyaan yang sering diajukan</h2>
            <div className="rl-faq">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>
                    <span>{item.q}</span>
                    <ChevronDown size={20} aria-hidden="true" />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="rl-closing" aria-labelledby="rl-closing-title">
          <div className="rl-container rl-closing-inner">
            <div>
              <h2 id="rl-closing-title">Lihat apa yang tersedia di sekitar Anda</h2>
              <p>Buat akun, pilih peran, dan mulai dari pekerjaan atau kebutuhan tenaga pertama Anda.</p>
            </div>
            <div className="rl-closing-actions">
              <button type="button" className="rl-btn rl-btn-light rl-btn-lg" onClick={onRegister} data-testid="button-register-footer">
                Daftar sekarang <ArrowRight size={17} aria-hidden="true" />
              </button>
              <button type="button" className="rl-btn rl-btn-ghost-light rl-btn-lg" onClick={onLogin} data-testid="button-login-footer">
                Masuk
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="rl-footer">
        <div className="rl-container rl-footer-inner">
          <div className="rl-brand">
            <RekhasthaCrest size={32} />
            <span className="rl-brand-copy">
              <span className="rl-brand-name">Rekhastha</span>
              <span className="rl-brand-by">by Tilu Saudara Solusindo</span>
            </span>
          </div>
          <p className="rl-footer-copy" data-testid="text-footer-description">
            Marketplace gig harian untuk pemberi kerja dan pencari kerja di seluruh Indonesia.
          </p>
          <span className="rl-footer-meta">© {new Date().getFullYear()} Tilu Saudara Solusindo</span>
        </div>
      </footer>
    </div>
  );
}
