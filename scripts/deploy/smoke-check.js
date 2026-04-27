const { chromium } = require("playwright");
const { nowIso, optEnv, writeJson } = require("./common");

async function checkHttp(url, expected = 200) {
  const response = await fetch(url, { method: "GET", redirect: "follow" });
  return {
    kind: "http",
    url,
    status: response.status,
    ok: response.status === expected,
  };
}

async function checkRouteInBrowser(page, baseUrl, route) {
  const url = `${baseUrl}${route}`;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const status = response ? response.status() : 0;
  const title = await page.title();
  return {
    kind: "browser",
    url,
    status,
    title,
    ok: status >= 200 && status < 400,
  };
}

async function run() {
  const frontend = optEnv("FRONTEND_URL");
  const backend = optEnv("BACKEND_URL");

  if (!frontend || !backend) {
    throw new Error("Set FRONTEND_URL and BACKEND_URL before running smoke checks.");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const browserChecks = [];
  try {
    browserChecks.push(await checkRouteInBrowser(page, frontend, "/"));
    browserChecks.push(await checkRouteInBrowser(page, frontend, "/research"));
    browserChecks.push(await checkRouteInBrowser(page, frontend, "/alerts"));
    browserChecks.push(await checkRouteInBrowser(page, frontend, "/debate"));
    browserChecks.push(await checkRouteInBrowser(page, frontend, "/portfolio"));
  } finally {
    await browser.close();
  }

  const apiChecks = [await checkHttp(`${backend}/health`)];
  const results = [...browserChecks, ...apiChecks];
  const failed = results.filter((r) => !r.ok);

  writeJson("artifacts/deploy-smoke/status.json", {
    started_at: nowIso(),
    frontend,
    backend,
    results,
    failed_count: failed.length,
    completed_at: nowIso(),
  });

  if (failed.length) {
    throw new Error(`Smoke checks failed: ${failed.map((f) => `${f.url} -> ${f.status}`).join(", ")}`);
  }

  console.log("Smoke checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
