---
name: Payment type & wage model
description: Rekhastha's 4 payment categories, the flat-wage math, and the withdrawal payload convention.
---

# Payment categories

`PaymentType` = `per_shift | per_hari | per_projek | per_bulan` (4 Indonesian daily-gig categories). There is no hourly (`per_jam`) type — it was removed.

**Why:** the product spec defines exactly these 4 categories. Do not re-introduce `per_jam`.

**Key spelling gotcha:** the "proyek" category keeps the legacy key `per_projek` (with a `j`), even though its user-facing label is "Per Proyek (Borongan)". Renaming the key to `per_proyek` would break many `=== "per_projek"` comparisons for no user benefit. Keep the key as-is; only labels are Indonesian-correct.

# Display maps (single source of truth)

All wage-type text comes from three maps in `types/custom-job.ts`: `paymentLabels` (selector), `paymentInputLabels` (wage-field label), `paymentUnits` (short suffix like "Shift"). Never hand-write per-type ternaries in components — import the map.

# Flat wage math

`calcTotal` is flat: gross = `nominal` (no ×8 hourly multiplier). `escrow.ts calcEscrowAmount` special-cases only `per_projek` (nominal × kuota); everything else is `nominal × hari × kuota`.

# Fee model: flat admin fee for new gigs, no wage-percentage deduction

New gigs store `feeRate: 0`; the employer pays a one-time flat admin fee unless an eligible trial/subscription waives it. Worker payout remains the full saved wage with no percentage deduction. Instan Kilat must not create a duplicate payment, and applicant-contact access is a separate subscription/paywall. Tiered category rates remain only for legacy escrow calculations.

**Why:** new posting charges and historical wage settlement are separate systems; legacy category percentages must not be applied to current gigs.

**How to apply:** use the server's current flat-fee/waiver quote for new postings, keep `feeRate` at zero for their payouts, and use a stored legacy rate only when settling an older job.

# Rupiah input + WS payload

Wage inputs mask to Indonesian thousands separators for display but store/submit a **clean integer** `nominal`. The realtime broadcast payload carries the clean integer + typed `pembayaran`; formatting happens on the receiving device. Do NOT send a pre-formatted currency string over the WS — it would corrupt the ledger math.

# Worker payout

The payout request uses the bank name, account holder, and account number saved in the worker profile. The server calculates the full available wallet balance, allows only one pending request, and restores availability when a request is rejected. Client-provided amounts or account details are not authoritative.

**Why:** payout amount and destination must come from server-owned balance data and the saved profile, not editable request fields.

**How to apply:** keep withdrawal requests body-light; validate profile details and compute the amount on the server before inserting a pending payout.
