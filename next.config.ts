import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Conjugation data for the second-source check; loaded at run time on the server, never bundled.
  serverExternalPackages: ["french-verbs", "german-verbs"],
};

export default nextConfig;
