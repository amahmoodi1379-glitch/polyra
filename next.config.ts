import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Conjugation data for the second-source check; loaded at run time on the server, never bundled.
  serverExternalPackages: ["french-verbs", "german-verbs"],
  experimental: {
    // The staging gate (src/proxy.ts) buffers request bodies; a text's audio file can pass 10 MB.
    proxyClientMaxBodySize: "16mb",
    // The word file of «خروجی و ورود فایل» comes in as the text of a Server Action (up to 3 MB).
    serverActions: { bodySizeLimit: "4mb" },
    // A panel page seen in the last 30 seconds opens again at once from the browser (going back to the
    // workbench, the list after an item). A page fetched ahead of the click (the other language tab, a
    // menu item under the pointer) is kept a minute. Every save in the panel empties this store, so a
    // teacher never sees their own change missing.
    staleTimes: { dynamic: 30, static: 60 },
  },
};

export default nextConfig;
