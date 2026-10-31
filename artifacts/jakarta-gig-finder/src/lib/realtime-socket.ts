import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Drop-in replacement for the browser `WebSocket` the app used to open against
 * `/api/ws`, backed by Supabase Realtime (Broadcast) instead.
 *
 * It exposes the small slice of the WebSocket API the app relies on —
 * `onopen`, `onmessage` (with `ev.data` as a JSON string), `onerror`,
 * `onclose`, `readyState`, `close()` and the static OPEN/CONNECTING constants —
 * so every existing handler keeps working unchanged.
 *
 *  - `feed` (public): gigs, attendance, SOS, payouts — the old global fan-out.
 *  - `user:<id>` (private): applications, status changes and chat, delivered
 *    only to the signed-in participant. The browser gets a short-lived token
 *    from `GET /api/realtime/token` (which reads the session cookie), so a
 *    private channel needs a socket opened AFTER login — `reconnectWs()` in
 *    central-server.ts already does exactly that.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const FEED_TOPIC = "feed";
const TOKEN_REFRESH_MS = 45 * 60 * 1000;

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum dikonfigurasi.");
  }
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

interface SessionToken {
  token: string | null;
  userId: string | null;
}

async function fetchToken(): Promise<SessionToken> {
  try {
    const res = await fetch("/api/realtime/token", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return { token: null, userId: null };
    return (await res.json()) as SessionToken;
  } catch {
    return { token: null, userId: null };
  }
}

type Listener = (payload: unknown) => void;
type StatusListener = (status: string) => void;

interface TopicEntry {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  lastStatus: string | null;
}

/**
 * Several sockets can be open at once (the gig feed plus admin panels). Each
 * topic is joined exactly once and fanned out to every listener; the channel is
 * torn down when the last listener leaves.
 */
const topics = new Map<string, TopicEntry>();

function joinTopic(
  topic: string,
  isPrivate: boolean,
  onMessage: Listener,
  onStatus: StatusListener,
): () => void {
  let entry = topics.get(topic);
  if (!entry) {
    const supabase = getClient();
    const channel = supabase.channel(topic, { config: { private: isPrivate } });
    const created: TopicEntry = {
      channel,
      listeners: new Set(),
      statusListeners: new Set(),
      lastStatus: null,
    };
    channel.on("broadcast", { event: "msg" }, ({ payload }) => {
      for (const listener of [...created.listeners]) listener(payload);
    });
    channel.subscribe((status) => {
      created.lastStatus = status;
      for (const listener of [...created.statusListeners]) listener(status);
    });
    topics.set(topic, created);
    entry = created;
  }

  entry.listeners.add(onMessage);
  entry.statusListeners.add(onStatus);
  if (entry.lastStatus) onStatus(entry.lastStatus);

  const joined = entry;
  return () => {
    joined.listeners.delete(onMessage);
    joined.statusListeners.delete(onStatus);
    if (joined.listeners.size === 0 && topics.get(topic) === joined) {
      topics.delete(topic);
      void getClient().removeChannel(joined.channel);
    }
  };
}

export class RealtimeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = RealtimeSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  private leaveFns: Array<() => void> = [];
  private refreshTimer: number | null = null;
  private closedEventSent = false;

  constructor() {
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      const session = await fetchToken();
      if (this.readyState === RealtimeSocket.CLOSED) return;
      const supabase = getClient();
      if (session.token) {
        supabase.realtime.setAuth(session.token);
        this.refreshTimer = window.setInterval(() => {
          void fetchToken().then((next) => {
            if (next.token) supabase.realtime.setAuth(next.token);
          });
        }, TOKEN_REFRESH_MS);
      }

      const deliver: Listener = (payload) => {
        if (this.readyState === RealtimeSocket.CLOSED) return;
        this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
      };
      this.leaveFns.push(
        joinTopic(FEED_TOPIC, false, deliver, (status) => this.onFeedStatus(status)),
      );
      if (session.token && session.userId) {
        this.leaveFns.push(
          joinTopic(`user:${session.userId}`, true, deliver, () => {
            /* private-channel status is not surfaced; the feed drives open/close */
          }),
        );
      }
    } catch {
      this.fail();
    }
  }

  private onFeedStatus(status: string): void {
    if (this.readyState === RealtimeSocket.CLOSED) return;
    if (status === "SUBSCRIBED") {
      this.readyState = RealtimeSocket.OPEN;
      this.onopen?.(new Event("open"));
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      this.fail();
    }
  }

  private fail(): void {
    if (this.readyState === RealtimeSocket.CLOSED) return;
    this.onerror?.(new Event("error"));
    this.close();
  }

  close(): void {
    if (this.readyState === RealtimeSocket.CLOSED) return;
    this.readyState = RealtimeSocket.CLOSED;
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    for (const leave of this.leaveFns.splice(0)) {
      try {
        leave();
      } catch {
        /* ignore */
      }
    }
    // Like a native WebSocket, `close` is reported asynchronously.
    window.setTimeout(() => {
      if (this.closedEventSent) return;
      this.closedEventSent = true;
      this.onclose?.(new CloseEvent("close"));
    }, 0);
  }
}
