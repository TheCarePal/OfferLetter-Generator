import type { z } from "zod";
import type {
  ArchiveActor,
  ArchiveBackend,
  ArchiveInput,
  ArchiveKind,
  ArchiveRecord,
  PreparedArchive,
  StoredPdfMetadata,
} from "./types";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 400 * 1024;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const ARCHIVE_PAGE_SIZE = 20;
const encoder = new TextEncoder();

export function assertArchiveKind(kind: string): asserts kind is ArchiveKind {
  if (kind !== "offers" && kind !== "agreements")
    throw new Error("Unsupported document archive kind.");
}
export function assertArchiveId(id: string): void {
  if (!SHA256_PATTERN.test(id))
    throw new Error("Invalid document archive identifier.");
}
export function archiveCollectionPath(kind: ArchiveKind): string {
  assertArchiveKind(kind);
  return `organizations/carepal/documentArchives/${kind}/records`;
}
export function archiveStoragePath(kind: ArchiveKind, id: string): string {
  assertArchiveKind(kind);
  assertArchiveId(id);
  return `document-archives/${kind}/${id}.pdf`;
}

/** Stable keys make retries independent of JavaScript object property order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  throw new Error("The document snapshot contains an unsupported value.");
}
export async function sha256(value: Blob | string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure PDF verification requires HTTPS or localhost.");
  const bytes =
    typeof value === "string"
      ? encoder.encode(value)
      : await value.arrayBuffer();
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function validateArchivedSnapshot<T>(
  record: ArchiveRecord,
  schema: z.ZodType<T>,
): T {
  return schema.parse(record.data);
}
function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (!text || text.length > max)
    throw new Error(`The archive ${label} is invalid.`);
  return text;
}
function assertSnapshotShape(original: unknown, validated: unknown): void {
  if (Array.isArray(original) && Array.isArray(validated)) {
    if (original.length !== validated.length)
      throw new Error(
        "The validated snapshot must retain every document field.",
      );
    original.forEach((value, index) =>
      assertSnapshotShape(value, validated[index]),
    );
    return;
  }
  if (
    typeof original === "object" &&
    original !== null &&
    typeof validated === "object" &&
    validated !== null &&
    !Array.isArray(original) &&
    !Array.isArray(validated)
  ) {
    const keys = Object.keys(original).sort();
    if (keys.join("\n") !== Object.keys(validated).sort().join("\n"))
      throw new Error(
        "The document snapshot contains unexpected or missing fields.",
      );
    keys.forEach((key) =>
      assertSnapshotShape(
        (original as Record<string, unknown>)[key],
        (validated as Record<string, unknown>)[key],
      ),
    );
  }
}

export async function prepareArchive(
  input: ArchiveInput,
): Promise<PreparedArchive> {
  assertArchiveKind(input.kind);
  // Validate without transforming the exact snapshot used by the PDF renderer.
  // Export schemas trim strings; archiving must retain the original frozen values.
  const validated = input.schema.parse(input.data);
  assertSnapshotShape(input.data, validated);
  const serialized = canonicalJson(input.data);
  if (encoder.encode(serialized).byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error("The document snapshot is too large to archive.");
  if (
    !(input.pdf instanceof Blob) ||
    input.pdf.size < 5 ||
    input.pdf.size > MAX_PDF_BYTES
  )
    throw new Error("Archive a PDF between 5 bytes and 20 MB.");
  if ((await input.pdf.slice(0, 5).text()) !== "%PDF-")
    throw new Error("The archive file is not a valid PDF.");
  const pdf = input.pdf.slice(0, input.pdf.size, "application/pdf");
  const filename = cleanText(input.filename, "filename", 240);
  if (!filename.endsWith(".pdf") || /[\\/\u0000-\u001f]/.test(filename))
    throw new Error("The archive filename must be a safe PDF filename.");
  const subjectName = cleanText(input.subjectName, "subject", 180);
  const documentDate = cleanText(input.documentDate, "document date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate))
    throw new Error("The archive document date is invalid.");
  const [snapshotSha256, pdfSha256] = await Promise.all([
    sha256(serialized),
    sha256(pdf),
  ]);
  const id = await sha256(`${input.kind}\n${snapshotSha256}\n${pdfSha256}`);
  return Object.freeze({
    id,
    kind: input.kind,
    schemaVersion: 1 as const,
    data: JSON.parse(serialized) as unknown,
    filename,
    subjectName,
    documentDate,
    snapshotSha256,
    pdfSha256,
    pdfSizeBytes: pdf.size,
    pdfStoragePath: archiveStoragePath(input.kind, id),
    pdf,
  });
}
export async function assertRecordIntegrity(
  record: ArchiveRecord,
): Promise<void> {
  assertArchiveKind(record.kind);
  assertArchiveId(record.id);
  if (
    record.pdfStoragePath !== archiveStoragePath(record.kind, record.id) ||
    !SHA256_PATTERN.test(record.snapshotSha256) ||
    !SHA256_PATTERN.test(record.pdfSha256) ||
    record.pdfSizeBytes < 5 ||
    record.pdfSizeBytes > MAX_PDF_BYTES
  )
    throw new Error("The archived PDF metadata is invalid.");
  const serialized = canonicalJson(record.data);
  if (
    encoder.encode(serialized).byteLength > MAX_SNAPSHOT_BYTES ||
    (await sha256(serialized)) !== record.snapshotSha256
  )
    throw new Error(
      "The archived document snapshot failed its integrity check.",
    );
  const id = await sha256(
    `${record.kind}\n${record.snapshotSha256}\n${record.pdfSha256}`,
  );
  if (record.id !== id)
    throw new Error(
      "The archived document identity failed its integrity check.",
    );
}
export function assertPdfMetadata(
  metadata: StoredPdfMetadata,
  prepared: Pick<
    PreparedArchive,
    | "id"
    | "kind"
    | "pdfStoragePath"
    | "pdfSha256"
    | "pdfSizeBytes"
    | "snapshotSha256"
  >,
): void {
  if (
    metadata.path !== prepared.pdfStoragePath ||
    metadata.size !== prepared.pdfSizeBytes ||
    metadata.contentType !== "application/pdf" ||
    metadata.customMetadata.archiveId !== prepared.id ||
    metadata.customMetadata.kind !== prepared.kind ||
    metadata.customMetadata.pdfSha256 !== prepared.pdfSha256 ||
    metadata.customMetadata.snapshotSha256 !== prepared.snapshotSha256
  )
    throw new Error(
      "The saved PDF does not match this document. The existing file was not replaced.",
    );
}
export function assertRecordMatches(
  record: ArchiveRecord,
  prepared: PreparedArchive,
): void {
  if (
    record.id !== prepared.id ||
    record.kind !== prepared.kind ||
    record.pdfSha256 !== prepared.pdfSha256 ||
    record.snapshotSha256 !== prepared.snapshotSha256 ||
    record.pdfSizeBytes !== prepared.pdfSizeBytes ||
    record.pdfStoragePath !== prepared.pdfStoragePath ||
    record.filename !== prepared.filename ||
    record.subjectName !== prepared.subjectName ||
    record.documentDate !== prepared.documentDate
  )
    throw new Error("An existing archive record conflicts with this document.");
}

/** Storage is verified before an immutable history record becomes visible. */
export function createArchiveService(backend: ArchiveBackend) {
  return {
    async save(
      input: ArchiveInput,
      actor: ArchiveActor,
    ): Promise<ArchiveRecord> {
      if (!actor.uid || !actor.displayName.trim())
        throw new Error("An authenticated CarePal admin account is required.");
      const prepared = await prepareArchive(input);
      const existing = await backend.getRecord(prepared.kind, prepared.id);
      if (existing) {
        await assertRecordIntegrity(existing);
        assertRecordMatches(existing, prepared);
        assertPdfMetadata(
          await backend.getPdfMetadata(existing.pdfStoragePath),
          existing,
        );
        return existing;
      }
      const metadata = await backend.ensurePdf(prepared, actor);
      assertPdfMetadata(metadata, prepared);
      // The record identifies its finalizer; PDF metadata identifies its uploader.
      const record = await backend.finalize(prepared, actor);
      await assertRecordIntegrity(record);
      assertRecordMatches(record, prepared);
      return record;
    },
    async download(record: ArchiveRecord): Promise<Blob> {
      const stored = await backend.getRecord(record.kind, record.id);
      if (!stored) throw new Error("The archived document was not found.");
      await assertRecordIntegrity(stored);
      assertPdfMetadata(
        await backend.getPdfMetadata(stored.pdfStoragePath),
        stored,
      );
      const blob = await backend.downloadPdf(stored.pdfStoragePath);
      if (
        blob.size !== stored.pdfSizeBytes ||
        (await sha256(blob)) !== stored.pdfSha256
      )
        throw new Error(
          "The archived PDF failed its integrity check. Download cancelled.",
        );
      return blob.slice(0, blob.size, "application/pdf");
    },
  };
}
