# Panduan Setup Google Cloud untuk Rekhastha

## LANGKAH 1 — Buat Google Cloud Project
1. Buka https://console.cloud.google.com
2. Klik dropdown project di atas → "New Project"
3. Nama: `rekhastha-prod`
4. Klik "Create"

## LANGKAH 2 — Aktifkan APIs yang dibutuhkan
Di Google Cloud Console → "APIs & Services" → "Enable APIs":
- **Gmail API** (untuk email transaksional)
- **Cloud Storage API** (untuk backup database)
- **Cloud Run API** (untuk tugas berat)
- **Cloud Scheduler API** (untuk cron jobs)
- **Identity and Access Management (IAM) API**

## LANGKAH 3 — Google OAuth 2.0 (Login dengan Google)
1. APIs & Services → Credentials → "Create Credentials" → "OAuth 2.0 Client ID"
2. Configure consent screen dulu:
   - User Type: External
   - App name: Rekhastha
   - Support email: email Anda
   - Scopes: email, profile, openid
3. Kembali buat OAuth Client ID:
   - Application type: Web application
   - Name: Rekhastha Web
   - Authorized JavaScript origins:
     * https://rekhastha-finall-aps.vercel.app
   - Authorized redirect URIs:
     * https://rekhastha-finall-aps.vercel.app/api/auth/google/callback
     * http://localhost:3000/api/auth/google/callback
4. Salin: Client ID dan Client Secret

## LANGKAH 4 — Gmail API Service Account (Email Transaksional)
1. IAM & Admin → Service Accounts → "Create Service Account"
   - Name: rekhastha-mailer
   - Description: Sends transactional emails for Rekhastha
2. Grant role: (tidak perlu role khusus untuk Gmail API send-as)
3. Klik service account yang baru dibuat → Keys → "Add Key" → JSON
4. Download file JSON (simpan aman, jangan commit ke git)

## LANGKAH 5 — Cloud Storage Bucket (Backup DB)
1. Cloud Storage → Buckets → "Create"
   - Name: rekhastha-db-backup-prod (nama harus unik global)
   - Region: asia-southeast1 (Singapura, dekat Supabase)
   - Storage class: Standard
   - Access: Uniform (bukan Fine-grained)
2. Tambah lifecycle rule:
   - Condition: Age 30 days
   - Action: Delete

## LANGKAH 6 — Service Account untuk Backup
1. IAM & Admin → Service Accounts → "Create Service Account"
   - Name: rekhastha-backup-runner
2. Grant roles:
   - "Storage Object Creator" pada bucket rekhastha-db-backup-prod
   - (Di bucket: Permissions → Grant access → role Storage Object Creator)
3. Download JSON key

## LANGKAH 7 — Cloud Run & Cloud Scheduler
Akan di-deploy dengan script yang disediakan di folder `cloud-run/`.

## LANGKAH 8 — Variabel Environment di Vercel
Tambahkan semua env var berikut di Vercel Project Settings → Environment Variables:

# OAuth
GOOGLE_CLIENT_ID=<dari langkah 4>
GOOGLE_CLIENT_SECRET=<dari langkah 4>

# Email via Gmail API
GOOGLE_SERVICE_ACCOUNT_JSON=<isi JSON key mailer, minify jadi 1 baris>
GMAIL_SENDER_ADDRESS=<email Google Workspace atau Gmail akun service>
APP_BASE_URL=https://rekhastha-finall-aps.vercel.app

# (Opsional, pakai Resend sebagai fallback)
# RESEND_API_KEY=re_xxx
# MAIL_FROM=Rekhastha <no-reply@rekhastha.id>

---

## DOKU Payment Gateway

### 1. Daftar & Dapatkan Credentials
1. Buka https://dashboard.doku.com → daftar akun merchant
2. Masuk ke **Settings → API Keys**
3. Copy **Client ID** dan **Secret Key** (gunakan Sandbox dulu untuk testing)

### 2. Set Environment Variables di Vercel
Buka Vercel Dashboard → Project Rekhastha → **Settings → Environment Variables**, tambahkan:

| Variable            | Nilai                        |
|---------------------|------------------------------|
| `DOKU_CLIENT_ID`    | Client ID dari dashboard DOKU |
| `DOKU_SECRET_KEY`   | Secret Key dari dashboard DOKU |
| `DOKU_IS_PRODUCTION`| `false` (sandbox) / `true` (live) |
| `APP_BASE_URL`      | `https://rekhastha.my.id`    |

### 3. Jalankan Migration Supabase
Jalankan file `supabase/migrations/0006_doku_payments.sql` di Supabase SQL Editor.

### 4. Set Webhook URL di DOKU Dashboard
Di dashboard DOKU → **Settings → Notification URL**, isi:
```
https://rekhastha.my.id/api/doku/notify
```

### 5. Test Sandbox
Gunakan kartu test DOKU:
- Kartu: `4111111111111111`
- Expired: bulan/tahun di masa depan
- CVV: `123`

### 6. Go Live
Ganti `DOKU_IS_PRODUCTION` menjadi `true` di Vercel, lalu redeploy.
