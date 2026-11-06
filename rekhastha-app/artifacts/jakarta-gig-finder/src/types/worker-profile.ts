export interface WorkerProfile {
  namaLengkap: string;
  nik: string;
  tempatLahir: string;
  tanggalLahir: string;
  jenisKelamin: "L" | "P";
  whatsapp: string;
  npwp: string;
  belumPunyaNpwp: boolean;
  namaBank: string;
  nomorRekening: string;
  namaRekening: string;
  ktpUploaded: boolean;
  selfieUploaded: boolean;
  /** Status PTKP untuk hitung PPh21 otomatis. Default: TK0 (belum kawin). */
  statusPtkp?: "TK0" | "K0" | "K1" | "K2" | "K3";
}

export function isProfileComplete(profile: WorkerProfile | null | undefined): profile is WorkerProfile {
  if (!profile) return false;
  const npwpDigits = profile.npwp.replace(/\D/g, "");
  return (
    !!profile.namaLengkap.trim() &&
    /^\d{16}$/.test(profile.nik) &&
    !!profile.tempatLahir.trim() &&
    !!profile.tanggalLahir &&
    (profile.jenisKelamin === "L" || profile.jenisKelamin === "P") &&
    /^\d{10,20}$/.test(profile.whatsapp) &&
    (profile.belumPunyaNpwp || /^\d{15,16}$/.test(npwpDigits)) &&
    !!profile.namaBank.trim() &&
    !!profile.nomorRekening.trim() &&
    !!profile.namaRekening.trim() &&
    profile.ktpUploaded &&
    profile.selfieUploaded
  );
}

export function isVerified(profile: WorkerProfile): boolean {
  return (
    !!profile.namaLengkap &&
    profile.nik.length === 16 &&
    (profile.belumPunyaNpwp || profile.npwp.length >= 15) &&
    !!profile.nomorRekening &&
    profile.ktpUploaded &&
    profile.selfieUploaded
  );
}

export const bankOptions = [
  "BCA", "BRI", "BNI", "Mandiri", "CIMB Niaga", "Bank Syariah Indonesia",
  "GoPay", "OVO", "Dana", "ShopeePay", "SeaBank",
];
