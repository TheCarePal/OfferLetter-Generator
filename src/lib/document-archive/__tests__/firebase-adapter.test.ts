import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import { z } from "zod";
import { prepareArchive } from "../core";
import {
  ARCHIVE_READ_TIMEOUT_MS,
  getArchivedPdf,
  loadArchivePage,
  parseArchiveRecord,
} from "../firebase-adapter";
import type { ArchiveRecord, PreparedArchive } from "../types";

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  query: vi.fn((...args) => args),
  collection: vi.fn((...args) => args),
  doc: vi.fn((...args) => args),
  requireStaff: vi.fn(),
}));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<typeof import("firebase/firestore")>()),
  getDocs: mocks.getDocs,
  getDoc: mocks.getDoc,
  query: mocks.query,
  collection: mocks.collection,
  doc: mocks.doc,
}));
vi.mock("../../firebase/client", () => ({
  getFirebaseClient: () => ({ db: {}, storage: {} }),
}));
vi.mock("../../firebase/auth", () => ({ requireStaff: mocks.requireStaff }));

function stored(
  prepared: PreparedArchive,
  timestamp = new Timestamp(100, 123),
) {
  const { pdf: _pdf, ...fields } = prepared;
  return {
    ...fields,
    savedAt: timestamp,
    createdByUid: "approved",
    createdByName: "CarePal Staff",
  };
}
async function prepared(index = 0): Promise<PreparedArchive> {
  return prepareArchive({
    kind: "offers",
    data: { name: `Person ${index}` },
    pdf: new Blob(["%PDF-1.7\nexactbytes"]),
    filename: `Person-${index}.pdf`,
    subjectName: `Person ${index}`,
    documentDate: "2026-11-01",
    schema: z.object({ name: z.string() }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStaff.mockResolvedValue({
    uid: "approved",
    displayName: "CarePal Staff",
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Firestore archive read boundary", () => {
  it("converts a committed server timestamp to its public ISO read model", async () => {
    const value = await prepared();
    const record = parseArchiveRecord("offers", value.id, stored(value));
    expect(record.savedAt).toBe("1970-01-01T00:01:40.000Z");
    expect(record.subjectName).toBe("Person 0");
  });

  it("rejects pending timestamps and mismatched record paths", async () => {
    const value = await prepared();
    expect(() =>
      parseArchiveRecord("offers", value.id, {
        ...stored(value),
        savedAt: null,
      }),
    ).toThrow("save date");
    expect(() =>
      parseArchiveRecord("offers", value.id, {
        ...stored(value),
        pdfStoragePath: "document-archives/agreements/other.pdf",
      }),
    ).toThrow("invalid");
  });

  it("returns 20 newest records and a timestamp plus ID cursor when another page exists", async () => {
    const values = await Promise.all(
      Array.from({ length: 21 }, (_, index) => prepared(index)),
    );
    const docs = values.map((value, index) => ({
      id: value.id,
      data: () => stored(value, new Timestamp(1000 - index, 456)),
    }));
    mocks.getDocs.mockResolvedValue({ docs });
    const result = await loadArchivePage("offers");
    expect(result.records).toHaveLength(20);
    expect(result.records[0].subjectName).toBe("Person 0");
    expect(result.records[19].subjectName).toBe("Person 19");
    expect(result.nextCursor).toEqual({
      seconds: 981,
      nanoseconds: 456,
      id: values[19].id,
    });
    expect(mocks.collection).toHaveBeenCalledWith(
      {},
      "organizations/carepal/documentArchives/offers/records",
    );
  });

  it("does not create a next-page cursor when no extra result exists", async () => {
    mocks.getDocs.mockResolvedValue({ docs: [] });
    expect(await loadArchivePage("agreements")).toEqual({
      records: [],
      nextCursor: null,
    });
  });

  it("rejects forged cursors before reading Firestore", async () => {
    await expect(
      loadArchivePage("offers", {
        seconds: 1,
        nanoseconds: -1,
        id: "a".repeat(64),
      }),
    ).rejects.toThrow("cursor");
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it("requires staff authentication before accessing shared records", async () => {
    mocks.requireStaff.mockRejectedValue(new Error("Sign in required"));
    await expect(loadArchivePage("offers")).rejects.toThrow("Sign in required");
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it("bounds an offline PDF read instead of leaving the UI waiting indefinitely", async () => {
    vi.useFakeTimers();
    const value = await prepared();
    const record = parseArchiveRecord("offers", value.id, stored(value));
    mocks.getDoc.mockReturnValue(new Promise<never>(() => {}));
    const result = getArchivedPdf(record as ArchiveRecord);
    const rejection = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(ARCHIVE_READ_TIMEOUT_MS);
    await rejection;
  });
});
