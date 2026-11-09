/**
 * Keep a background promise alive after the HTTP response has been sent.
 *
 * Vercel freezes a function as soon as the response finishes, so un-awaited
 * work (realtime broadcasts, bootstrap tasks) can be cut off mid-flight. The
 * platform exposes `waitUntil` on a well-known global symbol (the same one the
 * `@vercel/functions` package reads). Outside Vercel this is a no-op and the
 * promise simply runs on the long-lived Node process.
 */
export function keepAlive(promise: Promise<unknown>): void {
  const context = (
    globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>
  )[Symbol.for("@vercel/request-context")]?.get?.();
  try {
    context?.waitUntil?.(promise);
  } catch {
    /* best effort */
  }
}
