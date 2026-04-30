/**
 * Runs the Postman collection with Newman using FRONTEND_URL, BACKEND_URL from the environment.
 * Defaults BACKEND_URL to NEXT_PUBLIC_AEQUITAS_API_URL or the public worker URL from apps/web/.env.example.
 */
const path = require("node:path");
const newman = require("newman");
const { optEnv } = require("./common");

const collection = path.join(__dirname, "../../postman/aequitas-web.postman_collection.json");

const fe = optEnv("FRONTEND_URL");
const frontend = (fe ? fe.replace(/\/$/, "") : "http://127.0.0.1:3000") || "http://127.0.0.1:3000";
const be = optEnv("BACKEND_URL") || optEnv("NEXT_PUBLIC_AEQUITAS_API_URL");
const backend = (be ? be.replace(/\/$/, "") : "https://api.aequitasfi.workers.dev") || "https://api.aequitasfi.workers.dev";

newman.run(
  {
    collection,
    envVar: [
      { key: "FRONTEND_URL", value: frontend },
      { key: "BACKEND_URL", value: backend },
    ],
    reporters: "cli",
    color: true,
  },
  (err, summary) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    const failures = summary?.run?.failures?.length ?? 0;
    if (failures > 0) {
      process.exit(1);
    }
  },
);
