const fs = require("node:fs");
const path = require("node:path");

function mustEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optEnv(name, fallback = null) {
  return process.env[name] ?? fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  ensureDir,
  mustEnv,
  nowIso,
  optEnv,
  writeJson,
};
