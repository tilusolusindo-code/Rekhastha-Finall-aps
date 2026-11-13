import { recordSecurityEvent } from "../lib/security-events";
import { sanitizePrefs } from "../lib/notify";
import { randomBytes, randomUUID } from "node:crypto";
import { kvDelete, kvGet, kvPut } from "../lib/ephemeral";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, usersTable } from "@workspace/db";
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  getSessionUser,
  revokeAllUserSessions,
  sessionCookieOptions,
  toAuthUser,
} from "../lib/auth";
import { mailerConfigured, sendEmailVerificationEmail } from "../lib/mailer";
import {
  claimEmailVerificationToken,
  createEmailVerificationToken,
} from "../lib/email-verification";
import {
  lockoutRemaining,
  pruneAdminState,
  recordFailedAttempt,
  resetAttempts,
} from "../lib/admin";
import {
  kycUpload,
  avatarUpload,
  documentUpload,
  persistPrivateUpload,
  UploadRejectedError,
} from "../lib/upload";

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash("rekhastha-timing-dummy", 12);
  return dummyHashPromise;
}

const router: IRouter = Router();

async function requireWorkerUpload(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang dapat mengunggah berkas." });
    return;
  }
  next();
}

const roleSchema = z.enum(["pekerja", "perusahaan"]);
const GOOGLE_STATE_COOKIE = "rekhastha_google_state";
const GOOGLE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

const googleChallengeKey = (code: string): string => `google:${code}`;

function googleRedirectUri(req: Request): string | null {
  const host = req.get("host")?.trim().toLowerCase();
  if (!host) return null;
  const hostname = host.replace(/:\d+$/, "");
  const configuredHosts = [
    ...(process.env["REPLIT_DOMAINS"] ?? "").split(","),
    process.env["REPLIT_DEV_DOMAIN"] ?? "",
    // Vercel: production domain plus any custom domains (comma separated).
    process.env["VERCEL_PROJECT_PRODUCTION_URL"] ?? "",
    ...(process.env["PUBLIC_APP_HOSTS"] ?? "").split(","),
  ]
    .map((value) => value.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
  const localDevelopmentHost =
    process.env["NODE_ENV"] !== "production" &&
    ["localhost", "127.0.0.1"].includes(hostname);
  if (!configuredHosts.includes(hostname) && !localDevelopmentHost) return null;

  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  if (protocol !== "https" && !(protocol === "http" && localDevelopmentHost)) {
    return null;
  }
  return `${protocol}://${host}/api/auth/google/callback`;
}

function clearGoogleStateCookie(res: Response): void {
  res.clearCookie(GOOGLE_STATE_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/api/auth/google/callback",
  });
}

// Optional employer/worker sub-fields kept in the `profile` JSON blob.
const profileSchema = z
  .object({
    googleAvatar: z.string(),
    namaPerusahaan: z.string(),
    nibPerusahaan: z.string(),
    tipeAkun: z.enum(["perusahaan", "agensi"]),
    employerCategory: z.enum(["corporate", "household", "political"]),
    npwpPerusahaan: z.string(),
    namaKtp: z.string(),
    alamat: z.string(),
    namaOrganisasi: z.string(),
    kodeWilayah: z.string(),
    nik: z.string(),
    npwp: z.string(),
    hasNpwp: z.boolean(),
  })
  .partial();

const registerBody = z
  .object({
    email: z.string().email(),
    password: z.string().min(12),
    name: z.string().min(1),
    role: roleSchema,
    whatsapp: z.string().optional(),
    linkedWithGoogle: z.boolean().optional(),
  })
  .and(profileSchema);

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const workerProfileSchema = z
  .object({
    namaLengkap: z.string().trim().min(1).max(160),
    nik: z.string().regex(/^\d{16}$/),
    tempatLahir: z.string().trim().min(1).max(120),
    tanggalLahir: z.iso.date(),
    jenisKelamin: z.enum(["L", "P"]),
    whatsapp: z.string().trim().regex(/^\d{10,20}$/),
    npwp: z.string().regex(/^\d{0,16}$/),
    belumPunyaNpwp: z.boolean(),
    namaBank: z.string().trim().min(1).max(80),
    nomorRekening: z.string().trim().min(1).max(40),
    namaRekening: z.string().trim().min(1).max(120),
    ktpUploaded: z.boolean(),
    selfieUploaded: z.boolean(),
  })
  .superRefine((profile, context) => {
    if (!profile.belumPunyaNpwp && profile.npwp.length < 15) {
      context.addIssue({
        code: "custom",
        path: ["npwp"],
        message: "NPWP harus berisi minimal 15 digit atau pilih belum memiliki NPWP.",
      });
    }
  });

