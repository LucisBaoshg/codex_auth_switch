import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/codex";

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // @ts-ignore: dynamic extension property
  allowedDevOrigins: ["10.12.2.127", "localhost", "127.0.0.1"],
  turbopack: {
    root: process.cwd(),
  }
};

export default nextConfig;
