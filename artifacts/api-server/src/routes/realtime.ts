import { Router, type IRouter } from "express";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { ADMIN_COOKIE, adminSessionId } from "../lib/admin";
import { mintRealtimeToken } from "../lib/realtime";

const router: IRouter = Router();

/**
 * Hands the browser a short-lived Supabase Realtime token.
 *
 *  - default: the signed-in user's token for their private `user:<id>` channel.
 *  - `?scope=admin`: only for a valid admin session cookie; the token carries
 *    the `app_role: "admin"` claim that the `admin` channel policy requires.
 *    Without a valid admin session the response is an empty token.
 */
router.get("/realtime/token", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");

  if (req.query["scope"] === "admin") {
    const adminId = await adminSessionId(req.cookies?.[ADMIN_COOKIE]);
    const token = adminId
      ? mintRealtimeToken(`admin:${adminId}`, { app_role: "admin" })
      : null;
    if (!adminId || !token) {
      res.json({ token: null, userId: null });
      return;
    }
    res.json({ token, userId: `admin:${adminId}`, scope: "admin", expiresInSeconds: 3600 });
    return;
  }

  const user = await getSessionUser(req.cookies?.[SESSION_COOKIE]);
  const token = user ? mintRealtimeToken(user.id) : null;
  if (!user || !token) {
    res.json({ token: null, userId: null });
    return;
  }
  res.json({ token, userId: user.id, expiresInSeconds: 3600 });
});

export default router;
