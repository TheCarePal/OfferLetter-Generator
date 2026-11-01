import { FirebaseError } from "firebase/app";
import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";
import {
  getBlob,
  getMetadata,
  ref,
  uploadBytes,
  type FullMetadata,
} from "firebase/storage";
import { getFirebaseClient } from "../firebase/client";
import { requireStaff } from "../firebase/auth";
import {
  ARCHIVE_PAGE_SIZE,
  MAX_PDF_BYTES,
  SHA256_PATTERN,
  archiveCollectionPath,
  archiveStoragePath,
  assertArchiveId,
  assertArchiveKind,
  assertRecordIntegrity,
  createArchiveService,
} from "./core";
import type {
  ArchiveBackend,
  ArchiveCursor,
  ArchiveInput,
  ArchiveKind,
  ArchivePage,
  ArchiveRecord,
  PreparedArchive,
  StoredPdfMetadata,
} from "./types";

export const ARCHIVE_SAVE_TIMEOUT_MS = 45_000;
export const ARCHIVE_READ_TIMEOUT_MS = 30_000;

/** A timeout does not mutate or cancel an immutable operation; retry safely reuses its hashes. */
async function withDeadline<T>(
  work: () => Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The shared history request timed out. Check your connection and try again; any completed save will be reused.",
              ),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errorCode(error: unknown): string {
  return error instanceof FirebaseError ? error.code : "";
}
function metadataValue(metadata: FullMetadata): StoredPdfMetadata {
  return {
    path: metadata.fullPath,
    size: metadata.size,
    contentType: metadata.contentType ?? "",
    customMetadata: metadata.customMetadata ?? {},
  };
}
function assertSavedAt(value: unknown): Timestamp {
  if (!(value instanceof Timestamp))
    throw new Error("The archived document has an invalid save date.");
  return value;
}

export function parseArchiveRecord(
  kind: ArchiveKind,
  id: string,
  value: DocumentData,
): ArchiveRecord {
  assertArchiveKind(kind);
  assertArchiveId(id);
  const { savedAt } = value;
  const required = [
    "filename",
    "subjectName",
    "documentDate",
    "createdByUid",
    "createdByName",
    "snapshotSha256",
    "pdfSha256",
    "pdfStoragePath",
  ];
  if (
    value.id !== id ||
    value.kind !== kind ||
    value.schemaVersion !== 1 ||
    required.some((key) => typeof value[key] !== "string" || !value[key]) ||
    typeof value.data !== "object" ||
    value.data === null ||
    Array.isArray(value.data) ||
    !Number.isInteger(value.pdfSizeBytes) ||
    value.pdfSizeBytes < 5 ||
    value.pdfSizeBytes > MAX_PDF_BYTES ||
    !SHA256_PATTERN.test(value.pdfSha256) ||
    !SHA256_PATTERN.test(value.snapshotSha256) ||
    value.pdfStoragePath !== archiveStoragePath(kind, id)
  )
    throw new Error("A shared history record is invalid. It was not opened.");
  if (
    value.filename.length > 240 ||
    !value.filename.endsWith(".pdf") ||
    /[\\/\u0000-\u001f]/.test(value.filename) ||
    value.subjectName.length > 180 ||
    value.createdByName.length > 160 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.documentDate)
  )
    throw new Error(
      "A shared history record contains invalid document details.",
    );
  return {
    id,
    kind,
    schemaVersion: 1,
    data: value.data as unknown,
    filename: String(value.filename),
    subjectName: String(value.subjectName),
    documentDate: String(value.documentDate),
    savedAt: assertSavedAt(savedAt).toDate().toISOString(),
    createdByUid: String(value.createdByUid),
    createdByName: String(value.createdByName),
    snapshotSha256: String(value.snapshotSha256),
    pdfSha256: String(value.pdfSha256),
    pdfSizeBytes: Number(value.pdfSizeBytes),
    pdfStoragePath: String(value.pdfStoragePath),
  };
}

