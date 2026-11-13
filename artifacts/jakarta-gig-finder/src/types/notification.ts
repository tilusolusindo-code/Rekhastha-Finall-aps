import type {
  ApplicationSupportingInfo,
  JobApplicationQuestion,
} from "./custom-job";

export type ApplicationStatus = "baru" | "ditinjau" | "diterima" | "ditolak" | "selesai";

export interface ApplicationAttachment {
  id: number;
  /** ID pertanyaan perekrut yang dijawab dengan berkas ini (null = dokumen generik). */
  questionId?: string | null;
  fileName: string;
  contentType: string;
  kind: string;
  url: string;
}

export interface ApplicationNotification {
  id: number;
  /** Server-assigned DB row id — present after a successful POST /api/applications. */
  serverId?: number;
  /** Dimuat ulang dari server saat refresh: tampil di panel, tapi tidak memicu toast "pelamar baru". */
  hydrated?: boolean;
  jobId: number;
  jobTitle: string;
  /** DB user-id of the worker who applied — used to scope the chat conversation. */
  workerId: string;
  applicantName: string;
  /** Foto profil pelamar (hanya ditampilkan setelah pelamar diterima). */
  applicantAvatarUrl?: string;
  /** Statistik publik pekerja untuk membantu pemberi kerja memilih. */
  workerSkills?: string[];
  workerStats?: { ratingAvg: number | null; ratingCount: number; completedJobs: number };
  isFavorite?: boolean;
  applicantNikMasked: string;
  applicantNpwpMasked: string;
  hasNpwp: boolean;
  bank: string;
  rekening: string;
  timestamp: Date;
  status: ApplicationStatus;
  /** Worker-facing breakdown fields — only present for completed gig entries. */
  nominal?: number;
  jumlahHari?: number;
  hiringMode?: "cepat" | "lama";
  /** CV/Portfolio actually attached to this application — Regular jobs only. */
  cvUrl?: string;
  portfolioUrl?: string;
  applicationQuestions?: JobApplicationQuestion[];
  applicationAnswers?: Record<string, string>;
  supportingInfo?: ApplicationSupportingInfo;
  uploadedFiles?: ApplicationAttachment[];
  /** Shortlist untuk klien agensi (hanya terlihat oleh pemberi kerja/HR). */
  shortlistedAt?: string | null;
  clientDecision?: "setuju" | "tidak" | null;
  clientNote?: string | null;
}

export function maskName(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].slice(0, 2) + "***";
  return parts[0] + " " + parts.slice(1).map((p) => p[0] + "***").join(" ");
}

export function maskNik(nik: string): string {
  if (nik.length < 8) return nik;
  return nik.slice(0, 4) + "••••••••" + nik.slice(-4);
}

export function maskNpwp(npwp: string): string {
  if (!npwp || npwp.length < 4) return "—";
  return "••••••" + npwp.slice(-4);
}

export function maskRekening(rek: string): string {
  if (rek.length < 6) return rek;
  return rek.slice(0, 3) + "••••" + rek.slice(-3);
}
