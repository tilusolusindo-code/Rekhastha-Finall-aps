import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { isAllowedPushEndpoint, pushConfigured, vapidPublicKey } from "../lib/web-push";

const router: IRouter = Router();
const MAX_DEVICES_PER_USER = 10;

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(10).max(256), auth: z.string().min(8).max(128) }),
});

router.get("/push/config", (_req, res): void => {
  res.json({ enabled: pushConfigured(), publicKey: vapidPublicKey() });
});

router.post("/push/subscribe", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  if (!pushConfigured()) {
    res.status(503).json({ error: "Notifikasi push belum diaktifkan di server." });
    return;
  }
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint)) {
    res.status(400).json({ error: "Data langganan tidak valid." });
    return;
  }
  const { endpoint, keys } = parsed.data;

  const mine = await db.select({ id: pushSubscriptionsTable.id, endpoint: pushSubscriptionsTable.endpoint })
    .from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, user.id));
  if (mine.length >= MAX_DEVICES_PER_USER && !mine.some((m) => m.endpoint === endpoint)) {
    res.status(400).json({ error: `Maksimal ${MAX_DEVICES_PER_USER} perangkat. Matikan notifikasi di perangkat lain dulu.` });
    return;
  }

  // Perangkat yang sama bisa dipakai akun lain: langganan dipindahkan ke akun yang sedang login,
  // sehingga notifikasi pemilik sebelumnya tidak lagi tampil di perangkat ini.
  await db
    .insert(pushSubscriptionsTable)
    .values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: (req.get("user-agent") ?? "").slice(0, 200) })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, createdAt: sql`now()` },
    });
  res.status(201).json({ ok: true });
});

router.delete("/push/subscribe", async (req, res): Promise<void> => {
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  if (!user) {
    res.status(401).json({ error: "Tidak terautentikasi." });
    return;
  }
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint) {
    res.status(400).json({ error: "Endpoint wajib diisi." });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(and(eq(pushSubscriptionsTable.userId, user.id), eq(pushSubscriptionsTable.endpoint, endpoint)));
  res.json({ ok: true });
});

export default router;
