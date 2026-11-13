import { useEffect, useState } from "react";
import { Calculator, Check, ChevronDown, MapPin, Menu, QrCode, Users, X } from "lucide-react";
import { RekhasthaCrest } from "../components/rekhastha-logo";
import "./marketing-landing.css";

const NAV_LINKS = [
  { href: "#untuk-siapa", label: "Untuk siapa", testId: "link-untuk-siapa" },
  { href: "#alat-bisnis", label: "Alat pemberi kerja", testId: "link-alat-bisnis" },
  { href: "#cara-kerja", label: "Cara kerja", testId: "link-cara-kerja" },
  { href: "#pertanyaan", label: "Pertanyaan", testId: "link-pertanyaan" },
];

const WORKER_POINTS = [
  "Lihat lowongan terdekat di peta dan dapat notifikasi saat ada lowongan baru di sekitar Anda.",
  "Upah, jam kerja, dan lokasi terlihat jelas sebelum Anda melamar.",
  "Chat langsung dengan pemberi kerja di dalam aplikasi.",
  "Catat kehadiran dengan QR dan pantau penghasilan Anda di satu tempat.",
];

const EMPLOYER_POINTS = [
  "Pasang lowongan instan untuk kebutuhan mendadak, atau lowongan terjadwal untuk tanggal yang sudah pasti.",
  "Rincian biaya tampil saat membuat lowongan, sebelum Anda membayar.",
  "Lihat para pelamar, lalu beri penilaian setelah pekerjaan selesai.",
  "Catat kehadiran dengan QR dan GPS, lalu hitung upah dengan Rekhastha Bisnis.",
];

const TOOLS = [
  {
    icon: QrCode,
    title: "Presensi QR dan GPS",
    body: "Pekerja memindai QR di lokasi kerja dan hanya bisa mulai bekerja di dalam radius yang Anda tentukan.",
  },
  {
    icon: Calculator,
    title: "Kalkulator gaji harian",
    body: "Hitung upah kotor dan bersih per shift, termasuk lembur dan potongan.",
  },
  {
    icon: Calculator,
    title: "Kalkulator PPh 21",
    body: "Hitung PPh 21 untuk kontrak bulanan tanpa menghitung manual.",
  },
  {
    icon: Users,
    title: "Manajemen tim",
    body: "Atur anggota tim dengan peran HR, Supervisor, dan Finance.",
  },
];

const STEPS = [
  {
    title: "Daftar dan pilih peran",
    body: "Pilih apakah Anda ingin mencari kerja atau mencari tenaga kerja. Jika diminta verifikasi, pemeriksaan identitas dilakukan oleh tim Rekhastha.",
  },
  {
    title: "Pasang atau temukan lowongan",
    body: "Pemberi kerja mengisi jenis pekerjaan, waktu, lokasi, dan upah. Pencari kerja melihat lowongan di sekitarnya, lalu melamar.",
  },
  {
    title: "Bekerja dan selesaikan",
    body: "Catat kehadiran lewat aplikasi, kerjakan sesuai kesepakatan, lalu saling memberi penilaian.",
  },
];

const RULES = [
  {
    title: "Biaya dan pembayaran",
    body: "Rincian biaya tampil saat lowongan dibuat. Pembayaran lewat transfer dikonfirmasi secara manual, dan lowongan aktif setelah status pembayarannya dikonfirmasi di aplikasi.",
  },
  {
    title: "Verifikasi identitas",
    body: "Pemeriksaan identitas dilakukan oleh tim Rekhastha. Aplikasi tidak melakukan pencocokan wajah atau sidik jari otomatis.",
  },
  {
    title: "Jaminan sosial",
    body: "Presensi di Rekhastha tidak dengan sendirinya memberikan BPJS Ketenagakerjaan, asuransi, atau jaminan sosial lain.",
  },
];

