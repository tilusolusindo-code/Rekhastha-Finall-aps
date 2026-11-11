import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    // Never let secrets or credentials reach the logs, even if an error or
    // request object carrying them is logged by mistake.
    "*.password",
    "*.newPassword",
    "*.oldPassword",
    "*.token",
    "*.recoveryToken",
    "*.serviceKey",
    "*.apiKey",
    "*.connectionString",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
