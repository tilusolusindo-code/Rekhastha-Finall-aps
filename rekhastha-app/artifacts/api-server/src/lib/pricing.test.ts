import { describe, expect, it } from "vitest";
import {
  calculateTotalWorkerPayout,
  getAdminFeeAmount,
  getAdminFeeListAmount,
  hasAdminFeeWaiverAt,
} from "./pricing";

describe("flat job pricing", () => {
  it("uses a Rp75.000 list price and Rp50.000 discounted price for every category", () => {
    for (const category of ["umum", "terampil", "teknis", "profesional"]) {
      expect(getAdminFeeListAmount(category)).toBe(75_000);
      expect(getAdminFeeAmount(category)).toBe(50_000);
    }
  });

  it("keeps the flat fee separate from the full contracted worker wages", () => {
    expect(calculateTotalWorkerPayout(250_000, "per_shift", 3, 2)).toBe(1_500_000);
    expect(calculateTotalWorkerPayout(250_000, "per_projek", 3, 2)).toBe(500_000);
  });

  it("waives the fee only during an active trial or subscription at posting time", () => {
    const postedAt = new Date("2026-04-12T12:00:00.000Z");
    const employer = {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      isPremium: false,
      expiredAt: null,
      freeTrialStartedAt: new Date("2026-04-01T00:00:00.000Z"),
      freeTrialExpiresAt: new Date("2026-05-01T00:00:00.000Z"),
    };

    expect(hasAdminFeeWaiverAt(postedAt, employer)).toBe(true);
    expect(hasAdminFeeWaiverAt(new Date("2026-05-01T00:00:00.000Z"), employer)).toBe(false);
    expect(hasAdminFeeWaiverAt(postedAt, undefined, {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      isPremium: false,
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    })).toBe(true);
  });

  it("recognizes a paid subscription that was active at a historical posting date", () => {
    const postedAt = new Date("2026-03-01T00:00:00.000Z");
    expect(hasAdminFeeWaiverAt(postedAt, {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      isPremium: false,
      expiredAt: new Date("2026-04-01T00:00:00.000Z"),
      freeTrialStartedAt: null,
      freeTrialExpiresAt: null,
    })).toBe(true);
  });
});
