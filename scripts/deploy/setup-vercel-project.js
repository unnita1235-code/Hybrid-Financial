const { mustEnv, nowIso, optEnv, writeJson } = require("./common");

async function vercelRequest(path, init = {}) {
  const token = mustEnv("VERCEL_TOKEN");
  const teamId = optEnv("VERCEL_TEAM_ID");
  const sep = path.includes("?") ? "&" : "?";
  const scopedPath = teamId ? `${path}${sep}teamId=${encodeURIComponent(teamId)}` : path;
  const response = await fetch(`https://api.vercel.com${scopedPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vercel API ${response.status}: ${body}`);
  }
  if (response.status === 204) {
    return {};
  }
  return response.json();
}

/** Env keys the Next app reads — see apps/web/.env.example and apps/web/lib/aequitas-api.ts */
function requiredFrontendEnv() {
  return [
    "NEXT_PUBLIC_AEQUITAS_API_URL",
    "AEQUITAS_API_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
}

async function upsertEnv(projectId, key, value, targets) {
  await vercelRequest(`/v10/projects/${projectId}/env`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: targets,
    }),
  });
}

async function run() {
  const repo = mustEnv("GITHUB_REPOSITORY");
  const [repoOwner, repoName] = repo.split("/");
  const projectName = optEnv("VERCEL_PROJECT_NAME", "aequitas-web");
  const productionBranch = optEnv("VERCEL_PRODUCTION_BRANCH", "main");
  const envTargets = ["production", "preview"];

  const report = {
    platform: "vercel",
    started_at: nowIso(),
    project_name: projectName,
    repo,
    steps: [],
  };

  try {
    const project = await vercelRequest("/v10/projects", {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        framework: "nextjs",
        rootDirectory: "apps/web",
        gitRepository: {
          type: "github",
          repo,
        },
        productionBranch,
      }),
    }).catch(async (error) => {
      if (!String(error.message).includes("`name` already exists")) {
        throw error;
      }
      return vercelRequest(`/v9/projects/${encodeURIComponent(projectName)}`);
    });

    report.steps.push({ name: "project-ready", at: nowIso(), status: "ok" });
    report.project_id = project.id;
    report.project_link = `https://vercel.com/${repoOwner}/${projectName}`;

    for (const key of requiredFrontendEnv()) {
      const value = optEnv(key);
      if (!value) {
        report.steps.push({ name: `env-${key}`, status: "skipped-missing", at: nowIso() });
        continue;
      }
      await upsertEnv(project.id, key, value, envTargets);
      report.steps.push({ name: `env-${key}`, status: "ok", at: nowIso() });
    }

    const deployment = await vercelRequest("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        project: project.id,
        target: "production",
        gitSource: {
          type: "github",
          repo: repoName,
          org: repoOwner,
          ref: productionBranch,
        },
      }),
    });

    report.steps.push({ name: "production-deploy-triggered", status: "ok", at: nowIso() });
    report.deployment_url = deployment.url ? `https://${deployment.url}` : null;
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    report.finished_at = nowIso();
    writeJson("artifacts/vercel-onboarding/setup-status.json", report);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
