/**
 * After a Vercel (or any) deploy: run Newman then Playwright smoke.
 * Requires: FRONTEND_URL, BACKEND_URL
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { optEnv, writeJson } = require("./common");

const ARTIFACT = "artifacts/post-deploy-verify/status.json";

function run() {
  const frontend = optEnv("FRONTEND_URL");
  const backend = optEnv("BACKEND_URL");
  const report = {
    started_at: new Date().toISOString(),
    frontend_url: frontend,
    backend_url: backend,
    steps: [],
  };

  if (!frontend || !backend) {
    report.error = "Set FRONTEND_URL and BACKEND_URL";
    writeJson(ARTIFACT, report);
    console.error(report.error);
    process.exit(1);
  }

  const newman = spawnSync(process.execPath, [path.join(__dirname, "run-postman-newman.js")], {
    stdio: "inherit",
    env: { ...process.env, FRONTEND_URL: frontend, BACKEND_URL: backend },
  });
  report.steps.push({ name: "newman", exit: newman.status ?? 0 });
  if (newman.status !== 0) {
    writeJson(ARTIFACT, report);
    process.exit(newman.status ?? 1);
  }

  const smoke = spawnSync(process.execPath, [path.join(__dirname, "smoke-check.js")], {
    stdio: "inherit",
    env: { ...process.env, FRONTEND_URL: frontend, BACKEND_URL: backend },
  });
  report.steps.push({ name: "smoke", exit: smoke.status ?? 0 });
  report.finished_at = new Date().toISOString();
  writeJson(ARTIFACT, report);

  if (smoke.status !== 0) {
    process.exit(smoke.status ?? 1);
  }
}

run();
