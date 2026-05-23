/**
 * PATCH Vercel project to set rootDirectory to apps/web (npm workspaces monorepo).
 * Requires: VERCEL_TOKEN, VERCEL_PROJECT_NAME (default aequitas-web)
 * Optional: VERCEL_TEAM_ID
 */
const { mustEnv, nowIso, optEnv, writeJson } = require("./common");

const ARTIFACT = "artifacts/vercel-onboarding/patch-root-directory.json";

async function run() {
  const token = mustEnv("VERCEL_TOKEN");
  const projectName = optEnv("VERCEL_PROJECT_NAME", "aequitas-web");
  const teamId = optEnv("VERCEL_TEAM_ID");
  const rootDirectory = optEnv("VERCEL_ROOT_DIRECTORY", "apps/web");

  const sep = (p) => (p.includes("?") ? "&" : "?");
  let path = `/v9/projects/${encodeURIComponent(projectName)}`;
  if (teamId) path += `${sep(path)}teamId=${encodeURIComponent(teamId)}`;

  const report = { at: nowIso(), projectName, rootDirectory, status: "pending" };

  try {
    const response = await fetch(`https://api.vercel.com${path}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rootDirectory }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Vercel API ${response.status}: ${text}`);
    }
    report.status = "ok";
    report.response = text ? JSON.parse(text) : {};
    console.log(`Updated project "${projectName}" rootDirectory -> ${rootDirectory}`);
  } catch (e) {
    report.status = "failed";
    report.error = e instanceof Error ? e.message : String(e);
    console.error(e);
    process.exitCode = 1;
  } finally {
    writeJson(ARTIFACT, report);
  }
}

run();
