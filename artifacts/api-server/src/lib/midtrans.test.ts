import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  MidtransConfigError,
  buildOrderId,
  getMidtransConfig,
  getSnapClientConfig,
  isPaidLike,
  mapTransactionStatus,
  nextPaymentStatus,
  parseDate,
  parseGrossAmount,
  verifyMidtransSignature,
} from "./midtrans.js";

const ENV_KEYS = [
  "MIDTRANS_SERVER_KEY",
  "MIDTRANS_CLIENT_KEY",
  "VITE_MIDTRANS_CLIENT_KEY",
  "MIDTRANS_IS_PRODUCTION",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

describe("getMidtransConfig", () => {
  it("accepts a matching sandbox pair and points Snap at the sandbox host", () => {
    setEnv({ MIDTRANS_SERVER_KEY: "SB-Mid-server-x", MIDTRANS_CLIENT_KEY: "SB-Mid-client-x" });
    const config = getMidtransConfig();
    expect(config.isProduction).toBe(false);
    expect(getSnapClientConfig(config)).toEqual({
      clientKey: "SB-Mid-client-x",
      snapJsUrl: "https://app.sandbox.midtrans.com/snap/snap.js",
      isProduction: false,
    });
  });

  it("accepts a matching production pair only when the mode says production", () => {
    setEnv({
      MIDTRANS_SERVER_KEY: "Mid-server-x",
      MIDTRANS_CLIENT_KEY: "Mid-client-x",
      MIDTRANS_IS_PRODUCTION: "true",
    });
    expect(getSnapClientConfig(getMidtransConfig()).snapJsUrl).toBe(
      "https://app.midtrans.com/snap/snap.js",
    );
  });

  it("falls back to VITE_MIDTRANS_CLIENT_KEY so existing Vercel setups keep working", () => {
    setEnv({ MIDTRANS_SERVER_KEY: "SB-Mid-server-x", VITE_MIDTRANS_CLIENT_KEY: "SB-Mid-client-v" });
    expect(getMidtransConfig().clientKey).toBe("SB-Mid-client-v");
  });

  it.each([
    ["missing server key", { MIDTRANS_CLIENT_KEY: "SB-Mid-client-x" }],
    ["missing client key", { MIDTRANS_SERVER_KEY: "SB-Mid-server-x" }],
    [
      "sandbox server key with production client key",
      { MIDTRANS_SERVER_KEY: "SB-Mid-server-x", MIDTRANS_CLIENT_KEY: "Mid-client-x" },
    ],
    [
      "production flag with sandbox keys",
      {
        MIDTRANS_SERVER_KEY: "SB-Mid-server-x",
        MIDTRANS_CLIENT_KEY: "SB-Mid-client-x",
        MIDTRANS_IS_PRODUCTION: "true",
      },
    ],
    [
      "live keys without the production flag",
      { MIDTRANS_SERVER_KEY: "Mid-server-x", MIDTRANS_CLIENT_KEY: "Mid-client-x" },
    ],
  ])("rejects %s", (_name, env) => {
    setEnv(env);
    expect(() => getMidtransConfig()).toThrow(MidtransConfigError);
  });
});

describe("verifyMidtransSignature", () => {
  const input = {
    orderId: "RKS-1-ABC",
    statusCode: "200",
    grossAmount: "150000.00",
  };
  const sign = (key: string) =>
    createHash("sha512")
      .update(`${input.orderId}${input.statusCode}${input.grossAmount}${key}`)
      .digest("hex");

  it("accepts the SHA-512 of order_id + status_code + gross_amount + server key", () => {
    expect(verifyMidtransSignature({ ...input, signatureKey: sign("k") }, "k")).toBe(true);
  });

  it("is case-insensitive and ignores surrounding whitespace in the received signature", () => {
    expect(
      verifyMidtransSignature({ ...input, signatureKey: ` ${sign("k").toUpperCase()} ` }, "k"),
    ).toBe(true);
  });

  it("rejects a wrong key, a changed amount, and a truncated signature", () => {
    expect(verifyMidtransSignature({ ...input, signatureKey: sign("other") }, "k")).toBe(false);
    expect(
      verifyMidtransSignature({ ...input, grossAmount: "1.00", signatureKey: sign("k") }, "k"),
    ).toBe(false);
    expect(verifyMidtransSignature({ ...input, signatureKey: sign("k").slice(0, 40) }, "k")).toBe(
      false,
    );
  });

  it("refuses to verify without a server key", () => {
    expect(() => verifyMidtransSignature({ ...input, signatureKey: "x" }, "")).toThrow(
      MidtransConfigError,
    );
  });
});

describe("mapTransactionStatus", () => {
  it.each([
    ["settlement", null, "paid"],
    ["capture", "accept", "paid"],
    ["capture", "challenge", "challenge"],
    ["capture", "deny", "failed"],
    ["capture", null, "pending"],
    ["pending", null, "pending"],
    ["authorize", null, "pending"],
    ["deny", null, "failed"],
    ["failure", null, "failed"],
    ["cancel", null, "cancelled"],
    ["expire", null, "expired"],
    ["refund", null, "refunded"],
    ["partial_refund", null, "refunded"],
    ["chargeback", null, "refunded"],
  ])("%s / %s -> %s", (status, fraud, expected) => {
    expect(mapTransactionStatus(status, fraud)).toBe(expected);
  });

  it("returns null for statuses it does not know instead of guessing", () => {
    expect(mapTransactionStatus("something_new", null)).toBeNull();
  });
});

describe("nextPaymentStatus", () => {
  it("moves forward from pending", () => {
    expect(nextPaymentStatus("pending", "paid")).toBe("paid");
    expect(nextPaymentStatus("pending", "expired")).toBe("expired");
  });

  it("never lets a late 'pending' or 'expire' undo a payment", () => {
    expect(nextPaymentStatus("paid", "pending")).toBe("paid");
    expect(nextPaymentStatus("paid", "expired")).toBe("paid");
    expect(nextPaymentStatus("paid", "failed")).toBe("paid");
  });

  it("lets a refund override a payment and keeps it final", () => {
    expect(nextPaymentStatus("paid", "refunded")).toBe("refunded");
    expect(nextPaymentStatus("refunded", "paid")).toBe("refunded");
  });

  it("lifts paid_unapplied to paid once a retry activates the service", () => {
    expect(nextPaymentStatus("paid_unapplied", "paid")).toBe("paid");
    expect(nextPaymentStatus("paid_duplicate", "paid")).toBe("paid_duplicate");
  });

  it("keeps amount_mismatch sticky for a human to resolve", () => {
    expect(nextPaymentStatus("amount_mismatch", "paid")).toBe("amount_mismatch");
    expect(nextPaymentStatus("amount_mismatch", "refunded")).toBe("refunded");
  });

  it("knows which statuses mean money arrived", () => {
    expect(isPaidLike("paid")).toBe(true);
    expect(isPaidLike("paid_unapplied")).toBe(true);
    expect(isPaidLike("pending")).toBe(false);
  });
});

describe("parseGrossAmount", () => {
  it.each([
    ["150000.00", 150000],
    ["50000", 50000],
    [" 75000.00 ", 75000],
    [149000, 149000],
  ])("parses %j", (value, expected) => {
    expect(parseGrossAmount(value)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1500.50", "1e6", "150000.00.00", null, undefined])(
    "rejects %j",
    (value) => {
      expect(parseGrossAmount(value)).toBeNull();
    },
  );
});

describe("buildOrderId", () => {
  it("is unique, short enough for Midtrans (<=50) and limited to [A-Z0-9-]", () => {
    const ids = new Set(Array.from({ length: 200 }, () => buildOrderId(12345)));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(50);
      expect(id).toMatch(/^RKS-12345-[A-Z0-9]+$/);
    }
  });
});

describe("parseDate", () => {
  it("reads Midtrans' zone-less timestamps as WIB (UTC+7)", () => {
    expect(parseDate("2026-11-08 18:00:00")?.toISOString()).toBe("2026-11-08T11:00:00.000Z");
  });

  it("returns null for empty or unparseable input", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});