const FAQ = [
  {
    q: "Apa itu Rekhastha?",
    a: "Rekhastha adalah aplikasi kerja harian di Indonesia. Pencari kerja menemukan lowongan terdekat lengkap dengan upah dan jam kerja, sedangkan pemilik usaha memasang lowongan, mencatat kehadiran dengan QR dan GPS, dan menghitung upah.",
  },
  {
    q: "Bagaimana cara mencari kerja harian di Rekhastha?",
    a: "Buat akun dengan peran pencari kerja, lihat lowongan terdekat di peta, periksa upah, jam, dan lokasinya, lalu kirim lamaran dari aplikasi.",
  },
  {
    q: "Bagaimana cara memasang lowongan kerja harian?",
    a: "Buat akun dengan peran pemberi kerja, lalu isi jenis pekerjaan, waktu, lokasi, dan upah. Rincian biaya tampil sebelum Anda membayar, dan lowongan aktif setelah pembayarannya dikonfirmasi.",
  },
  {
    q: "Apa bedanya lowongan instan dan lowongan terjadwal?",
    a: "Lowongan instan untuk kebutuhan yang harus terisi segera dan langsung diberitahukan ke pekerja di sekitar lokasi. Lowongan terjadwal untuk pekerjaan yang tanggal dan jamnya sudah ditentukan lebih dulu.",
  },
  {
    q: "Bagaimana presensi QR dan GPS bekerja?",
    a: "Pekerja memindai QR di lokasi kerja, dan aplikasi memeriksa lokasi perangkatnya. Pekerja hanya bisa mulai bekerja di dalam radius yang ditentukan pemberi kerja.",
  },
  {
    q: "Apakah ada lowongan di kota saya?",
    a: "Anda bisa memilih provinsi dan kota saat mencari atau memasang lowongan. Ada tidaknya lowongan tergantung pemberi kerja di wilayah Anda.",
  },
  {
    q: "Apakah pekerja mendapat BPJS atau asuransi dari Rekhastha?",
    a: "Tidak otomatis. Presensi di Rekhastha tidak dengan sendirinya memberikan BPJS Ketenagakerjaan, asuransi, atau jaminan sosial lain.",
  },
  {
    q: "Bagaimana jika ada masalah dengan suatu pekerjaan?",
    a: "Gunakan fitur keluhan atau sengketa di aplikasi. Pengajuan Anda akan ditinjau oleh tim Rekhastha.",
  },
];

const FAQ_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
});

