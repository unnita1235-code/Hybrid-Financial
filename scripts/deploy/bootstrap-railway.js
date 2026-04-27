const path = require("node:path");
const readline = require("node:readline/promises");
const { chromium } = require("playwright");
const { ensureDir, nowIso, writeJson } = require("./common");

const ARTIFACT_DIR = path.resolve("artifacts/railway-onboarding");

async function waitForOperator(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await rl.question(`${promptText}\nPress Enter to continue... `);
  rl.close();
}

async function run() {
  ensureDir(ARTIFACT_DIR);
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    slowMo: 120,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const report = {
    platform: "railway",
    started_at: nowIso(),
    email: process.env.DEPLOY_EMAIL ?? "unnita1235@gmail.com",
    workspace_name: process.env.DEPLOY_WORKSPACE_NAME ?? "unnita1235-code",
    steps: [],
  };

  try {
    await page.goto("https://railway.com/login", { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "01-login-page.png"), fullPage: true });
    report.steps.push({ name: "open-login", status: "ok", at: nowIso() });

    await waitForOperator(
      "Complete Railway signup/login (email OTP/CAPTCHA if prompted) in the opened browser.",
    );
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "02-after-auth-checkpoint.png"),
      fullPage: true,
    });
    report.steps.push({ name: "checkpoint-auth", status: "ok", at: nowIso() });

    await page.goto("https://railway.com/new", { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "03-new-project.png"), fullPage: true });
    report.steps.push({ name: "open-new-project", status: "ok", at: nowIso() });

    await context.storageState({
      path: path.join(ARTIFACT_DIR, "railway-storage-state.json"),
    });
    report.steps.push({ name: "save-storage-state", status: "ok", at: nowIso() });
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    report.finished_at = nowIso();
    writeJson(path.join(ARTIFACT_DIR, "status.json"), report);
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
