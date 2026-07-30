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
        "smart-dream.smartdream.workers.dev",
        "*.workers.dev",
        "localhost:3000",
        "localhost:8787",
        "sd.raiyan.io",
        "smart-dream-admin.vercel.app",
        "smart-dream.vercel.app",
        "*.vercel.app",
      ],
    },
  },
};

export default nextConfig;
