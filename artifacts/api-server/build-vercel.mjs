/**
 * Builds the whole product for Vercel using the Build Output API (v3):
 *
 *   .vercel/output/static/              <- Vite build of jakarta-gig-finder
 *   .vercel/output/functions/api.func/  <- Express API bundled into one file
 *   .vercel/output/config.json          <- routing: /api/* -> function, SPA fallback
 *
 * Run `pnpm --filter @workspace/jakarta-gig-finder run build` first (the root
 * `build:vercel` script does both).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const out = path.join(repoRoot, ".vercel", "output");
const funcDir = path.join(out, "functions", "api.func");
const frontendDist = path.resolve(here, "..", "jakarta-gig-finder", "dist", "public");

await rm(out, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });

await build({
  entryPoints: [path.join(here, "src", "vercel.ts")],
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outfile: path.join(funcDir, "index.mjs"),
  logLevel: "info",
  external: ["*.node", "pg-native"],
  sourcemap: "linked",
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});

await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      // Express reads the raw body itself; Vercel's helpers would pre-consume it.
      shouldAddHelpers: false,
      maxDuration: 30,
      memory: 1024,
    },
    null,
    2,
  ),
);

await cp(frontendDist, path.join(out, "static"), { recursive: true });

await writeFile(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      // Tiap hari 03:00 WIB: kembalikan escrow lowongan yang berakhir tanpa pekerja.
      // Vercel mengirim "Authorization: Bearer <CRON_SECRET>" otomatis bila CRON_SECRET diisi.
      // Tiap hari 17:00 WIB: email pengingat H-1 untuk pekerja yang dijadwalkan besok.
      crons: [
        { path: "/api/cron/refund-expired", schedule: "0 20 * * *" },
        { path: "/api/cron/shift-reminders", schedule: "0 10 * * *" },
      ],
      routes: [
        { src: "^/api/?$", dest: "/api" },
        { src: "^/api/(.*)$", dest: "/api?__path=$1" },
        {
          src: "^/assets/(.*)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log(`Vercel output written to ${out}`);
