import { db, radarScrapeAlertsTable } from "@workspace/db";
import { logger } from "./logger";
import { kvGet, kvPut, kvPutIfAbsent } from "./ephemeral";

/**
 * Abuse heuristic for `GET /api/companies/radar-stats`.
 *
 * The endpoint only ever returns an aggregate count (see routes/geo.ts for
 * why), but a company could still try to infer individual worker locations by
 * hammering it with slightly different lat/lng/radius combos and diffing the
 * counts. This doesn't block those requests — it flags the pattern so admins
 * have visibility.
 *
 * State lives in Postgres (ephemeral_kv) rather than process memory so the
 * window is shared across serverless instances. The read-modify-write is not
 * atomic; for a heuristic that only raises an admin alert, that is acceptable.
 */

const WINDOW_MS = 60_000;
const CALL_THRESHOLD = 8;
const DISTINCT_LOCATION_THRESHOLD = 4;
const ALERT_COOLDOWN_MS = WINDOW_MS;

interface RadarCall {
  at: number;
  lat: number;
  lng: number;
  radiusKm: number;
}

function locationKey(lat: number, lng: number, radiusKm: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)},${radiusKm}`;
}

export interface RadarAbuseCheck {
  flagged: boolean;
  requestCount: number;
  distinctLocations: number;
}

/** Record a radar-stats call and return whether this burst looks abusive. */
export async function recordRadarCall(
  companyId: string,
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<RadarAbuseCheck> {
  const key = `radar:calls:${companyId}`;
  const now = Date.now();
  const previous = (await kvGet<RadarCall[]>(key)) ?? [];
  const calls = previous.filter((c) => now - c.at < WINDOW_MS);
  calls.push({ at: now, lat, lng, radiusKm });
  await kvPut(key, calls, WINDOW_MS);

  const distinctLocations = new Set(calls.map((c) => locationKey(c.lat, c.lng, c.radiusKm))).size;
  const flagged = calls.length > CALL_THRESHOLD || distinctLocations > DISTINCT_LOCATION_THRESHOLD;

  return { flagged, requestCount: calls.length, distinctLocations };
}

/**
 * Persist + log a scrape alert, but only once per cooldown window per
 * company so a sustained burst doesn't write one row per request.
 */
export async function maybeRecordRadarAbuseAlert(
  companyId: string,
  ip: string | undefined,
  check: RadarAbuseCheck,
): Promise<void> {
  if (!check.flagged) return;

  const won = await kvPutIfAbsent(`radar:alert:${companyId}`, true, ALERT_COOLDOWN_MS);
  if (!won) return;

  logger.warn(
    { companyId, ip, requestCount: check.requestCount, distinctLocations: check.distinctLocations },
    "Suspicious radar-stats usage pattern (possible worker-location probing)",
  );

  try {
    await db.insert(radarScrapeAlertsTable).values({
      companyId,
      ip: ip ?? null,
      requestCount: check.requestCount,
      distinctLocations: check.distinctLocations,
      windowSeconds: Math.round(WINDOW_MS / 1000),
    });
  } catch (err) {
    logger.error({ err }, "Failed to persist radar scrape alert");
  }
}
