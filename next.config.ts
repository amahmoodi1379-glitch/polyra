import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Conjugation data for the second-source check; loaded at run time on the server, never bundled.
  serverExternalPackages: ["french-verbs", "german-verbs"],
  experimental: {
    // The staging gate (src/proxy.ts) buffers request bodies; a text's audio file can pass 10 MB.
    proxyClientMaxBodySize: "16mb",
    // The word file of «خروجی و ورود فایل» comes in as the text of a Server Action (up to 3 MB).
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
