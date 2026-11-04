#!/usr/bin/env bash
# ============================================================
# Rekhastha — Google Cloud Setup & Deploy Script
# Jalankan SETELAH membuat project di Console (SETUP_GUIDE.md)
# ============================================================
set -euo pipefail

# ── Konfigurasi: sesuaikan sebelum dijalankan ──────────────
PROJECT_ID="rekhastha-prod"           # nama project yang Anda buat
REGION="asia-southeast1"              # Singapura (terdekat ke Supabase)
BACKUP_BUCKET="rekhastha-db-backup-prod"
MAILER_SA="rekhastha-mailer"
BACKUP_SA="rekhastha-backup-runner"
# ──────────────────────────────────────────────────────────

echo "=== [1/8] Set project ==="
gcloud config set project "$PROJECT_ID"

echo "=== [2/8] Enable APIs ==="
gcloud services enable \
  gmail.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  artifactregistry.googleapis.com

echo "=== [3/8] Create GCS backup bucket ==="
if ! gsutil ls "gs://$BACKUP_BUCKET" &>/dev/null; then
  gsutil mb -p "$PROJECT_ID" -l "$REGION" -b on "gs://$BACKUP_BUCKET"
  gsutil lifecycle set - "gs://$BACKUP_BUCKET" << 'LC'
{
  "rule": [{"action": {"type": "Delete"}, "condition": {"age": 30}}]
}
LC
  echo "Bucket created: gs://$BACKUP_BUCKET"
else
  echo "Bucket already exists: gs://$BACKUP_BUCKET"
fi

echo "=== [4/8] Create service accounts ==="
for SA in "$MAILER_SA" "$BACKUP_SA"; do
  if ! gcloud iam service-accounts describe "${SA}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
    gcloud iam service-accounts create "$SA" --display-name "$SA"
    echo "Created SA: $SA"
  else
    echo "SA already exists: $SA"
  fi
done

echo "=== [5/8] Grant GCS permission to backup SA ==="
gsutil iam ch \
  "serviceAccount:${BACKUP_SA}@${PROJECT_ID}.iam.gserviceaccount.com:roles/storage.objectCreator" \
  "gs://$BACKUP_BUCKET"

echo "=== [6/8] Download SA keys ==="
gcloud iam service-accounts keys create "mailer-sa-key.json" \
  --iam-account="${MAILER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts keys create "backup-sa-key.json" \
  --iam-account="${BACKUP_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
echo "Keys saved: mailer-sa-key.json & backup-sa-key.json"
echo "⚠  SIMPAN FILE INI DI TEMPAT AMAN, JANGAN COMMIT KE GIT!"

echo "=== [7/8] Build & deploy Cloud Run services ==="
# Artifact Registry
AR_REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/rekhastha"
if ! gcloud artifacts repositories describe rekhastha --location="$REGION" &>/dev/null; then
  gcloud artifacts repositories create rekhastha \
    --repository-format=docker --location="$REGION" --description="Rekhastha images"
fi
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# DB Backup Job
echo "--- Building db-backup ---"
gcloud builds submit cloud-run/db-backup \
  --tag "${AR_REPO}/db-backup:latest"
gcloud run jobs create rekhastha-db-backup \
  --image="${AR_REPO}/db-backup:latest" \
  --region="$REGION" \
  --set-env-vars="GCS_BACKUP_BUCKET=${BACKUP_BUCKET}" \
  --set-secrets="DATABASE_URL=rekhastha-db-url:latest,GOOGLE_SERVICE_ACCOUNT_JSON=rekhastha-backup-sa:latest" \
  --max-retries=2 \
  --parallelism=1 || \
gcloud run jobs update rekhastha-db-backup \
  --image="${AR_REPO}/db-backup:latest" --region="$REGION"

# PDF Export Service
echo "--- Building pdf-export ---"
gcloud builds submit cloud-run/pdf-export \
  --tag "${AR_REPO}/pdf-export:latest"
gcloud run deploy rekhastha-pdf-export \
  --image="${AR_REPO}/pdf-export:latest" \
  --region="$REGION" \
  --no-allow-unauthenticated \
  --set-env-vars="GCS_BACKUP_BUCKET=${BACKUP_BUCKET}" \
  --set-secrets="DATABASE_URL=rekhastha-db-url:latest,GOOGLE_SERVICE_ACCOUNT_JSON=rekhastha-backup-sa:latest" \
  --memory=1Gi --cpu=1 --timeout=120

echo "=== [8/8] Setup nightly backup schedule ==="
gcloud scheduler jobs create http rekhastha-nightly-backup \
  --location="$REGION" \
  --schedule="0 2 * * *" \
  --time-zone="Asia/Jakarta" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/rekhastha-db-backup:run" \
  --http-method=POST \
  --oauth-service-account-email="${BACKUP_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --message-body='{}' || \
gcloud scheduler jobs update http rekhastha-nightly-backup \
  --location="$REGION" --schedule="0 2 * * *"

echo ""
echo "✅ SELESAI! Langkah berikutnya:"
echo "1. Tambah secrets di Vercel (lihat SETUP_GUIDE.md Langkah 8)"
echo "2. isi GOOGLE_SERVICE_ACCOUNT_JSON di Vercel dengan isi file mailer-sa-key.json (minify ke 1 baris)"
echo "3. Untuk Gmail API: enable domain-wide delegation di mailer SA jika pakai Google Workspace"
echo "4. PDF export URL tersimpan di output Cloud Run deploy di atas — isi ke CLOUD_RUN_PDF_URL di Vercel"
