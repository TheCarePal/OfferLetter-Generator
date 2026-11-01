import type { z } from "zod";

export type ArchiveKind = "offers" | "agreements";
export type ArchiveActor = { uid: string; displayName: string };
export type ArchiveRecord = {
  id: string;
  kind: ArchiveKind;
  schemaVersion: 1;
  data: unknown;
  filename: string;
  subjectName: string;
  documentDate: string;
  savedAt: string;
  createdByUid: string;
  createdByName: string;
  snapshotSha256: string;
  pdfSha256: string;
  pdfSizeBytes: number;
  pdfStoragePath: string;
};
export type ArchiveCursor = {
  seconds: number;
  nanoseconds: number;
  id: string;
};
export type ArchivePage = {
  records: ArchiveRecord[];
  nextCursor: ArchiveCursor | null;
};
export type ArchiveInput = {
  kind: ArchiveKind;
  data: unknown;
  pdf: Blob;
  filename: string;
  subjectName: string;
  documentDate: string;
  schema: z.ZodTypeAny;
};
export type PreparedArchive = Omit<
  ArchiveRecord,
  "savedAt" | "createdByUid" | "createdByName"
> & {
  pdf: Blob;
};
export type StoredPdfMetadata = {
  path: string;
  size: number;
  contentType: string;
  customMetadata: Record<string, string | undefined>;
};
export type ArchiveBackend = {
  getRecord(kind: ArchiveKind, id: string): Promise<ArchiveRecord | null>;
  ensurePdf(
    prepared: PreparedArchive,
    actor: ArchiveActor,
  ): Promise<StoredPdfMetadata>;
  finalize(
    prepared: PreparedArchive,
    actor: ArchiveActor,
  ): Promise<ArchiveRecord>;
  getPdfMetadata(path: string): Promise<StoredPdfMetadata>;
  downloadPdf(path: string): Promise<Blob>;
};
