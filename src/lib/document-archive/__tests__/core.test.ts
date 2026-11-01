import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  archiveCollectionPath,
  archiveStoragePath,
  assertRecordIntegrity,
  canonicalJson,
  createArchiveService,
  prepareArchive,
  sha256,
} from "../core";
import type {
  ArchiveActor,
  ArchiveBackend,
  ArchiveInput,
  ArchiveRecord,
  PreparedArchive,
  StoredPdfMetadata,
} from "../types";

const schema = z.object({
  name: z.string().trim().min(1),
  salary: z.number().finite().min(0),
  duties: z.array(z.string()),
});
const actor = { uid: "approved-staff", displayName: "CarePal Staff" };
function input(overrides: Partial<ArchiveInput> = {}): ArchiveInput {
  return {
    kind: "offers",
    data: { name: "Priya Sharma", salary: 25000, duties: ["Development"] },
    pdf: new Blob(["%PDF-1.7\nexact document bytes"], {
      type: "application/pdf",
    }),
    filename: "CarePal-Priya.pdf",
    subjectName: "Priya Sharma",
    documentDate: "2026-11-01",
    schema,
    ...overrides,
  };
}

function memoryBackend() {
  const records = new Map<string, ArchiveRecord>();
  const blobs = new Map<string, Blob>();
  const metadata = new Map<string, StoredPdfMetadata>();
  const backend: ArchiveBackend = {
    getRecord: vi.fn(async (kind, id) => records.get(`${kind}/${id}`) ?? null),
    ensurePdf: vi.fn(async (prepared, uploader) => {
      const existing = metadata.get(prepared.pdfStoragePath);
      if (existing) return existing;
      const meta = {
        path: prepared.pdfStoragePath,
        size: prepared.pdfSizeBytes,
        contentType: "application/pdf",
        customMetadata: {
          archiveId: prepared.id,
          kind: prepared.kind,
          pdfSha256: prepared.pdfSha256,
          snapshotSha256: prepared.snapshotSha256,
          createdByUid: uploader.uid,
        },
      };
      blobs.set(meta.path, prepared.pdf);
      metadata.set(meta.path, meta);
      return meta;
    }),
    finalize: vi.fn(async (prepared, creator) => {
      const key = `${prepared.kind}/${prepared.id}`;
      const existing = records.get(key);
      if (existing) return existing;
      const { pdf: _pdf, ...fields } = prepared;
      const record = {
        ...fields,
        createdByUid: creator.uid,
        createdByName: creator.displayName,
        savedAt: "2026-11-01T00:00:00.000Z",
      };
      records.set(key, record);
      return record;
    }),
    getPdfMetadata: vi.fn(async (path) => {
      const value = metadata.get(path);
      if (!value) throw new Error("File missing");
      return value;
    }),
    downloadPdf: vi.fn(async (path) => {
      const blob = blobs.get(path);
      if (!blob) throw new Error("File missing");
      return blob;
    }),
  };
  return { backend, records, blobs, metadata };
}

