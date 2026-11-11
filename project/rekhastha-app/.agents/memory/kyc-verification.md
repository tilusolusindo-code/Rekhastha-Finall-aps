---
name: KYC verification flow
description: Worker identity document upload + admin moderation queue — audit pattern and status semantics.
---

Workers submit KTP photo and/or selfie-with-KTP independently (either field alone is
a valid multipart submission); any resubmission resets `verificationStatus` back to
`"pending"` so a previously-rejected worker automatically re-enters the admin queue.

**Why:** `verificationStatus` defaults to `"pending"` at signup (not `"unverified"`),
so the admin KYC queue is filtered by *document presence* (`ktpPhotoUrl` or
`selfieWithKtpUrl` set), not by status — otherwise every brand-new signup would
show up before ever uploading anything.

**How to apply:** Follow the existing `logAdminAction`-style audit trail for any new
admin moderation action — KYC verify/reject writes to `adminLogsTable` with
action `KYC_VERIFIED` / `KYC_REJECTED` and `targetId` = the worker's user id.

KYC, CV/portfolio, and chat uploads must remain private. KYC access is limited to
the document owner or an authenticated admin; profile documents to their owner
and application documents to the employer on that application; chat attachments
to the accepted conversation participants. Legacy flat chat URLs must retain the
original conversation's ownership and must not be reusable across threads.

**Why:** These uploads may contain identity documents and private employment
details; an unguessable filename or a client-supplied URL is not authorization.

**How to apply:** Keep `/api/uploads` off `express.static`; enforce server-side
session and record ownership checks before serving a file or persisting its URL.
