/**
 * Prints the latest production deployment URL for a Vercel project (API).
 * Requires: VERCEL_TOKEN
 * Optional: VERCEL_TEAM_ID, VERCEL_PROJECT_NAME (default: aequitas-web)
 *
 * Writes artifacts/vercel-onboarding/latest-production-url.json
 * Exits 2 if token missing; 1 on API error; 0 on success (URL printed to stdout).
 */
const { mustEnv, nowIso, optEnv, writeJson } = require("./common");

const ARTIFACT = "artifacts/vercel-onboarding/latest-production-url.json";

async function vercelFetch(path) {
  const token = mustEnv("VERCEL_TOKEN");
  const teamId = optEnv("VERCEL_TEAM_ID");
  const sep = path.includes("?") ? "&" : "?";
  const scopedPath = teamId ? `${path}${sep}teamId=${encodeURIComponent(teamId)}` : path;
  const response = await fetch(`https://api.vercel.com${scopedPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vercel API ${response.status}: ${body}`);
  }
  return response.json();
}

async function runAsync() {
  const projectName = optEnv("VERCEL_PROJECT_NAME", "aequitas-web");
  const report = {
    tool: "vercel-resolve-production-url",
    at: nowIso(),
    project_name: projectName,
  };

  if (!process.env.VERCEL_TOKEN) {
    report.error = "VERCEL_TOKEN not set";
    writeJson(ARTIFACT, report);
    console.error("Set VERCEL_TOKEN to resolve the latest production URL via the Vercel API.");
    process.exit(2);
    return;
  }

  try {
    const project = await vercelFetch(`/v9/projects/${encodeURIComponent(projectName)}`);
    report.project_id = project.id;

    const qs = new URLSearchParams({
      projectId: project.id,
      target: "production",
      limit: "20",
    });
    const list = await vercelFetch(`/v6/deployments?${qs.toString()}`);
    const deployments = Array.isArray(list.deployments) ? list.deployments : [];

    const ready = deployments.find((d) => d.readyState === "READY" || d.state === "READY");
    const latest = ready ?? deployments[0];

    if (!latest) {
      report.error = "no_deployments";
      writeJson(ARTIFACT, report);
      throw new Error(`No deployments found for project "${projectName}".`);
    }

    const host = latest.url ? String(latest.url) : null;
    const url = host ? (host.startsWith("http") ? host : `https://${host}`) : null;

    report.deployment_id = latest.uid;
    report.ready_state = latest.readyState ?? latest.state;
    report.url = url;
    writeJson(ARTIFACT, report);

    if (url) {
      console.log(url);
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    writeJson(ARTIFACT, report);
    console.error(error);
    process.exitCode = 1;
  }
}

runAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});
