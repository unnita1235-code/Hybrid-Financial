const path = require("node:path");
const { chromium } = require("playwright");
const { ensureDir, nowIso, optEnv, writeJson } = require("./common");

const ARTIFACT_DIR = path.resolve("artifacts/cloudflare-pages-onboarding");
const ACCOUNT_ID = optEnv("CLOUDFLARE_ACCOUNT_ID", "01442f3d4b78024f78959eeaf5f8e289");
const PROJECT_NAME = optEnv("CLOUDFLARE_PAGES_PROJECT", "aequitas-web");
const ALLOWED_PROJECT = optEnv("CLOUDFLARE_ALLOWED_PROJECT", "aequitas-web");
const REPO_NAME = optEnv("CLOUDFLARE_GH_REPO", "unnita1235-code/Hybrid-Financial");
const PROD_BRANCH = optEnv("CLOUDFLARE_PROD_BRANCH", "main");
const PREVIEW_BRANCH = optEnv("CLOUDFLARE_PREVIEW_BRANCH", "develop");
const ROOT_DIR = optEnv("CLOUDFLARE_PAGES_ROOT_DIR", "apps/web");
const BUILD_CMD = optEnv("CLOUDFLARE_PAGES_BUILD_CMD", "npm ci && npm run build:web");
const DRY_RUN = optEnv("CLOUDFLARE_AUTOMATION_DRY_RUN", "true") === "true";

async function clickIfVisible(page, selectors) {
  for (const selector of selectors) {
    const item = page.locator(selector).first();
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      return true;
    }
  }
  return false;
}

async function fillIfVisible(page, selectors, value) {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(value);
      return true;
    }
  }
  return false;
}

function assertGuard(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertProjectIdentity(page, report, stepName) {
  const url = page.url();
  assertGuard(url.includes(`/pages/view/${PROJECT_NAME}`), `Guard failed: unexpected project URL: ${url}`);
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const identityFound =
    title.includes(PROJECT_NAME) ||
    bodyText.includes(PROJECT_NAME) ||
    url.includes(`/pages/view/${PROJECT_NAME}`);
  assertGuard(identityFound, `Guard failed: expected project identity "${PROJECT_NAME}" not found on page`);
  report.steps.push({ name: stepName, status: "ok", at: nowIso(), detail: `url=${url}` });
}

async function assertNoCreateProjectFlow(page) {
  const createProjectDetected = await page
    .locator("text=Create project, text=Create a project, text=Create Pages project, text=Import existing Git repository")
    .first()
    .isVisible()
    .catch(() => false);
  assertGuard(!createProjectDetected, "Guard failed: create-project flow detected; refusing to continue");
}

async function guardedClick(page, selectors) {
  if (DRY_RUN) return false;
  return clickIfVisible(page, selectors);
}

async function guardedFill(page, selectors, value) {
  if (DRY_RUN) return false;
  return fillIfVisible(page, selectors, value);
}

async function run() {
  ensureDir(ARTIFACT_DIR);
  assertGuard(PROJECT_NAME === ALLOWED_PROJECT, `Refusing to run: project "${PROJECT_NAME}" != allowed "${ALLOWED_PROJECT}"`);

  const report = {
    platform: "cloudflare-pages",
    started_at: nowIso(),
    account_id: ACCOUNT_ID,
    project: PROJECT_NAME,
    repo: REPO_NAME,
    dry_run: DRY_RUN,
    steps: [],
  };

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`https://dash.cloudflare.com/${ACCOUNT_ID}/pages/view/${PROJECT_NAME}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await assertNoCreateProjectFlow(page);
    await assertProjectIdentity(page, report, "guard-project-identity-home");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "01-open-pages-project.png"), fullPage: true });
    report.steps.push({ name: "open-pages-project", status: "ok", at: nowIso() });

    const loginVisible = await page
      .locator("input[type='email'], input[name='email'], text=Sign in, text=Log in")
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      report.steps.push({
        name: "login-detected",
        status: "blocked",
        at: nowIso(),
        detail:
          "Cloudflare login/CAPTCHA detected. Complete login in browser and rerun this command.",
      });
      throw new Error("Cloudflare login required before full automation can proceed.");
    }

    // Try to connect repo if the project is not already linked.
    await page.goto(`https://dash.cloudflare.com/${ACCOUNT_ID}/pages/view/${PROJECT_NAME}/settings`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await assertNoCreateProjectFlow(page);
    await assertProjectIdentity(page, report, "guard-project-identity-settings");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "02-project-settings.png"), fullPage: true });

    const repoConnected = await page
      .locator(`text=${REPO_NAME}, text=GitHub, text=Repository`)
      .first()
      .isVisible()
      .catch(() => false);
    if (!repoConnected) {
      const clickedConnect = await guardedClick(page, [
        "button:has-text('Connect to Git')",
        "button:has-text('Connect repository')",
        "button:has-text('Connect GitHub')",
      ]);
      if (clickedConnect || DRY_RUN) {
        await page.waitForTimeout(2000);
        await guardedFill(page, ["input[placeholder*='Search']", "input[type='search']"], REPO_NAME);
        await page.waitForTimeout(1500);
        await guardedClick(page, [
          `text=${REPO_NAME}`,
          `button:has-text('${REPO_NAME}')`,
          "button:has-text('Continue')",
          "button:has-text('Next')",
          "button:has-text('Connect')",
        ]);
        report.steps.push({
          name: "attempt-connect-github-repo",
          status: DRY_RUN ? "dry-run" : "ok",
          at: nowIso(),
        });
      } else {
        report.steps.push({
          name: "connect-git-button-not-found",
          status: "blocked",
          at: nowIso(),
        });
      }
    } else {
      report.steps.push({ name: "repo-already-connected", status: "ok", at: nowIso() });
    }

    // Try to update build configuration.
    await page.goto(`https://dash.cloudflare.com/${ACCOUNT_ID}/pages/view/${PROJECT_NAME}/settings/builds-deployments`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await assertNoCreateProjectFlow(page);
    await assertProjectIdentity(page, report, "guard-project-identity-build-settings");
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "03-build-settings.png"), fullPage: true });

    await guardedClick(page, [
      "button:has-text('Edit configuration')",
      "button:has-text('Edit')",
      "button:has-text('Configure production builds')",
    ]);
    await page.waitForTimeout(1500);
    await guardedFill(page, ["input[name='production_branch']", "input[placeholder*='Production branch']"], PROD_BRANCH);
    await guardedFill(page, ["input[name='build_command']", "textarea[name='build_command']"], BUILD_CMD);
    await guardedFill(page, ["input[name='root_dir']", "input[placeholder*='Root directory']"], ROOT_DIR);
    await guardedFill(page, ["input[name='preview_branch']", "input[placeholder*='Preview branch']"], PREVIEW_BRANCH);
    await guardedClick(page, [
      "button:has-text('Save')",
      "button:has-text('Save and Deploy')",
      "button:has-text('Update')",
    ]);
    report.steps.push({
      name: "attempt-build-config-update",
      status: DRY_RUN ? "dry-run" : "ok",
      at: nowIso(),
      detail: `prod=${PROD_BRANCH}, preview=${PREVIEW_BRANCH}, root=${ROOT_DIR}`,
    });

    await page.screenshot({ path: path.join(ARTIFACT_DIR, "04-final-state.png"), fullPage: true });
    await context.storageState({
      path: path.join(ARTIFACT_DIR, "cloudflare-storage-state.json"),
    });
    report.steps.push({ name: "save-storage-state", status: "ok", at: nowIso() });
    report.status = DRY_RUN ? "dry-run-completed" : "completed";
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
