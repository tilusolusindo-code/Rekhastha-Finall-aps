import { createHmac } from "node:crypto";
import { logger } from "./logger";
import { keepAlive } from "./vercel-context";

/**
 * Realtime fan-out via Supabase Realtime (Broadcast).
 *
 * The API no longer holds WebSocket connections (impossible on Vercel
 * serverless). Instead it publishes each event to Supabase over REST and
 * browsers subscribe directly to Supabase:
 *
 *  - topic `feed`          public channel — gigs, attendance, SOS, payouts
 *                          (same audience as the old open `/api/ws`).
 *  - topic `user:<userId>` PRIVATE channel — participant-scoped delivery
 *                          (applications with masked KYC data, chat, status).
 *                          Row-level security on `realtime.messages` only lets
 *                          a client read the topic matching the `sub` claim of
 *                          the token minted by `GET /api/realtime/token`.
 *
 * Payloads keep the exact `{ type, ... }` frames the old WebSocket sent, so the
 * frontend handlers are unchanged.
 */

export const FEED_TOPIC = "feed";
export const userTopic = (userId: string): string => `user:${userId}`;

const REALTIME_TOKEN_TTL_SECONDS = 60 * 60;

async function publish(topic: string, payload: unknown, isPrivate: boolean): Promise<void> {
  const baseUrl = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!baseUrl || !serviceKey) {
    logger.warn({ topic }, "Realtime publish skipped: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    return;
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ topic, event: "msg", payload, private: isPrivate }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.error({ topic, status: response.status }, "Realtime publish rejected");
    }
  } catch (err) {
    logger.error({ topic, err }, "Realtime publish failed");
  }
}

/** Fire-and-forget, but kept alive past the HTTP response on Vercel. */
function send(topic: string, payload: unknown, isPrivate: boolean): void {
  keepAlive(publish(topic, payload, isPrivate));
}

function broadcast(payload: unknown): void {
  send(FEED_TOPIC, payload, false);
}

function sendToUser(userId: string, payload: unknown): void {
  if (!userId) return;
  send(userTopic(userId), payload, true);
}

/**
 * Mint a short-lived JWT the browser hands to Supabase Realtime so it can join
 * its own private `user:<id>` channel. Signed with the project's JWT secret.
 */
export function mintRealtimeToken(userId: string): string | null {
  const secret = process.env["SUPABASE_JWT_SECRET"];
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    aud: "authenticated",
    role: "authenticated",
    sub: userId,
    iat: now,
    exp: now + REALTIME_TOKEN_TTL_SECONDS,
  })}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

/** Push a newly created/updated gig to every connected device. */
export function broadcastGig(gig: unknown): void {
  broadcast({ type: "gig_broadcast", gig });
}

/** Re-announce a gig as live once payment is confirmed (Instan Kilat). */
export function broadcastInstantActivated(gig: unknown): void {
  broadcast({ type: "instant_order_activated", gig });
}

/** A worker scanned an employer's masuk/pulang QR. */
export function broadcastAttendance(attendance: unknown): void {
  broadcast({ type: "attendance", attendance });
}

/** Worker SOS incident — the Admin Command Center raises its alarm. */
export function broadcastEmergency(incident: unknown): void {
  broadcast({ type: "emergency_active", incident });
}

/** An SOS incident was resolved so alarms can clear. */
export function broadcastEmergencyResolved(id: number): void {
  broadcast({ type: "emergency_resolved", id });
}

/** On-site daily fractional payout for the admin tracker. */
export function broadcastDailyPayout(payout: unknown): void {
  broadcast({ type: "daily_payout", payout });
}

/** New application → only the owning employer (keeps masked NIK/NPWP private). */
export function broadcastApplication(application: unknown, employerId: string): void {
  sendToUser(employerId, { type: "application_new", application });
}

/** Application status change → only the worker who submitted it. */
export function broadcastApplicationStatus(
  id: number,
  status: string,
  jobId: number,
  workerId: string,
): void {
  sendToUser(workerId, { type: "application_status", id, status, jobId });
}

/** Chat message → only the two conversation participants. */
export function broadcastChatMessage(
  message: unknown,
  employerId: string,
  workerId: string,
): void {
  const frame = { type: "chat_message", message };
  if (employerId) sendToUser(employerId, frame);
  if (workerId !== employerId) sendToUser(workerId, frame);
}
