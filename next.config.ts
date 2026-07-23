import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
      ],
    },
  },
};

export default nextConfig;