const googleCompleteBody = z.object({
  code: z.string().uuid(),
  role: roleSchema.optional(),
});

// Pakai req.ip (dinormalisasi "trust proxy"), bukan header X-Forwarded-For mentah
// yang bisa dipalsukan untuk menghindari pembatasan.
function userLoginThrottleKey(req: Request): string {
  return `user-auth:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

// Batas per akun (lintas IP) agar tebak-sandi terdistribusi tetap tertahan.
// Ambangnya lebih tinggi dari per-IP supaya orang lain sulit mengunci akun korban.
const ACCOUNT_MAX_ATTEMPTS = 10;
function accountLoginThrottleKey(email: string): string {
  return `user-acct:${email}`;
}

router.get("/auth/config", (_req, res): void => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    googleEnabled: Boolean(
      process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"],
    ),
  });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password, name, role, whatsapp, linkedWithGoogle, ...profile } =
    parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: usersTable.id, emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  // Akun yang belum terverifikasi boleh didaftarkan ulang (menimpa data lama), agar
  // orang lain tidak bisa "mengunci" email milik Anda dengan mendaftar lebih dulu.
  if (existing && existing.emailVerified) {
    res.status(409).json({ error: "Email sudah terdaftar." });
    return;
  }

  const needVerify = mailerConfigured();
  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  if (existing) {
    [user] = await db
      .update(usersTable)
      .set({
        passwordHash,
        name: name.trim(),
        role,
        whatsapp: whatsapp?.trim() || null,
        profile,
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
    await revokeAllUserSessions(existing.id);
  } else {
    [user] = await db
      .insert(usersTable)
      .values({
        id: `user-${randomUUID()}`,
        email: normalizedEmail,
        passwordHash,
        name: name.trim(),
        role,
        whatsapp: whatsapp?.trim() || null,
        linkedWithGoogle: false,
        emailVerified: !needVerify,
        profile,
      })
      .returning();
  }

  if (needVerify) {
    const vt = await createEmailVerificationToken(user.id);
    if (vt) {
      try {
        await sendEmailVerificationEmail(user.email, user.name, vt);
      } catch (error) {
        req.log.error({ error }, "Gagal mengirim email verifikasi");
      }
    }
    res.status(201).json({ needsVerification: true, email: user.email });
    return;
  }

  const token = await createSession(user.id, req.cookies?.[SESSION_COOKIE]);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.status(201).json(toAuthUser(user));
});

router.post("/auth/resend-verification", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email && mailerConfigured()) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (user && !user.emailVerified && !user.suspended) {
      const vt = await createEmailVerificationToken(user.id);
      if (vt) {
        try {
          await sendEmailVerificationEmail(user.email, user.name, vt);
        } catch (error) {
          req.log.error({ error }, "Gagal mengirim ulang email verifikasi");
        }
      }
    }
  }
  // Respons selalu sama agar tidak membocorkan email yang terdaftar.
  res.json({ ok: true });
});

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const userId = token ? await claimEmailVerificationToken(token) : null;
  if (!userId) {
    res.status(400).json({ error: "Tautan verifikasi tidak valid atau sudah kedaluwarsa." });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set({ emailVerified: true })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user || user.suspended) {
    res.status(400).json({ error: "Tautan verifikasi tidak valid atau sudah kedaluwarsa." });
    return;
  }
  const session = await createSession(user.id, req.cookies?.[SESSION_COOKIE]);
  res.cookie(SESSION_COOKIE, session, sessionCookieOptions());
  res.json(toAuthUser(user));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const throttleKey = userLoginThrottleKey(req);
  await pruneAdminState();
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const accountKey = accountLoginThrottleKey(normalizedEmail);
  const remaining = Math.max(
    await lockoutRemaining(throttleKey),
    await lockoutRemaining(accountKey),
  );
  if (remaining > 0) {
    recordSecurityEvent(req, "login_locked", "warn", "Login diblokir sementara (terlalu banyak percobaan).");
    res.status(429).json({
      error: `Terlalu banyak percobaan masuk. Coba lagi dalam ${Math.ceil(remaining / 1000)} detik.`,
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  // Selalu jalankan bcrypt (hash cadangan bila email tak dikenal) agar waktu respons
  // tidak membocorkan email mana yang terdaftar.
  const passwordOk = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !passwordOk) {
    await recordFailedAttempt(throttleKey);
    await recordFailedAttempt(accountKey, ACCOUNT_MAX_ATTEMPTS);
    recordSecurityEvent(req, "login_failed", "info", "Email atau password salah.");
    res.status(401).json({ error: "Email atau password salah." });
    return;
  }

  if (user.suspended) {
    res.status(403).json({
      error: "Akun Anda telah ditangguhkan oleh Admin Rekhastha. Hubungi dukungan.",
    });
    return;
  }

  // Hanya memblokir bila pengiriman email aktif; kalau tidak, pengguna tak punya cara memverifikasi.
  if (!user.emailVerified && mailerConfigured()) {
    res.status(403).json({
      error: "Email belum diverifikasi. Cek kotak masuk Anda untuk tautan verifikasi.",
      code: "email_not_verified",
    });
    return;
  }

  await resetAttempts(throttleKey);
  await resetAttempts(accountKey);
  const token = await createSession(user.id, req.cookies?.[SESSION_COOKIE]);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json(toAuthUser(user));
});

router.get("/auth/google/start", (req, res): void => {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    res.redirect(303, "/?google_error=not_configured");
    return;
  }
  const redirectUri = googleRedirectUri(req);
  if (!redirectUri) {
    res.redirect(303, "/?google_error=invalid_host");
    return;
  }

  const state = randomBytes(32).toString("hex");
  res.cookie(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/api/auth/google/callback",
    maxAge: 10 * 60 * 1000,
  });
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  }).toString();
  res.redirect(302, authorizeUrl.toString());
});

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const redirectUri = googleRedirectUri(req);
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const state = req.cookies?.[GOOGLE_STATE_COOKIE] as string | undefined;
  const returnedState = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";

  clearGoogleStateCookie(res);
  if (req.query.error === "access_denied") {
    res.redirect(303, "/?google_error=access_denied");
    return;
  }
  if (!state || !returnedState || state !== returnedState || !code) {
    res.redirect(303, "/?google_error=invalid_state");
    return;
  }
  if (!redirectUri || !clientId || !clientSecret) {
    res.redirect(303, `/?google_error=${redirectUri ? "not_configured" : "invalid_host"}`);
    return;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      res.redirect(303, "/?google_error=oauth_failed");
      return;
    }
    const tokenPayload = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokenPayload.access_token !== "string") {
      res.redirect(303, "/?google_error=oauth_failed");
      return;
    }

    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    });
    if (!userInfoResponse.ok) {
      res.redirect(303, "/?google_error=oauth_failed");
      return;
    }
    const googleUser = (await userInfoResponse.json()) as Record<string, unknown>;
    if (
      typeof googleUser.sub !== "string" ||
      typeof googleUser.email !== "string" ||
      typeof googleUser.name !== "string" ||
      !(googleUser.email_verified === true || googleUser.email_verified === "true")
    ) {
      res.redirect(303, "/?google_error=email_unverified");
      return;
    }
    const identity: GoogleIdentity = {
      sub: googleUser.sub,
      email: googleUser.email.trim().toLowerCase(),
      name: googleUser.name.trim(),
      ...(typeof googleUser.picture === "string" ? { picture: googleUser.picture } : {}),
    };

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, identity.email));
    if (existing) {
      if (existing.suspended) {
        res.redirect(303, "/?google_error=account_suspended");
        return;
      }
      const oldProfile = (existing.profile ?? {}) as Record<string, unknown>;
      const wasUnverified = !existing.emailVerified;
      if (wasUnverified) {
        // Pendaftar awal tak pernah membuktikan memiliki email ini; pemilik sebenarnya
        // (lewat Google) mengambil alih: password lama diganti acak, sesi dicabut.
        await revokeAllUserSessions(existing.id);
      }
      await db
        .update(usersTable)
        .set({
          ...(wasUnverified
            ? {
                emailVerified: true,
                passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
              }
            : {}),
          linkedWithGoogle: true,
          profile: {
            ...oldProfile,
            googleSub: identity.sub,
            ...(identity.picture ? { googleAvatar: identity.picture } : {}),
          },
        })
        .where(eq(usersTable.id, existing.id));
      const session = await createSession(existing.id, req.cookies?.[SESSION_COOKIE]);
      res.cookie(SESSION_COOKIE, session, sessionCookieOptions());
      res.redirect(303, "/");
      return;
    }

    const challenge = randomUUID();
    await kvPut(googleChallengeKey(challenge), identity, GOOGLE_CHALLENGE_TTL_MS);
    res.redirect(303, `/?google_code=${encodeURIComponent(challenge)}`);
  } catch (error) {
    req.log.error({ error }, "Google OAuth callback failed");
    res.redirect(303, "/?google_error=oauth_failed");
  }
});

router.post("/auth/google/complete", async (req, res): Promise<void> => {
  const parsed = googleCompleteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Permintaan login Google tidak valid." });
    return;
  }
  const identity = await kvGet<GoogleIdentity>(googleChallengeKey(parsed.data.code));
  if (!identity) {
    await kvDelete(googleChallengeKey(parsed.data.code));
    res.status(410).json({ error: "Verifikasi Google berakhir. Silakan mulai lagi." });
    return;
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, identity.email));
  if (existing) {
    await kvDelete(googleChallengeKey(parsed.data.code));
    if (existing.suspended) {
      res.status(403).json({
        error: "Akun Anda telah ditangguhkan oleh Admin Rekhastha. Hubungi dukungan.",
      });
      return;
    }
    const oldProfile = (existing.profile ?? {}) as Record<string, unknown>;
    await db
      .update(usersTable)
      .set({
        linkedWithGoogle: true,
        profile: {
          ...oldProfile,
          googleSub: identity.sub,
          ...(identity.picture ? { googleAvatar: identity.picture } : {}),
        },
      })
      .where(eq(usersTable.id, existing.id));
    const session = await createSession(existing.id, req.cookies?.[SESSION_COOKIE]);
    res.cookie(SESSION_COOKIE, session, sessionCookieOptions());
    res.json(toAuthUser(existing));
    return;
  }

  if (!parsed.data.role) {
    res.status(400).json({ error: "Pilih peran akun terlebih dahulu." });
    return;
  }
  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  const [user] = await db
    .insert(usersTable)
    .values({
      id: `google-${randomUUID()}`,
      email: identity.email,
      passwordHash,
      name: identity.name || identity.email.split("@")[0],
      role: parsed.data.role,
      linkedWithGoogle: true,
      profile: {
        googleSub: identity.sub,
        ...(identity.picture ? { googleAvatar: identity.picture } : {}),
      },
    })
    .returning();
  await kvDelete(googleChallengeKey(parsed.data.code));
  const session = await createSession(user.id, req.cookies?.[SESSION_COOKIE]);
  res.cookie(SESSION_COOKIE, session, sessionCookieOptions());
  res.status(201).json(toAuthUser(user));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await deleteSession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (user.suspended) {
    await deleteSession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(403).json({
      error: "Akun Anda telah ditangguhkan oleh Admin Rekhastha. Hubungi dukungan.",
    });
    return;
  }
  res.json(toAuthUser(user));
});

/** Akun apa pun yang sudah login boleh mengganti foto profilnya sendiri. */
async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  next();
}

function parseAvatarUpload(req: Request, res: Response, next: NextFunction): void {
  avatarUpload.single("avatar")(req, res, (err: unknown) => {
    if (err) {
      const tooBig = typeof err === "object" && err !== null && "code" in err && err.code === "LIMIT_FILE_SIZE";
      res.status(400).json({
        error: tooBig ? "Foto terlalu besar. Maksimal 2 MB." : "Format foto tidak didukung. Gunakan JPG atau PNG.",
      });
      return;
    }
    next();
  });
}

router.post("/auth/avatar", requireSession, parseAvatarUpload, async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Pilih foto terlebih dahulu." });
    return;
  }
  let filename: string;
  try {
    filename = await persistPrivateUpload(file, ["avatar"]);
  } catch (err) {
    if (err instanceof UploadRejectedError) {
      recordSecurityEvent(req, "malware_detected", "high", err.reason);
      res.status(400).json({ error: "Foto ditolak karena tidak lolos pemeriksaan keamanan." });
      return;
    }
    req.log.error({ userId: user.id }, "Failed to store avatar");
    res.status(503).json({ error: "Penyimpanan foto sedang tidak tersedia." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ avatarUrl: `/api/uploads/avatar/${filename}` })
    .where(eq(usersTable.id, user.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Akun tidak ditemukan." });
    return;
  }
  res.json(toAuthUser(updated));
});

/** Atur jenis email notifikasi yang ingin diterima (kunci yang tidak dikirim tidak berubah). */
router.patch("/auth/notification-prefs", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const merged = { ...sanitizePrefs(user.notificationPrefs), ...sanitizePrefs(req.body) };
  const [updated] = await db
    .update(usersTable)
    .set({ notificationPrefs: merged })
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(toAuthUser(updated ?? user));
});

router.delete("/auth/avatar", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ avatarUrl: null })
    .where(eq(usersTable.id, user.id))
    .returning();
  res.json(toAuthUser(updated ?? user));
});

const accountSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80, "Nama maksimal 80 karakter."),
  whatsapp: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{8,16}$/, "Nomor WhatsApp tidak valid (hanya angka, 8–16 digit).")
    .optional()
    .or(z.literal("")),
  namaPerusahaan: z.string().trim().min(2).max(120).optional(),
  alamat: z.string().trim().max(300).optional(),
});

/**
 * Edit profil dasar. Hanya field ini yang bisa diubah sendiri: nama tampilan,
 * WhatsApp, serta nama usaha dan alamat (khusus akun perusahaan). Email, peran,
 * data KTP/KYC, dan verifikasi TIDAK bisa diubah lewat sini.
 */
router.post("/auth/account", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid." });
    return;
  }
  const { name, whatsapp, namaPerusahaan, alamat } = parsed.data;

  const profile = { ...((user.profile ?? {}) as Record<string, unknown>) };
  if (user.role === "perusahaan") {
    if (namaPerusahaan !== undefined) profile["namaPerusahaan"] = namaPerusahaan;
    if (alamat !== undefined) profile["alamat"] = alamat;
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      name,
      whatsapp: whatsapp === undefined ? user.whatsapp : whatsapp || null,
      profile,
    })
    .where(eq(usersTable.id, user.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Akun tidak ditemukan." });
    return;
  }
  res.json(toAuthUser(updated));
});

router.post("/auth/profile", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (user.role !== "pekerja") {
    res.status(403).json({ error: "Hanya pekerja yang dapat menyimpan profil ini." });
    return;
  }

  const parsed = workerProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const workerProfile = parsed.data;
  const existingProfile = (user.profile ?? {}) as Record<string, unknown>;
  // Ganti rekening yang sudah pernah diisi = tahan penarikan 72 jam (lihat manual-finance.ts).
  const norm = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, "").toLowerCase() : "");
  const hadBank = Boolean(norm(existingProfile["nomorRekening"]));
  const bankChanged =
    hadBank &&
    (norm(existingProfile["nomorRekening"]) !== norm(workerProfile.nomorRekening) ||
      norm(existingProfile["namaBank"]) !== norm(workerProfile.namaBank) ||
      norm(existingProfile["namaRekening"]) !== norm(workerProfile.namaRekening));
  const profile = {
    ...existingProfile,
    ...workerProfile,
    bankChangedAt: bankChanged ? new Date().toISOString() : existingProfile["bankChangedAt"],
    namaKtp: workerProfile.namaLengkap,
    hasNpwp: !workerProfile.belumPunyaNpwp,
    workerProfile,
  };
  const [updated] = await db
    .update(usersTable)
    .set({ profile, whatsapp: workerProfile.whatsapp })
    .where(eq(usersTable.id, user.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Akun tidak ditemukan." });
    return;
  }

  req.log.info({ userId: user.id }, "Worker profile saved");
  res.json(toAuthUser(updated));
});

/**
 * KYC Identity Upload — worker submits a KTP photo and a selfie-holding-KTP
 * photo. Any resubmission (e.g. after a rejection) resets verificationStatus
 * back to "pending" so it re-enters the admin moderation queue.
 */
router.post(
  "/auth/kyc",
  requireWorkerUpload,
  kycUpload.fields([
    { name: "ktpPhoto", maxCount: 1 },
    { name: "selfieWithKtp", maxCount: 1 },
  ]),
  async (req, res): Promise<void> => {
    const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
    if (!user) {
      res.status(401).json({ error: "Tidak terautentikasi." });
      return;
    }
    if (user.role !== "pekerja") {
      res.status(403).json({ error: "Hanya pekerja yang dapat mengunggah dokumen identitas." });
      return;
    }

    const files = req.files as
      | Record<string, Express.Multer.File[] | undefined>
      | undefined;
    const ktpFile = files?.["ktpPhoto"]?.[0];
    const selfieFile = files?.["selfieWithKtp"]?.[0];

    if (!ktpFile && !selfieFile) {
      res.status(400).json({
        error: "Unggah minimal satu dokumen (Foto KTP atau Selfie dengan KTP). Format JPG/PNG, maks 5MB.",
      });
      return;
    }

    let ktpFilename: string | undefined;
    let selfieFilename: string | undefined;
    try {
      [ktpFilename, selfieFilename] = await Promise.all([
        ktpFile ? persistPrivateUpload(ktpFile, ["kyc"]) : undefined,
        selfieFile ? persistPrivateUpload(selfieFile, ["kyc"]) : undefined,
      ]);
    } catch (err) {
      if (err instanceof UploadRejectedError) {
        recordSecurityEvent(req, "malware_detected", "high", err.reason);
        res.status(400).json({ error: "Berkas ditolak karena tidak lolos pemeriksaan keamanan." });
        return;
      }
      req.log.error({ userId: user.id }, "Failed to store KYC documents");
      res.status(503).json({ error: "Penyimpanan dokumen sedang tidak tersedia." });
      return;
    }

    const updates: Partial<typeof usersTable.$inferInsert> = {
      verificationStatus: "pending",
    };
    if (ktpFilename) updates.ktpPhotoUrl = `/api/uploads/kyc/${ktpFilename}`;
    if (selfieFilename) {
      updates.selfieWithKtpUrl = `/api/uploads/kyc/${selfieFilename}`;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, user.id))
      .returning();

    req.log.info({ userId: user.id }, "Worker submitted KYC documents");
    res.json(toAuthUser(updated));
  },
);

/**
 * Profile master CV/Portfolio upload (Worker Profile Settings). These become
 * the default files auto-attached to a Regular application unless the worker
 * chooses to upload a fresh document for that specific application instead
 * (see the apply-modal flow in `POST /applications`).
 */
router.post(
  "/auth/documents",
  requireWorkerUpload,
  documentUpload.fields([
    { name: "cv", maxCount: 1 },
    { name: "portfolio", maxCount: 1 },
  ]),
  async (req, res): Promise<void> => {
    const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
    if (!user) {
      res.status(401).json({ error: "Tidak terautentikasi." });
      return;
    }
    if (user.role !== "pekerja") {
      res.status(403).json({ error: "Hanya pencari kerja yang dapat mengunggah CV dan portofolio." });
      return;
    }

    const files = req.files as
      | Record<string, Express.Multer.File[] | undefined>
      | undefined;
    const cvFile = files?.["cv"]?.[0];
    const portfolioFile = files?.["portfolio"]?.[0];

    if (!cvFile && !portfolioFile) {
      res.status(400).json({
        error: "Unggah minimal satu berkas (CV atau Portofolio). Format PDF, maks 10MB.",
      });
      return;
    }

    let cvFilename: string | undefined;
    let portfolioFilename: string | undefined;
    try {
      [cvFilename, portfolioFilename] = await Promise.all([
        cvFile ? persistPrivateUpload(cvFile, ["documents"]) : undefined,
        portfolioFile ? persistPrivateUpload(portfolioFile, ["documents"]) : undefined,
      ]);
    } catch (err) {
      if (err instanceof UploadRejectedError) {
        recordSecurityEvent(req, "malware_detected", "high", err.reason);
        res.status(400).json({ error: "Berkas ditolak karena tidak lolos pemeriksaan keamanan." });
        return;
      }
      req.log.error({ userId: user.id }, "Failed to store profile documents");
      res.status(503).json({ error: "Penyimpanan dokumen sedang tidak tersedia." });
      return;
    }

    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (cvFilename) updates.defaultCvUrl = `/api/uploads/documents/${cvFilename}`;
    if (portfolioFilename) {
      updates.defaultPortfolioUrl = `/api/uploads/documents/${portfolioFilename}`;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, user.id))
      .returning();

    req.log.info({ userId: user.id }, "Worker updated profile CV/Portfolio");
    res.json(toAuthUser(updated));
  },
);

export default router;
