import { useEffect } from "react";
import { MANUAL_PAYMENT_WHATSAPP } from "@/lib/manual-payment-contact";

const UPDATED = "13 November 2026";

type Block = { title: string; body: React.ReactNode };

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

const BLOCKS: Block[] = [
  {
    title: "1. Siapa kami",
    body: (
      <p>
        Rekhastha dioperasikan oleh Tilu Saudara Solusindo (“kami”). Kami adalah pihak yang menentukan
        tujuan dan cara pemrosesan data pribadi Anda di aplikasi ini. Kebijakan ini menjelaskan data apa
        yang kami kumpulkan, untuk apa, kepada siapa data dibagikan, berapa lama disimpan, dan hak Anda
        berdasarkan Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP).
      </p>
    ),
  },
  {
    title: "2. Data yang kami kumpulkan",
    body: (
      <div className="space-y-3">
        <div>
          <p className="font-semibold text-gray-900">Semua pengguna</p>
          <List
            items={[
              "Nama, alamat email, nomor WhatsApp, peran akun (pekerja atau pemberi kerja), dan foto profil.",
              "Kata sandi, disimpan hanya dalam bentuk hash; kami tidak dapat membacanya. Bila Anda masuk dengan Google, kami menerima nama dan email dari akun Google Anda.",
              "Pesan chat, notifikasi, penilaian, dan riwayat aktivitas di aplikasi.",
              "Data teknis untuk keamanan: alamat IP, jenis perangkat/peramban, dan catatan percobaan masuk.",
            ]}
          />
        </div>
        <div>
          <p className="font-semibold text-gray-900">Pekerja</p>
          <List
            items={[
              "Dokumen verifikasi identitas bila diminta: foto KTP dan foto selfie bersama KTP.",
              "NIK dan NPWP dalam bentuk tersamar (masked) pada lamaran, serta nama bank dan nomor rekening untuk pembayaran upah.",
              "Keterampilan, CV, portofolio, dan jawaban atas pertanyaan lowongan.",
              "Lokasi perangkat saat Anda menandai siap kerja, menggunakan radar, atau melakukan presensi, dan catatan kehadiran.",
            ]}
          />
        </div>
        <div>
          <p className="font-semibold text-gray-900">Pemberi kerja</p>
          <List
            items={[
              "Nama perusahaan, NIB bila diisi, lokasi dan rincian lowongan, serta anggota tim yang Anda tambahkan.",
              "Riwayat pembayaran (jumlah, status, metode). Data kartu atau akun pembayaran Anda diproses langsung oleh Midtrans; kami tidak menyimpannya.",
            ]}
          />
        </div>
      </div>
    ),
  },
  {
    title: "3. Untuk apa data digunakan",
    body: (
      <List
        items={[
          "Membuat dan mengamankan akun, serta memverifikasi identitas pengguna.",
          "Mempertemukan pekerja dan pemberi kerja: menampilkan lowongan, lamaran, chat, dan presensi.",
          "Memproses pembayaran, menahan dana (escrow), mencairkan upah, mengembalikan dana, dan menerbitkan invoice atau slip upah.",
          "Mengirim notifikasi dan email terkait aktivitas Anda. Jenis email dapat diatur di pengaturan profil.",
          "Mencegah penipuan dan penyalahgunaan, menyelesaikan sengketa, dan memenuhi kewajiban hukum.",
        ]}
      />
    ),
  },
  {
    title: "4. Dengan siapa data dibagikan",
    body: (
      <div className="space-y-3">
        <p>
          Kami tidak menjual data pribadi Anda. Data dibagikan hanya sebatas yang diperlukan:
        </p>
        <List
          items={[
            "Antar pengguna: saat melamar, pemberi kerja melihat data lamaran Anda. Foto profil, keterampilan, dan ringkasan reputasi dapat terlihat oleh pemberi kerja yang relevan. Dokumen identitas hanya dapat dilihat tim verifikasi kami.",
            "Agensi dan kliennya: bila pemberi kerja berupa agensi, tim HR-nya dapat melihat lamaran Anda (tanpa rekening, NIK, dan NPWP). Agensi juga dapat memasukkan Anda ke shortlist dan membagikannya lewat tautan sementara kepada klien agensi. Klien hanya melihat nama depan dan inisial, foto profil, keterampilan, rating, serta jawaban teks lamaran Anda. Kontak, rekening, NIK, CV, dan berkas unggahan tidak ditampilkan kepada klien. Klien hanya dapat memberi penilaian setuju atau tidak.",
            "Penyedia layanan yang memproses data atas nama kami: Vercel (hosting aplikasi), Supabase (basis data dan penyimpanan berkas), Midtrans (pembayaran), Google (login Google dan pengiriman email), Resend (pengiriman email), OpenStreetMap dan layanan pencarian alamatnya (peta), serta GitHub (penyimpanan cadangan yang dienkripsi).",
            "Otoritas yang berwenang, bila diwajibkan oleh hukum atau perintah pengadilan.",
          ]}
        />
        <p>
          Sebagian penyedia layanan di atas dapat menyimpan data di server di luar Indonesia. Kami hanya
          memakai penyedia yang menerapkan perlindungan keamanan yang memadai.
        </p>
      </div>
    ),
  },
  {
    title: "5. Berapa lama data disimpan",
    body: (
      <div className="space-y-2">
        <p>
          Data akun disimpan selama akun Anda aktif. Data transaksi dan keuangan dapat kami simpan lebih
          lama sepanjang diperlukan untuk kewajiban hukum, pembukuan, dan penyelesaian sengketa.
        </p>
        <p>
          Cadangan basis data dienkripsi dan disimpan paling lama 30 hari, sehingga data yang telah
          dihapus dari aplikasi dapat bertahan di cadangan sampai masa itu berakhir.
        </p>
      </div>
    ),
  },
  {
    title: "6. Keamanan",
    body: (
      <p>
        Kata sandi disimpan sebagai hash, koneksi memakai HTTPS, akses admin dibatasi dan dicatat, dokumen
        identitas disimpan terpisah dengan akses terbatas, dan cadangan basis data dienkripsi. Tidak ada
        sistem yang sepenuhnya kebal; bila terjadi kebocoran data yang berisiko bagi Anda, kami akan
        memberitahu Anda dan pihak berwenang sesuai ketentuan hukum.
      </p>
    ),
  },
  {
    title: "7. Hak Anda",
    body: (
      <div className="space-y-2">
        <p>Sesuai UU PDP, Anda berhak untuk:</p>
        <List
          items={[
            "mengetahui dan meminta salinan data pribadi Anda yang kami proses;",
            "memperbaiki data yang tidak akurat atau tidak lengkap;",
            "meminta penghapusan atau pemusnahan data pribadi Anda;",
            "menarik persetujuan pemrosesan dan mengajukan keberatan atas pemrosesan tertentu;",
            "mengajukan keluhan bila Anda merasa hak Anda dilanggar.",
          ]}
        />
        <p>
          Hubungi kami lewat WhatsApp {MANUAL_PAYMENT_WHATSAPP.display}. Kami dapat meminta bukti identitas
          sebelum memproses permintaan. Sebagian data (misalnya catatan transaksi) tidak dapat dihapus bila
          hukum mewajibkan kami menyimpannya, dan menghapus data tertentu dapat membuat Anda tidak dapat
          memakai sebagian layanan.
        </p>
      </div>
    ),
  },
  {
    title: "8. Cookie dan penyimpanan di peramban",
    body: (
      <p>
        Kami memakai cookie sesi agar Anda tetap masuk, dan penyimpanan lokal di peramban untuk preferensi
        antarmuka. Kami tidak memakai cookie iklan atau pelacak pihak ketiga untuk iklan.
      </p>
    ),
  },
  {
    title: "9. Pengguna di bawah umur",
    body: (
      <p>
        Layanan ini ditujukan untuk orang yang menurut hukum boleh bekerja dan membuat perjanjian. Bila
        Anda mengetahui ada anak di bawah umur yang memakai akun tanpa persetujuan yang sah, hubungi kami
        agar akun itu dapat ditinjau.
      </p>
    ),
  },
  {
    title: "10. Perubahan kebijakan",
    body: (
      <p>
        Kebijakan ini dapat berubah. Perubahan penting akan kami umumkan di aplikasi, dan tanggal
        pembaruan di bagian atas halaman ini akan disesuaikan.
      </p>
    ),
  },
];

export default function PrivasiPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Kebijakan Privasi · Rekhastha";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#f7f5ee] text-gray-800">
      <header className="border-b border-[#dde6df] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <a href={import.meta.env.BASE_URL} className="font-black text-[#0f7b5f]">
            Rekhastha
          </a>
          <a href={import.meta.env.BASE_URL} className="text-sm font-semibold text-gray-500 hover:text-gray-700">
            Kembali ke aplikasi
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <h1 className="text-3xl font-black text-[#0b2a22]">Kebijakan Privasi</h1>
        <p className="mt-2 text-sm text-gray-500">Diperbarui {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed">
          {BLOCKS.map((block) => (
            <section key={block.title}>
              <h2 className="mb-2 text-lg font-bold text-[#0b2a22]">{block.title}</h2>
              <div className="text-gray-700">{block.body}</div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
