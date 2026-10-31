/**
 * Normalize the optional path that GitHub Pages hosts the app beneath.
 *
 * Local/custom-domain deployments use an empty base path, while project Pages
 * deployments typically use `/<repository-name>`.
 */
export function normalizeBasePath(basePath?: string): string {
  const normalized = basePath?.trim().replace(/^\/+|\/+$/g, "");

  return normalized ? `/${normalized}` : "";
}

export const APP_BASE_PATH = normalizeBasePath(
  process.env.NEXT_PUBLIC_BASE_PATH,
);

/** Prefix a file from `public/` with the configured deployment base path. */
export function getPublicAssetPath(
  assetPath: string,
  basePath: string | undefined = APP_BASE_PATH,
): string {
  const normalizedAssetPath = `/${assetPath.replace(/^\/+/, "")}`;

  return `${normalizeBasePath(basePath)}${normalizedAssetPath}`;
}
