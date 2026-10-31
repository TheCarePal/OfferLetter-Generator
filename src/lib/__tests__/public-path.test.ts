import { describe, expect, it } from "vitest";
import { getPublicAssetPath, normalizeBasePath } from "../public-path";

describe("GitHub Pages asset paths", () => {
  it.each([undefined, "", "/"])("uses the site root for base path %s", (basePath) => {
    expect(normalizeBasePath(basePath)).toBe("");
  });

  it.each([
    "TheCarepal-OfferLetter-Creator",
    "/TheCarepal-OfferLetter-Creator",
    "/TheCarepal-OfferLetter-Creator/",
    " //TheCarepal-OfferLetter-Creator/// ",
  ])("normalizes a project-site base path %s", (basePath) => {
    expect(normalizeBasePath(basePath)).toBe("/TheCarepal-OfferLetter-Creator");
  });

  it("serves required assets at the root for local or custom-domain builds", () => {
    expect(getPublicAssetPath("/carepal-logo.png", "")).toBe("/carepal-logo.png");
    expect(getPublicAssetPath("pdf.worker.min.mjs", "/")).toBe("/pdf.worker.min.mjs");
  });

  it("prefixes the logo and PDF worker once for project builds with trailing slashes", () => {
    const basePath = "/TheCarepal-OfferLetter-Creator/";
    expect(getPublicAssetPath("/carepal-logo.png", basePath)).toBe("/TheCarepal-OfferLetter-Creator/carepal-logo.png");
    expect(getPublicAssetPath("///pdf.worker.min.mjs", basePath)).toBe("/TheCarepal-OfferLetter-Creator/pdf.worker.min.mjs");
  });
});