/** Tampilan produk (ilustrasi) yang menggantikan foto hero. */
function ProductStage() {
  return (
    <figure className="rl-stage-wrap">
      <div className="rl-stage" aria-hidden="true">
        <div className="rl-job rl-job-main">
          <div className="rl-job-top">
            <span className="rl-chip">Baru</span>
            <span className="rl-job-dist"><MapPin size={14} />1,2 km</span>
          </div>
          <strong className="rl-job-title">Barista</strong>
          <span className="rl-job-meta">Kafe lokal, hari ini 14.00 sampai 22.00</span>
          <div className="rl-job-bottom">
            <b className="rl-job-pay">Rp 280.000<small> per shift</small></b>
            <span className="rl-job-apply">Lamar</span>
          </div>
        </div>

        <div className="rl-job rl-job-side rl-job-a">
          <div>
            <strong>Kru acara</strong>
            <span>Gedung pertemuan, 3,8 km</span>
            <span>Besok, 08.00 sampai 18.00</span>
          </div>
          <b>Rp 200.000<small>per hari</small></b>
        </div>

        <div className="rl-job rl-job-side rl-job-b">
          <div>
            <strong>Pelayan restoran</strong>
            <span>Rumah makan, 4,5 km</span>
            <span>Sabtu, 10.00 sampai 18.00</span>
          </div>
          <b>Rp 200.000<small>per shift</small></b>
        </div>

        <div className="rl-ticket">
          <span className="rl-ticket-icon"><QrCode size={22} /></span>
          <div>
            <strong>Presensi masuk</strong>
            <span>Pukul 13.58, dalam radius lokasi</span>
          </div>
        </div>
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />

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
                Lowongan kerja harian di dekat Anda.
                <span>Tenaga kerja harian untuk usaha Anda.</span>
              </h1>
              <p className="rl-lede" data-testid="text-hero-description">
                Rekhastha adalah aplikasi kerja harian di Indonesia. Pencari kerja melihat lowongan terdekat lengkap dengan upah, jam, dan lokasinya. Pemilik usaha memasang lowongan, mencatat kehadiran dengan QR dan GPS, lalu menghitung upah, semuanya dalam satu aplikasi.
              </p>
              <div className="rl-hero-actions">
                <button type="button" className="rl-btn rl-btn-primary rl-btn-lg" onClick={onRegister} data-testid="button-register-worker">
                  Saya cari kerja
                </button>
                <button type="button" className="rl-btn rl-btn-outline rl-btn-lg" onClick={onRegister} data-testid="button-register-employer">
                  Saya cari tenaga kerja
                </button>
              </div>
              <p className="rl-hero-login">
                Sudah punya akun?{" "}
                <button type="button" onClick={onLogin} data-testid="button-login-hero">Masuk</button>
              </p>
            </div>

            <div className="rl-hero-media" data-testid="img-hero-worker-frame">
              <ProductStage />
            </div>
          </div>
        </section>

        <section className="rl-facts" aria-label="Ringkasan layanan">
          <div className="rl-container rl-facts-grid">
            <div>
              <h2>Lowongan instan</h2>
              <p>Butuh orang segera? Lowongan langsung diberitahukan ke pekerja di sekitar lokasi.</p>
            </div>
            <div>
              <h2>Lowongan terjadwal</h2>
              <p>Sudah tahu tanggal dan jamnya? Atur dari jauh-jauh hari.</p>
            </div>
            <div>
              <h2>Seluruh Indonesia</h2>
              <p>Pilih provinsi dan kota Anda, lalu lihat apa yang tersedia.</p>
            </div>
          </div>
        </section>

        <section className="rl-section" id="untuk-siapa" aria-labelledby="rl-who-title">
          <div className="rl-container">
            <h2 className="rl-h2" id="rl-who-title">Satu aplikasi untuk pencari kerja dan pemberi kerja</h2>
            <p className="rl-section-intro">Pilih peran sesuai kebutuhan Anda saat mendaftar.</p>
            <div className="rl-split">
              <article className="rl-panel rl-panel-worker" data-testid="card-worker">
                <h3>Untuk pencari kerja harian</h3>
                <ul className="rl-checks">
                  {WORKER_POINTS.map((point) => (
                    <li key={point}><Check size={18} aria-hidden="true" /><span>{point}</span></li>
                  ))}
                </ul>
                <button type="button" className="rl-btn rl-btn-primary" onClick={onRegister} data-testid="button-register-worker-card">
                  Daftar untuk cari kerja
                </button>
              </article>
              <article className="rl-panel rl-panel-employer" data-testid="card-employer">
                <h3>Untuk pemberi kerja dan pemilik usaha</h3>
                <ul className="rl-checks">
                  {EMPLOYER_POINTS.map((point) => (
                    <li key={point}><Check size={18} aria-hidden="true" /><span>{point}</span></li>
                  ))}
                </ul>
                <button type="button" className="rl-btn rl-btn-dark" onClick={onRegister} data-testid="button-register-employer-card">
                  Daftar untuk cari tenaga
                </button>
              </article>
            </div>
          </div>
        </section>

        <section className="rl-tools" id="alat-bisnis" aria-labelledby="rl-tools-title">
          <div className="rl-container rl-tools-grid">
            <div>
              <h2 className="rl-h2" id="rl-tools-title">Kelola pekerja harian tanpa catatan manual</h2>
              <p className="rl-section-intro">
                Rekhastha Bisnis membantu pemberi kerja mencatat kehadiran, menghitung upah, dan mengatur tim di satu tempat.
              </p>
              <div className="rl-tools-links">
                <a href="/absensi-qr-gps/">Tentang absensi QR dan GPS</a>
                <a href="/kalkulator-pph21/">Dasar perhitungan PPh 21</a>
              </div>
            </div>
            <ul className="rl-tool-list">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <li key={tool.title}>
                    <span className="rl-tool-icon"><Icon size={22} aria-hidden="true" /></span>
                    <div>
                      <h3>{tool.title}</h3>
                      <p>{tool.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="rl-section rl-section-warm" id="cara-kerja" aria-labelledby="rl-how-title">
          <div className="rl-container">
            <h2 className="rl-h2" id="rl-how-title">Cara kerja Rekhastha dalam tiga langkah</h2>
            <ol className="rl-steps">
              {STEPS.map((step, index) => (
                <li key={step.title} data-testid={`step-${index + 1}`}>
                  <span className="rl-step-no" aria-hidden="true">{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="rl-section" id="transparansi" aria-labelledby="rl-rules-title">
          <div className="rl-container rl-rules-grid">
            <div>
              <h2 className="rl-h2" id="rl-rules-title">Sebelum mulai: biaya, verifikasi, dan jaminan sosial</h2>
              <p className="rl-section-intro">Kami jelaskan dari awal supaya tidak ada salah paham.</p>
            </div>
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

        <section className="rl-section rl-section-warm" id="pertanyaan" aria-labelledby="rl-faq-title">
          <div className="rl-container rl-faq-grid">
            <h2 className="rl-h2" id="rl-faq-title">Pertanyaan umum tentang kerja harian di Rekhastha</h2>
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
          <div className="rl-container">
            <div className="rl-closing-panel">
              <div>
                <h2 id="rl-closing-title">Siap mulai? Lihat lowongan di sekitar Anda.</h2>
                <p>Buat akun, pilih peran, lalu mulai dari pekerjaan atau kebutuhan tenaga pertama Anda.</p>
              </div>
              <div className="rl-closing-actions">
                <button type="button" className="rl-btn rl-btn-primary rl-btn-lg" onClick={onRegister} data-testid="button-register-footer">
                  Daftar sekarang
                </button>
                <button type="button" className="rl-btn rl-btn-outline rl-btn-lg" onClick={onLogin} data-testid="button-login-footer">
                  Masuk
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="rl-footer">
        <div className="rl-container rl-footer-grid">
          <div className="rl-footer-about">
            <div className="rl-brand">
              <RekhasthaCrest size={32} />
              <span className="rl-brand-copy">
                <span className="rl-brand-name">Rekhastha</span>
                <span className="rl-brand-by">by Tilu Saudara Solusindo</span>
              </span>
            </div>
            <p className="rl-footer-copy" data-testid="text-footer-description">
              Aplikasi kerja harian untuk pencari kerja dan pemberi kerja di seluruh Indonesia, dikembangkan oleh Tilu Saudara Solusindo.
            </p>
          </div>
          <nav className="rl-footer-nav" aria-label="Halaman Rekhastha">
            <h2>Pelajari</h2>
            <a href="/lowongan-kerja-harian-jakarta/">Lowongan kerja harian Jakarta</a>
            <a href="/absensi-qr-gps/">Absensi QR dan GPS</a>
            <a href="/kalkulator-pph21/">Kalkulator PPh 21</a>
            <a href="/privasi" data-testid="link-privacy">Kebijakan Privasi</a>
          </nav>
          <div className="rl-footer-nav">
            <h2>Akun</h2>
            <button type="button" onClick={onLogin}>Masuk</button>
            <button type="button" onClick={onRegister}>Daftar</button>
          </div>
        </div>
        <div className="rl-container rl-footer-meta">© {new Date().getFullYear()} Tilu Saudara Solusindo</div>
      </footer>
    </div>
  );
}
