/**
 * Resolves FRONTEND_URL (explicit env or Vercel API), then runs deploy:smoke.
 * Requires for smoke: BACKEND_URL (or derived from NEXT_PUBLIC_AEQUITAS_API_URL).
 *
 * Usage:
 *   FRONTEND_URL=https://... BACKEND_URL=https://... node scripts/deploy/verify-live.js
 *   VERCEL_TOKEN=... node scripts/deploy/verify-live.js   # resolves URL + needs BACKEND_URL
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { optEnv, writeJson } = require("./common");

const ARTIFACT = "artifacts/deploy-verify-live/status.json";

function resolveFrontendUrl() {
  const explicit = optEnv("FRONTEND_URL");
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  if (!process.env.VERCEL_TOKEN) {
    return null;
  }
  const script = path.join(__dirname, "vercel-resolve-production-url.js");
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim().replace(/\/$/, "") || null;
}

function run() {
  const started = new Date().toISOString();
  let frontend = resolveFrontendUrl();
  let backend =
    optEnv("BACKEND_URL") ||
    optEnv("NEXT_PUBLIC_AEQUITAS_API_URL")?.replace(/\/$/, "") ||
    null;

  const report = {
    started_at: started,
    frontend_url: frontend,
    backend_url: backend,
    skipped: false,
    reason: null,
  };

  if (!frontend) {
    report.skipped = true;
    report.reason =
      "Set FRONTEND_URL or VERCEL_TOKEN (with scripts/deploy/vercel-resolve-production-url.js working) to run browser smoke.";
    writeJson(ARTIFACT, report);
    console.warn(report.reason);
    process.exitCode = 0;
    return;
  }

  if (!backend) {
    report.skipped = true;
    report.reason = "Set BACKEND_URL or NEXT_PUBLIC_AEQUITAS_API_URL for /health smoke.";
    writeJson(ARTIFACT, report);
    console.warn(report.reason);
    process.exitCode = 0;
    return;
  }

  const smoke = path.join(__dirname, "smoke-check.js");
  const result = spawnSync(process.execPath, [smoke], {
    encoding: "utf8",
    env: {
      ...process.env,
      FRONTEND_URL: frontend,
      BACKEND_URL: backend,
    },
    stdio: "inherit",
  });

  report.finished_at = new Date().toISOString();
  report.smoke_exit_code = result.status ?? 0;
  writeJson(ARTIFACT, report);

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

try {
  run();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