describe("immutable document preparation", () => {
  it("retains exact renderer snapshot values even when validation trims strings", async () => {
    const original = {
      name: "  Priya Sharma  ",
      salary: 25000,
      duties: [" Development "],
    };
    const prepared = await prepareArchive(input({ data: original }));
    expect(prepared.data).toEqual(original);
    original.name = "Changed after preparation";
    original.duties.push("Later duty");
    expect(prepared.data).toEqual({
      name: "  Priya Sharma  ",
      salary: 25000,
      duties: [" Development "],
    });
  });

  it("gives retries the same identity regardless of object property insertion order", async () => {
    const first = await prepareArchive(input());
    const second = await prepareArchive(
      input({
        data: { duties: ["Development"], salary: 25000, name: "Priya Sharma" },
      }),
    );
    expect(first.id).toBe(second.id);
    expect(first.snapshotSha256).toBe(second.snapshotSha256);
  });

  it("separates documents when exact PDF bytes, form content or kind changes", async () => {
    const original = await prepareArchive(input());
    const differentPdf = await prepareArchive(
      input({ pdf: new Blob(["%PDF-1.7\nchanged bytes"]) }),
    );
    const differentData = await prepareArchive(
      input({
        data: { name: "Priya Sharma", salary: 27000, duties: ["Development"] },
      }),
    );
    const agreement = await prepareArchive(input({ kind: "agreements" }));
    expect(
      new Set([original.id, differentPdf.id, differentData.id, agreement.id])
        .size,
    ).toBe(4);
  });

  it("uses separate private storage and Firestore paths for each kind", async () => {
    const offer = await prepareArchive(input());
    expect(offer.pdfStoragePath).toBe(
      `document-archives/offers/${offer.id}.pdf`,
    );
    expect(archiveCollectionPath("agreements")).toBe(
      "organizations/carepal/documentArchives/agreements/records",
    );
    expect(() => archiveStoragePath("offers", "../../escape")).toThrow();
  });

  it("validates complete document fields before an upload can begin", async () => {
    await expect(
      prepareArchive(input({ data: { name: "", salary: -1, duties: [] } })),
    ).rejects.toThrow();
    await expect(
      prepareArchive(input({ filename: "../../employee.pdf" })),
    ).rejects.toThrow("filename");
    await expect(prepareArchive(input({ subjectName: "" }))).rejects.toThrow(
      "subject",
    );
  });

  it("rejects non-PDF content and oversized PDFs", async () => {
    await expect(
      prepareArchive(input({ pdf: new Blob(["html page"]) })),
    ).rejects.toThrow("valid PDF");
    await expect(
      prepareArchive(
        input({ pdf: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]) }),
      ),
    ).rejects.toThrow("20 MB");
  });

  it("rejects unsupported snapshot values instead of losing fields silently", () => {
    expect(() => canonicalJson({ unexpected: undefined })).toThrow(
      "unsupported",
    );
    expect(() => canonicalJson({ unexpected: Infinity })).toThrow(
      "unsupported",
    );
    expect(() => canonicalJson({ date: new Date() })).toThrow("unsupported");
  });

  it("computes the standard SHA-256 digest", async () => {
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("shared document archive lifecycle", () => {
  let memory: ReturnType<typeof memoryBackend>;
  beforeEach(() => {
    memory = memoryBackend();
  });

  it("saves the exact PDF and makes an immutable record visible only after storage verification", async () => {
    const order: string[] = [];
    const originalEnsure = memory.backend.ensurePdf;
    const originalFinalize = memory.backend.finalize;
    memory.backend.ensurePdf = vi.fn(async (prepared, actor) => {
      order.push("upload");
      return originalEnsure(prepared, actor);
    });
    memory.backend.finalize = vi.fn(async (prepared, actor) => {
      order.push("record");
      return originalFinalize(prepared, actor);
    });
    const record = await createArchiveService(memory.backend).save(
      input(),
      actor,
    );
    expect(order).toEqual(["upload", "record"]);
    expect(record.createdByUid).toBe(actor.uid);
    expect(await memory.blobs.get(record.pdfStoragePath)?.text()).toBe(
      await input().pdf.text(),
    );
    expect(record).not.toHaveProperty("downloadUrl");
    expect(record).not.toHaveProperty("pdf");
  });

  it("reuses an identical retry without overwriting its timestamp or uploading again", async () => {
    const service = createArchiveService(memory.backend);
    const first = await service.save(input(), actor);
    const retry = await service.save(input(), {
      uid: "another-approved",
      displayName: "Another staff",
    });
    expect(retry).toEqual(first);
    expect(memory.backend.ensurePdf).toHaveBeenCalledTimes(1);
    expect(memory.backend.finalize).toHaveBeenCalledTimes(1);
    expect(memory.records.size).toBe(1);
  });

  it("recovers a successful upload after Firestore finalization failed", async () => {
    const finalizer = memory.backend.finalize;
    memory.backend.finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockImplementation(finalizer);
    const service = createArchiveService(memory.backend);
    await expect(service.save(input(), actor)).rejects.toThrow("Offline");
    expect(memory.records.size).toBe(0);
    expect(memory.blobs.size).toBe(1);
    await service.save(input(), actor);
    expect(memory.records.size).toBe(1);
    expect(memory.blobs.size).toBe(1);
  });

  it("does not publish a record when upload metadata conflicts", async () => {
    memory.backend.ensurePdf = vi.fn(async (prepared) => ({
      path: prepared.pdfStoragePath,
      size: prepared.pdfSizeBytes,
      contentType: "application/pdf",
      customMetadata: {
        archiveId: prepared.id,
        kind: prepared.kind,
        pdfSha256: "0".repeat(64),
        snapshotSha256: prepared.snapshotSha256,
      },
    }));
    await expect(
      createArchiveService(memory.backend).save(input(), actor),
    ).rejects.toThrow("does not match");
    expect(memory.backend.finalize).not.toHaveBeenCalled();
  });

  it("returns one immutable record for concurrent identical saves", async () => {
    const service = createArchiveService(memory.backend);
    const [first, second] = await Promise.all([
      service.save(input(), actor),
      service.save(input(), actor),
    ]);
    expect(first).toEqual(second);
    expect(memory.records.size).toBe(1);
    expect(memory.blobs.size).toBe(1);
  });

  it("records the finalizer rather than impersonating a different earlier uploader", async () => {
    const prepared = await prepareArchive(input());
    await memory.backend.ensurePdf(prepared, {
      uid: "earlier-uploader",
      displayName: "Earlier staff",
    });
    const saved = await createArchiveService(memory.backend).save(
      input(),
      actor,
    );
    expect(saved.createdByUid).toBe(actor.uid);
    expect(
      memory.metadata.get(saved.pdfStoragePath)?.customMetadata.createdByUid,
    ).toBe("earlier-uploader");
  });

  it("downloads verified stored bytes instead of regenerating the template", async () => {
    const service = createArchiveService(memory.backend);
    const record = await service.save(input(), actor);
    const downloaded = await service.download(record);
    expect(await downloaded.text()).toBe("%PDF-1.7\nexact document bytes");
    expect(memory.backend.downloadPdf).toHaveBeenCalledWith(
      record.pdfStoragePath,
    );
  });

  it("rejects corrupted stored bytes before a download is delivered", async () => {
    const service = createArchiveService(memory.backend);
    const record = await service.save(input(), actor);
    memory.blobs.set(
      record.pdfStoragePath,
      new Blob(["%PDF-1.7\ncorrupted document!"]),
    );
    await expect(service.download(record)).rejects.toThrow("integrity check");
  });

  it("detects a changed persisted snapshot even if its record ID is unchanged", async () => {
    const record = await createArchiveService(memory.backend).save(
      input(),
      actor,
    );
    await expect(
      assertRecordIntegrity({
        ...record,
        data: { name: "Imposter", salary: 1, duties: [] },
      }),
    ).rejects.toThrow("snapshot");
  });

  it("rejects forged cross-kind paths", async () => {
    const record = await createArchiveService(memory.backend).save(
      input(),
      actor,
    );
    await expect(
      assertRecordIntegrity({
        ...record,
        pdfStoragePath: record.pdfStoragePath.replace("offers", "agreements"),
      }),
    ).rejects.toThrow("metadata");
  });

  it("re-reads trusted record metadata rather than following a caller-supplied object path", async () => {
    const service = createArchiveService(memory.backend);
    const record = await service.save(input(), actor);
    await service.download({ ...record, pdfStoragePath: "public/forged.pdf" });
    expect(memory.backend.downloadPdf).toHaveBeenCalledWith(
      record.pdfStoragePath,
    );
  });
});
