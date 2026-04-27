const { mustEnv, nowIso, optEnv, writeJson } = require("./common");

const RAILWAY_ENDPOINT = "https://backboard.railway.com/graphql/v2";

async function railwayGraphql(query, variables = {}) {
  const token = mustEnv("RAILWAY_TOKEN");
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Railway API ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`Railway GraphQL error: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

async function run() {
  const repo = mustEnv("GITHUB_REPOSITORY");
  const [repoOwner, repoName] = repo.split("/");
  const projectName = optEnv("RAILWAY_PROJECT_NAME", "unnita1235-code");
  const serviceName = optEnv("RAILWAY_SERVICE_NAME", "aequitas-api");

  const report = {
    platform: "railway",
    started_at: nowIso(),
    project_name: projectName,
    service_name: serviceName,
    steps: [],
  };

  try {
    const createProject = `
      mutation CreateProject($name: String!) {
        projectCreate(input: { name: $name }) { id name }
      }
    `;
    let project;
    try {
      const data = await railwayGraphql(createProject, { name: projectName });
      project = data.projectCreate;
      report.steps.push({ name: "project-created", status: "ok", at: nowIso() });
    } catch {
      const getProjects = `
        query {
          me {
            projects { edges { node { id name } } }
          }
        }
      `;
      const data = await railwayGraphql(getProjects);
      project = data.me.projects.edges.map((e) => e.node).find((p) => p.name === projectName);
      if (!project) {
        throw new Error("Railway project creation failed and existing project not found.");
      }
      report.steps.push({ name: "project-found", status: "ok", at: nowIso() });
    }

    const createService = `
      mutation CreateService($projectId: String!, $name: String!) {
        serviceCreate(input: { projectId: $projectId, name: $name }) { id name }
      }
    `;
    let service;
    try {
      const data = await railwayGraphql(createService, {
        projectId: project.id,
        name: serviceName,
      });
      service = data.serviceCreate;
      report.steps.push({ name: "service-created", status: "ok", at: nowIso() });
    } catch {
      const listServices = `
        query GetProject($projectId: String!) {
          project(id: $projectId) {
            services { edges { node { id name } } }
          }
        }
      `;
      const data = await railwayGraphql(listServices, { projectId: project.id });
      service = data.project.services.edges.map((e) => e.node).find((s) => s.name === serviceName);
      if (!service) {
        throw new Error("Railway service creation failed and existing service not found.");
      }
      report.steps.push({ name: "service-found", status: "ok", at: nowIso() });
    }

    const linkGithub = `
      mutation ServiceConnectRepo(
        $projectId: String!,
        $serviceId: String!,
        $repo: String!,
        $owner: String!,
        $branch: String!
      ) {
        serviceInstanceUpdate(
          input: {
            projectId: $projectId,
            serviceId: $serviceId,
            source: {
              repo: $repo,
              owner: $owner,
              branch: $branch,
              rootDirectory: "apps/server",
              provider: GITHUB
            }
          }
        ) { id }
      }
    `;
    await railwayGraphql(linkGithub, {
      projectId: project.id,
      serviceId: service.id,
      repo: repoName,
      owner: repoOwner,
      branch: optEnv("RAILWAY_BRANCH", "main"),
    });
    report.steps.push({ name: "github-linked", status: "ok", at: nowIso() });

    const variables = [
      "DATABASE_URL",
      "SYNC_DATABASE_URL",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_JWT_SECRET",
      "APP_ENV",
      "ENVIRONMENT",
    ];
    const setVariable = `
      mutation VariableUpsert(
        $projectId: String!,
        $environmentId: String!,
        $serviceId: String!,
        $name: String!,
        $value: String!
      ) {
        variableUpsert(input: {
          projectId: $projectId,
          environmentId: $environmentId,
          serviceId: $serviceId,
          name: $name,
          value: $value
        }) { id }
      }
    `;

    const envData = await railwayGraphql(
      `query GetEnvs($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }`,
      { projectId: project.id },
    );
    const prodEnv = envData.project.environments.edges.find(
      (edge) => edge.node.name.toLowerCase() === "production",
    )?.node;

    if (prodEnv) {
      for (const key of variables) {
        const value = optEnv(key);
        if (!value) {
          report.steps.push({ name: `env-${key}`, status: "skipped-missing", at: nowIso() });
          continue;
        }
        await railwayGraphql(setVariable, {
          projectId: project.id,
          environmentId: prodEnv.id,
          serviceId: service.id,
          name: key,
          value,
        });
        report.steps.push({ name: `env-${key}`, status: "ok", at: nowIso() });
      }
    }

    report.project_id = project.id;
    report.service_id = service.id;
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    report.finished_at = nowIso();
    writeJson("artifacts/railway-onboarding/setup-status.json", report);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
