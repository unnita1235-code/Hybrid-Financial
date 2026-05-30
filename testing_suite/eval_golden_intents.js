#!/usr/bin/env node
/**
 * Validates golden_intents.json — deploy gate (no network, no API keys).
 * Writes artifacts/ai-eval/golden-intents-status.json on success.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GOLDEN_PATH = path.join(__dirname, "golden_intents.json");
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "ai-eval");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "golden-intents-status.json");

const HTTP_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]);
const WORKER_NATIVE_PATHS = new Set([
  "/",
  "/health",
  "/v1/alerts/count",
  "/v1/alerts",
  "/v1/portfolio/summary",
  "/v1/debate/risk-assessment",
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0);
}

function validateIntent(intent, index) {
  const label = `intents[${index}]`;
  assert(intent && typeof intent === "object", `${label}: must be an object`);
  assert(typeof intent.id === "string" && intent.id.length > 0, `${label}: id is required`);
  assert(typeof intent.method === "string", `${label}: method is required`);
  assert(HTTP_METHODS.has(intent.method), `${label}: invalid method ${intent.method}`);
  assert(typeof intent.path === "string" && intent.path.startsWith("/"), `${label}: path must start with /`);

  if (intent.runtime !== undefined) {
    assert(
      intent.runtime === "worker" || intent.runtime === "upstream",
      `${label}: runtime must be worker or upstream`,
    );
  }

  if (intent.request !== undefined) {
    assert(typeof intent.request === "object", `${label}: request must be an object`);
    if (intent.request.required !== undefined) {
      assert(isStringArray(intent.request.required), `${label}: request.required must be string[]`);
    }
    if (intent.request.optional !== undefined) {
      assert(isStringArray(intent.request.optional), `${label}: request.optional must be string[]`);
    }
  }

  if (intent.response !== undefined) {
    assert(typeof intent.response === "object", `${label}: response must be an object`);
    if (intent.response.required !== undefined) {
      assert(isStringArray(intent.response.required), `${label}: response.required must be string[]`);
    }
    if (intent.response.sse_events !== undefined) {
      assert(isStringArray(intent.response.sse_events), `${label}: response.sse_events must be string[]`);
    }
  }

  if (intent.runtime === "worker" && !intent.path.includes(":")) {
    assert(
      WORKER_NATIVE_PATHS.has(intent.path) || intent.path.startsWith("/v1/alerts/"),
      `${label}: path ${intent.path} is not a known worker-native route`,
    );
  }
}

function main() {
  assert(fs.existsSync(GOLDEN_PATH), `Missing ${GOLDEN_PATH}`);
  const doc = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));

  assert(typeof doc.version === "number", "golden_intents.json: version must be a number");
  assert(Array.isArray(doc.intents) && doc.intents.length > 0, "golden_intents.json: intents must be a non-empty array");

  const ids = new Set();
  for (let i = 0; i < doc.intents.length; i += 1) {
    const intent = doc.intents[i];
    validateIntent(intent, i);
    assert(!ids.has(intent.id), `Duplicate intent id: ${intent.id}`);
    ids.add(intent.id);
  }

  const requiredIds = ["health", "debate_risk_assessment", "insight_stream"];
  for (const id of requiredIds) {
    assert(ids.has(id), `Missing required golden intent: ${id}`);
  }

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(
    ARTIFACT_PATH,
    JSON.stringify(
      {
        status: "passed",
        intent_count: doc.intents.length,
        checked_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log("Golden intent contract eval passed.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
