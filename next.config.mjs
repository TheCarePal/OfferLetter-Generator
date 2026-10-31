// @ts-check

/**
 * GitHub Pages serves project sites below `/<repository>`. The deployment
 * workflow gets that path from actions/configure-pages and exposes it here.
 * Local development and custom-domain deployments keep using the site root.
 */
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath =
  configuredBasePath === "" || configuredBasePath === "/"
    ? ""
    : configuredBasePath.replace(/\/+$/, "").replace(/^(?!\/)/, "/");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
