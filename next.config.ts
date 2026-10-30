import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Office scene bundles are read from disk at runtime (lib/office-studio.ts)
  outputFileTracingIncludes: {
    "/dashboard": ["./office-studio/**/*.json"],
    "/api/office-studio/[office]/[...asset]": ["./office-studio/**/*.json"],
  },
  experimental: {
    // Allow custom campaign icon uploads (validated to 2MB in the action)
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
