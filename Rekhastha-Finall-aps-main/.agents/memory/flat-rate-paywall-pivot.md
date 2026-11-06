---
name: Flat admin fees and manual checkout
description: Current job-posting charges, waiver rules, manual payment flow, historical migration, and the separate applicant-contact paywall.
---

## Current job-posting model
- Every new gig, regular or instant, has a one-time employer-paid admin fee. Current code and checks set all three categories to Rp50.000, with a Rp75.000 reference/list price.
- An active trial or subscription at the posting timestamp waives the flat fee. The backend is authoritative; UI quotes are estimates.
- The fee is separate from wages. `totalWorkerPayout` is the full contracted wage and payouts credit that snapshot to the worker without percentage deductions.
- Gig creation sets `pending_payment` and creates one manual `gig_escrow` invoice for wages plus the flat fee. The employer sees bank-transfer instructions and one WhatsApp confirmation action.
- Instan Kilat still creates an `instant_orders` row for matching; it must not create a second payment. The Midtrans/Xendit webhook path remains in backend code but automatic confirmation is disabled.
- The applicant-contact paywall remains a separate feature: the first 3 contacts per job are free, then the Rp149k/month company subscription applies.

## Historical data and legacy fee math
- An admin-only, transaction-locked migration snapshots the flat fee and full worker wage, sets `feeRate` to zero, and reprices only awaiting/rejected manual invoices. It is guarded to run once.
- Confirmed transfers, submitted payment evidence, `escrowAmount`, and wallet-ledger entries remain unchanged. Any mismatch or surplus in historical escrow therefore needs explicit reconciliation; do not silently alter balances.
- New on-site daily and remote borongan payouts use the wage snapshot with no percentage deduction. Historical daily-payout rows remain audit evidence.
- Legacy `PLATFORM_FEE_RATES` and split helpers remain for old records and compatibility until migration; do not apply them to new gigs. Fee consistency checks must distinguish legacy rows from migrated flat-fee rows.
- Xendit project/milestone escrow is a distinct backend capability; its user-facing funding flow now routes through manual-payment instructions.

**Why:** current pricing checks enforce a Rp50.000 flat fee across categories; older notes with Rp35.000/Rp49.000/Rp75.000 category fees are stale. The flat fee replaces wage-percentage charges, while historical transfers and wallet movements must remain auditable and must not be rewritten by a pricing migration.

**How to apply:** use the backend's current fee and waiver logic for new postings, plus saved fee and wage snapshots for ledger/payout amounts. Do not quote legacy percentage math for new gigs. Any historical cash movement requires a separate, explicit admin reconciliation path.

## Launch operations and penalty gate
- The user says their team administers the database and retains data indefinitely; they describe its security as high, but access boundaries, recipients/processors, and deletion rights remain unspecified.
- Manual transfers currently go to the bank account configured in Admin, handled by the user and team as an interim method before a real escrow arrangement. Payout/refund timelines, dispute handling, and support response commitments remain unspecified.
- The user wants late-arrival penalties only after the rule is final and server-side recording is in place.

**Why:** these are user-confirmed operating details, while security guarantees and money-handling obligations still need independent verification and clear policy.

**How to apply:** do not turn indefinite retention or a general security claim into a compliant privacy policy. Disclose manual account transfers accurately, avoid escrow claims until a real arrangement exists, and keep financial deductions disabled until policy and server-ledger behavior are confirmed.
