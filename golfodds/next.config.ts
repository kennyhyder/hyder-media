import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/golfodds",
  assetPrefix: "/golfodds",
  trailingSlash: true,
};

export default nextConfig;