function createFirebaseBackend(): ArchiveBackend {
  const client = getFirebaseClient();
  return {
    async getRecord(kind, id) {
      assertArchiveKind(kind);
      assertArchiveId(id);
      const snapshot = await getDoc(
        doc(client.db, archiveCollectionPath(kind), id),
      );
      return snapshot.exists()
        ? parseArchiveRecord(kind, id, snapshot.data())
        : null;
    },
    async ensurePdf(prepared, actor) {
      const object = ref(client.storage, prepared.pdfStoragePath);
      try {
        return metadataValue(await getMetadata(object));
      } catch (error) {
        if (errorCode(error) !== "storage/object-not-found") throw error;
      }
      try {
        const uploaded = await uploadBytes(object, prepared.pdf, {
          contentType: "application/pdf",
          customMetadata: {
            archiveId: prepared.id,
            kind: prepared.kind,
            pdfSha256: prepared.pdfSha256,
            snapshotSha256: prepared.snapshotSha256,
            createdByUid: actor.uid,
          },
        });
        return metadataValue(uploaded.metadata);
      } catch (error) {
        // Create-only rules decide concurrent uploads. Reuse only a verified match.
        try {
          return metadataValue(await getMetadata(object));
        } catch {
          throw error;
        }
      }
    },
    async finalize(prepared: PreparedArchive, actor) {
      const recordRef = doc(
        client.db,
        archiveCollectionPath(prepared.kind),
        prepared.id,
      );
      await runTransaction(
        client.db,
        async (transaction) => {
          const existing = await transaction.get(recordRef);
          if (existing.exists()) return;
          const { pdf: _pdf, ...fields } = prepared;
          transaction.set(recordRef, {
            ...fields,
            savedAt: serverTimestamp(),
            createdByUid: actor.uid,
            createdByName: actor.displayName,
          });
        },
        { maxAttempts: 3 },
      );
      // Re-read the server timestamp and the winning immutable record.
      const result = await getDoc(recordRef);
      if (!result.exists())
        throw new Error(
          "The document could not be confirmed in shared history. Try saving again.",
        );
      return parseArchiveRecord(prepared.kind, prepared.id, result.data());
    },
    async getPdfMetadata(path) {
      return metadataValue(await getMetadata(ref(client.storage, path)));
    },
    async downloadPdf(path) {
      return getBlob(ref(client.storage, path), MAX_PDF_BYTES);
    },
  };
}

export async function archiveDocument(
  input: ArchiveInput,
): Promise<ArchiveRecord> {
  return withDeadline(async () => {
    const staff = await requireStaff();
    return createArchiveService(createFirebaseBackend()).save(input, {
      uid: staff.uid,
      displayName: staff.displayName,
    });
  }, ARCHIVE_SAVE_TIMEOUT_MS);
}

export async function getArchivedPdf(record: ArchiveRecord): Promise<Blob> {
  return withDeadline(async () => {
    await requireStaff();
    return createArchiveService(createFirebaseBackend()).download(record);
  }, ARCHIVE_READ_TIMEOUT_MS);
}

function validateCursor(cursor: ArchiveCursor): void {
  assertArchiveId(cursor.id);
  if (
    !Number.isInteger(cursor.seconds) ||
    cursor.seconds < 0 ||
    !Number.isInteger(cursor.nanoseconds) ||
    cursor.nanoseconds < 0 ||
    cursor.nanoseconds > 999999999
  )
    throw new Error("The shared history page cursor is invalid.");
}

/** A timestamp plus document-ID ordering uses a single-field Firestore index. */
async function loadPage(
  kind: ArchiveKind,
  cursor: ArchiveCursor | null = null,
): Promise<ArchivePage> {
  assertArchiveKind(kind);
  if (cursor) validateCursor(cursor);
  await requireStaff();
  const { db } = getFirebaseClient();
  const constraints: QueryConstraint[] = [
    orderBy("savedAt", "desc"),
    orderBy(documentId(), "desc"),
  ];
  if (cursor)
    constraints.push(
      startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id),
    );
  constraints.push(limit(ARCHIVE_PAGE_SIZE + 1));
  const snapshot = await getDocs(
    query(collection(db, archiveCollectionPath(kind)), ...constraints),
  );
  const documents = snapshot.docs.slice(0, ARCHIVE_PAGE_SIZE);
  const records = documents.map((document) =>
    parseArchiveRecord(kind, document.id, document.data()),
  );
  await Promise.all(records.map(assertRecordIntegrity));
  const last =
    snapshot.docs.length > ARCHIVE_PAGE_SIZE ? documents.at(-1) : undefined;
  const timestamp = last ? assertSavedAt(last.data().savedAt) : null;
  return {
    records,
    nextCursor:
      last && timestamp
        ? {
            seconds: timestamp.seconds,
            nanoseconds: timestamp.nanoseconds,
            id: last.id,
          }
        : null,
  };
}

export async function loadArchivePage(
  kind: ArchiveKind,
  cursor: ArchiveCursor | null = null,
): Promise<ArchivePage> {
  return withDeadline(() => loadPage(kind, cursor), ARCHIVE_READ_TIMEOUT_MS);
}
