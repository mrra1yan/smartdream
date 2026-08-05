import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Parent folder has another package-lock.json; pin tracing to this app root.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: [
        "localhost:3000",
        "localhost:8787",
        "sd.docstec.cloud",
      ],
    },
  },
};

export default nextConfig;
