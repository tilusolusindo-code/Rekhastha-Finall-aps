import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getSessionUser, SESSION_COOKIE } from "../lib/auth";
import { calculateTax } from "../lib/tax-calculator";

const router: IRouter = Router();

/**
 * GET /api/tax/calculate?gross=5000000&status=TK0&type=daily
 *
 * Hitung estimasi PPh 21 + BPJS untuk pekerja/karyawan.
 * Tidak butuh auth — ini kalkulator publik.
 * Tapi kalau ada sesi, bisa personalisasi hasilnya nanti.
 */
router.get("/tax/calculate", (req, res): void => {
  const schema = z.object({
    gross:  z.coerce.number().int().positive().max(500_000_000),
    status: z.enum(["TK0","K0","K1","K2","K3"]).default("TK0"),
    type:   z.enum(["employee","daily"]).default("daily"),
    days:   z.coerce.number().int().min(1).max(31).default(22),
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Parameter tidak valid.", details: parsed.error.issues });
    return;
  }

  const { gross, status, type, days } = parsed.data;
  const result = calculateTax({
    grossMonthly: gross,
    status,
    isEmployee: type === "employee",
    workDaysPerMonth: days,
  });

  res.json(result);
});

export default router;
