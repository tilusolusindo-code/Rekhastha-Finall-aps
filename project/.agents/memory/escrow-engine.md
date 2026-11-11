---
name: Escrow Engine Architecture
description: Rekhastha escrow/e-wallet system — rates, status lifecycle, split calc, and action ownership across components.
---

## Current and legacy fee model
- Every new gig, both regular and Instan Kilat, stores `feeRate: 0` and snapshots a flat employer admin fee by category; active trial/subscription waives it.
- `PLATFORM_FEE_RATES` (umum 3%, terampil 5%, profesional 8%) and `getFeeRate` remain for legacy category-tiered escrow rows and math checks; do not apply them to new postings.
- Worker payouts use the saved full-wage snapshot for new and migrated gigs. Historical percentage data remains only for legacy compatibility and is not a new posting charge.
- `jobCategory` and `feeRate` persist in DB columns `job_category` / `fee_rate`.
- Tax-free: no PPh/PPN deductions anywhere. Admin fee if company wins dispute: 5% of gross (`ADMIN_DISPUTE_FEE`).

**Why:** the fixed posting fee is separate from wages; preserving the old rates is necessary only for historical compatibility.

**How to apply:** read fee and wage snapshots for ledgers and payouts. Keep category-based split rates scoped to legacy calculations.

## EscrowStatus lifecycle
`pending` → `locked` (on job post) → `released` (Selesai & Bayar) | `disputed` → `released` (worker wins) | `refunded` (company wins)

## calcSplit(totalDeposit, feeRate?) returns
`{ platformCut, workerNet }` where `workerNet = round(totalDeposit / (1 + feeRate))` and `platformCut = totalDeposit − workerNet`. Input is the TOTAL employer deposit. Helpers: `calcEmployerFee(baseWage, feeRate?)=round(baseWage×feeRate)`, `calcEmployerDeposit(baseWage, feeRate?)=baseWage+fee`. All three accept optional `feeRate` defaulting to `DEFAULT_FEE_RATE`.

## calcEscrowAmount(nominal, pembayaran, jumlahHari, kuota)
- per_projek: nominal × kuota
- per_jam/per_shift: nominal × jumlahHari × kuota (per_jam multiplies by 8 implicitly via daily rate)

## Action ownership
- **Company marks complete** → NotificationPanel `onMarkComplete(notifId, hasNpwp)` → `handleSplitPayment` in home.tsx
- **Company disputes via notif panel** → NotificationPanel `onDispute(notifId)` → `handleNotifDispute` in home.tsx
- **Company disputes via profile page** → CompanyProfilePage `onDispute(jobId)` → `handleJobDispute` in home.tsx
- **Worker disputes while clocked in** → active job banner "⚠️ Sengketa" → `handleWorkerDispute` in home.tsx
- **Admin resolves** → CompanyProfilePage "🔑 Admin Master Escrow Key" panel → `onAdminResolve(jobId, winner)` → `handleAdminResolve` in home.tsx
- **Worker withdraws** → WorkerProfilePage E-Wallet tab → `onWithdraw` → `handleWithdraw` in home.tsx

## ApplicationStatus addition
Added "selesai" to `ApplicationStatus` (notification.ts). statusConfig in notification-panel.tsx maps it to "Dibayar ✓" with emerald colors.

**Why:** After `handleSplitPayment` fires, the notification is marked "selesai" so the "Selesai & Bayar" button no longer shows and the status badge reflects payment completion.

## isWithdrawLocked derivation
`customJobs.some(j => j.escrowStatus === "disputed")` — passed as prop to WorkerProfilePage. If any job is disputed, worker cannot withdraw.

## Job modal escrow confirmation step
Job posting modal now has a 2-step flow: fill form → escrow confirmation overlay (shows cost breakdown, jumlahHari picker) → "Simulasi Transfer ke Escrow Rekhastha" → job posted with `escrowStatus: "locked"`.

## Timer engines (grace / dispute window) — snapshot, don't read live UI state
Discipline timers in home.tsx: 15-min Clock-In grace (`CLOCKIN_GRACE_MS`, penalty `LATE_CLOCKIN_PENALTY`) and 24h post-Clock-Out dispute window (`DISPUTE_WINDOW_MS`). A single 1s `nowTick` interval (only alive while a deadline is set) drives two expiry `useEffect`s.

**Rule:** an expiry handler must operate on a captured **job snapshot** (`disputeJob`), NOT on `activeJob`. **Why:** the completed-card "Tutup" button sets `activeJob=null`; if auto-release depended on `activeJob` it would silently no-op after the user closes the card. Also guard auto-release against the job's live `escrowStatus` being already `disputed`/`released`.

**How to apply:** any handler that clears a deadline because a dispute was filed (`handleWorkerDispute`, `handleNotifDispute`, `handleJobDispute`) must key off `disputeJob.id` (not `activeJob.id`) and include `disputeJob` in its dep array, and clear both the deadline and the snapshot on dispute/cancel/logout/apply.

The **grace timer** follows the same rule: use a `graceJob` snapshot (set when the job is accepted, alongside `graceDeadline`) for the penalty AND the Butuh-Cepat standby re-route. Standby re-route (Ahmad/Rian/Siti) is **Mode Butuh Cepat only** — guard `graceJob.hiringMode === "cepat"` inside the handler; scheduled (lama) jobs only get the penalty. Clear `graceJob` wherever `graceDeadline` is cleared (clock-in, clock-out, cancel, logout, expiry).

## Tax-free escrow (no PPh/PPN)
The app is TAX-FREE per the Rekhastha spec: `calcSplit(gross)` returns only `{ platformCut, workerNet }` (workerNet = gross − platformCut), no PPh. `pph21Rate` and the `PPH_*` constants were removed. NPWP stays as a collected/verification field only. The only intentional tax mention left is `terms-modal.tsx` Pasal "Kepatuhan Pajak Independen" (tax is each party's own responsibility). **Why:** user explicitly chose tax-free. Don't reintroduce PPh deductions in any UI.

## Current vs legacy posting math
Both Posting Reguler and Instan Kilat use one flat category fee, waived during an active trial or subscription. The fee is paid by the employer outside the wage escrow. New gigs use `feeRate: 0`; legacy gigs may still carry their saved tier rate until the protected one-time migration.

**Why:** the fee must not be deducted from worker wages, and migration must not rewrite historical transfers or wallet entries.

**How to apply:** do not derive a new gig's wage escrow from category rates. Use the wage snapshot for payouts; keep legacy split helpers only where historical records require them.
**How to apply:** never hardcode multipliers; use `calcEmployerFee`/`calcEmployerDeposit`/`calcSplit` with the job's `feeRate`. `effectiveCommissionRate`/`calcCommission` in custom-job.ts are legacy — don't reintroduce.

## Admin control plane + suspension enforcement
Gated admin portal at `/admin` (client `pages/admin.tsx`, `lib/admin-client.ts`) over a SEPARATE httpOnly admin session cookie (server `lib/admin.ts`: in-mem sessions, 8h TTL, per-IP throttle 5/5min, credentials read from env `ADMIN_ID`/`ADMIN_TOKEN`). NOTE: `lib/admin.ts` ships insecure hardcoded fallback credentials when those env vars are unset — set both env vars for any real deployment. Endpoints in `routes/admin.ts` (ledger/force-release/users/suspend/academy). Ratings persist via `routes/ratings.ts` (stars→score, comment→note).
**Suspension gotcha:** the `suspended` flag must be checked on ALL THREE auth entry points — `/auth/login`, `/auth/google`, AND `/auth/me` (403 + clears session). Adding a new auth path? Add the suspension guard too, or you create a bypass.
