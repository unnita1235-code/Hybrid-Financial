import path from "path";
import type { NextConfig } from "next";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Monorepo: trace from repo root when building from `apps/web`
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Dev: allow /_next/* when the app is opened via LAN IP (not localhost) see allowedDevOrigins
  allowedDevOrigins: ["192.168.1.5"],
};

export default nextConfig;
