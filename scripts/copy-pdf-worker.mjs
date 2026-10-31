import { copyFile, mkdir } from "node:fs/promises";

const worker = new URL("../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
const publicDirectory = new URL("../public/", import.meta.url);
await mkdir(publicDirectory, { recursive: true });
await copyFile(worker, new URL("pdf.worker.min.mjs", publicDirectory));
