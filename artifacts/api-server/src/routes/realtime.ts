import { Router, type IRouter } from "express";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { mintRealtimeToken } from "../lib/realtime";

const router: IRouter = Router();

/**
 * Hands the signed-in browser a short-lived Supabase Realtime token so it can
 * join its private `user:<id>` channel. Anonymous visitors (and the admin
 * console, which has its own cookie) get `null` and only use the public feed.
 */
router.get("/realtime/token", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  const token = user ? mintRealtimeToken(user.id) : null;
  if (!user || !token) {
    res.json({ token: null, userId: null });
    return;
  }
  res.json({ token, userId: user.id, expiresInSeconds: 3600 });
});

export default router;
