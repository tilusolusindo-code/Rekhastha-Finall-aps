import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "./app";

describe("API security response defaults", () => {
  it("sets browser hardening headers and does not advertise cross-origin access", async () => {
    const response = await request(app)
      .get("/api/healthz")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
