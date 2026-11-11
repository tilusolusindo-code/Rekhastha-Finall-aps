import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Automatic payments are intentionally disabled while the product uses
// admin-reviewed manual transfers. Keep these endpoints explicit so clients
// receive a stable response instead of accidentally entering a dormant flow.
router.post("/payments/midtrans/create", (_req, res): void => {
  res.status(410).json({ error: "Pembayaran otomatis dinonaktifkan. Gunakan transfer manual." });
});

router.post("/payments/midtrans-callback", (_req, res): void => {
  res.status(410).json({ error: "Callback pembayaran otomatis dinonaktifkan." });
});

router.post("/payments/midtrans/payout", (_req, res): void => {
  res.status(410).json({ error: "Payout otomatis dinonaktifkan. Transfer dan pencatatan dilakukan admin." });
});

export default router;
