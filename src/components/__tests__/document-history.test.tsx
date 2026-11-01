// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StaffAuthStatus, StaffProfile } from "@/lib/firebase/auth";
import type { ArchiveRecord } from "@/lib/document-archive";

const service = vi.hoisted(() => ({
  archiveDocument: vi.fn(),
  getArchivedPdf: vi.fn(),
  loadArchivePage: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  sendPasswordReset: vi.fn(),
}));

let authState: {
  status: StaffAuthStatus;
  staff: StaffProfile | null;
  error: string | null;
};

vi.mock("@/lib/firebase/auth", () => ({
  useStaffAuth: () => ({
    ...authState,
    signIn: service.signIn,
    signOut: service.signOut,
    sendPasswordReset: service.sendPasswordReset,
  }),
}));
vi.mock("@/lib/document-archive", () => ({
  archiveDocument: service.archiveDocument,
  getArchivedPdf: service.getArchivedPdf,
  loadArchivePage: service.loadArchivePage,
  validateArchivedSnapshot: (record: ArchiveRecord, schema: z.ZodTypeAny) =>
    schema.parse(record.data),
}));

import { useDocumentHistory } from "../document-history";

const schema = z.object({ name: z.string().min(1) });
const staff: StaffProfile = {
  uid: "approved-staff",
  email: "admin@thecarepal.com",
  displayName: "CarePal Admin",
};
const onLoad = vi.fn();
const onReuse = vi.fn();
let history: ReturnType<typeof useDocumentHistory>;

function Harness() {
  history = useDocumentHistory({ kind: "offers", schema, onLoad, onReuse });
  return (
    <>
      {history.sessionActions}
      <button type="button" onClick={history.openHistory}>
        Previous offers
      </button>
      {history.dialogs}
    </>
  );
}

function record(overrides: Partial<ArchiveRecord> = {}): ArchiveRecord {
  return {
    id: "a".repeat(64),
    kind: "offers",
    schemaVersion: 1,
    data: { name: "Saved employee" },
    filename: "CarePal-saved-offer.pdf",
    subjectName: "Saved employee",
    documentDate: "2026-11-01",
    savedAt: "2026-11-01T10:00:00.000Z",
    createdByUid: staff.uid,
    createdByName: staff.displayName,
    snapshotSha256: "b".repeat(64),
    pdfSha256: "c".repeat(64),
    pdfSizeBytes: 100,
    pdfStoragePath: `document-archives/offers/${"a".repeat(64)}.pdf`,
    ...overrides,
  };
}

const request = () => ({
  blob: new Blob(["%PDF-current"], { type: "application/pdf" }),
  snapshot: { name: "Current employee" },
  filename: "CarePal-current-offer.pdf",
  label: "Current employee",
  documentDate: "2026-11-01",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState = { status: "signed-out", staff: null, error: null };
  service.loadArchivePage.mockResolvedValue({ records: [], nextCursor: null });
  service.archiveDocument.mockResolvedValue(record());
  service.getArchivedPdf.mockResolvedValue(
    new Blob(["%PDF-verified"], { type: "application/pdf" }),
  );
  service.signIn.mockResolvedValue(undefined);
  service.signOut.mockResolvedValue(undefined);
  service.sendPasswordReset.mockResolvedValue(undefined);
  vi.stubGlobal("React", React);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    // Native PDF rendering is outside this DOM test. The returned URL is inert,
    // while the mock still proves that only verified blobs reach the preview.
    value: vi.fn(() => "about:blank"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shared document history", () => {
  it("requires sign-in before saving and does not claim or download an archive", async () => {
    render(<Harness />);
    let result: Awaited<ReturnType<typeof history.archiveDownload>> | undefined;
    await act(async () => {
      result = await history.archiveDownload(request());
    });
    expect(result).toEqual({ status: "sign-in-required" });
    expect(
      screen.getByRole("dialog", { name: "CarePal Admin sign in" }),
    ).toBeTruthy();
    expect(service.archiveDocument).not.toHaveBeenCalled();
    expect(service.getArchivedPdf).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("returns the verified stored PDF only after saving the exact requested snapshot and bytes", async () => {
    authState = { status: "authorized", staff, error: null };
    const saved = record();
    const verified = new Blob(["%PDF-server-verified"], {
      type: "application/pdf",
    });
    service.archiveDocument.mockResolvedValue(saved);
    service.getArchivedPdf.mockResolvedValue(verified);
    render(<Harness />);
    const input = request();
    let result: Awaited<ReturnType<typeof history.archiveDownload>> | undefined;
    await act(async () => {
      result = await history.archiveDownload(input);
    });
    expect(service.archiveDocument).toHaveBeenCalledWith({
      kind: "offers",
      data: input.snapshot,
      pdf: input.blob,
      filename: input.filename,
      subjectName: input.label,
      documentDate: input.documentDate,
      schema,
    });
    expect(service.getArchivedPdf).toHaveBeenCalledWith(saved);
    expect(result).toEqual({ status: "saved", blob: verified, record: saved });
    expect(history.archiveBusy).toBe(false);
  });

  it("propagates an archive failure and releases the save lock for a real retry", async () => {
    authState = { status: "authorized", staff, error: null };
    service.archiveDocument.mockRejectedValueOnce(
      new Error("Storage upload failed"),
    );
    render(<Harness />);
    await act(async () => {
      await expect(history.archiveDownload(request())).rejects.toThrow(
        "Storage upload failed",
      );
    });
    expect(service.getArchivedPdf).not.toHaveBeenCalled();
    expect(history.archiveBusy).toBe(false);
    await act(async () => {
      expect((await history.archiveDownload(request())).status).toBe("saved");
    });
    expect(service.archiveDocument).toHaveBeenCalledTimes(2);
  });

  it("does not return a downloadable result after the saving staff session changes", async () => {
    authState = { status: "authorized", staff, error: null };
    const pendingPdf = deferred<Blob>();
    service.getArchivedPdf.mockReturnValue(pendingPdf.promise);
    const view = render(<Harness />);
    let saving!: ReturnType<typeof history.archiveDownload>;
    act(() => {
      saving = history.archiveDownload(request());
    });
    await waitFor(() =>
      expect(service.getArchivedPdf).toHaveBeenCalledTimes(1),
    );
    authState = { status: "signed-out", staff: null, error: null };
    view.rerender(<Harness />);
    await act(async () => {
      pendingPdf.resolve(new Blob(["%PDF-verified-after-sign-out"]));
      await expect(saving).rejects.toThrow("sign-in session changed");
    });
    expect(history.archiveBusy).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows a history access error instead of presenting a denied query as empty history", async () => {
    authState = { status: "authorized", staff, error: null };
    service.loadArchivePage.mockRejectedValue(
      Object.assign(new Error("Missing permissions"), {
        code: "permission-denied",
      }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Previous offers" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "does not have access",
      ),
    );
    expect(screen.queryByText("No saved offers yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("discards a pending archived PDF when staff sign out and prevents loading its snapshot", async () => {
    authState = { status: "authorized", staff, error: null };
    service.loadArchivePage.mockResolvedValue({
      records: [record()],
      nextCursor: null,
    });
    const pendingPdf = deferred<Blob>();
    service.getArchivedPdf.mockReturnValue(pendingPdf.promise);
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Previous offers" }));
    fireEvent.click(await screen.findByRole("button", { name: "View PDF" }));
    await waitFor(() =>
      expect(service.getArchivedPdf).toHaveBeenCalledTimes(1),
    );
    authState = { status: "signed-out", staff: null, error: null };
    view.rerender(<Harness />);
    await act(async () => {
      pendingPdf.resolve(new Blob(["%PDF-stale"]));
      await pendingPdf.promise;
    });
    expect(
      screen.getByRole("dialog", { name: "CarePal Admin sign in" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Load saved details" }),
    ).toBeNull();
    expect(screen.queryByTitle(/Archived offer:/)).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();
    expect(onReuse).not.toHaveBeenCalled();
  });

  it("paginates server history and validates saved details before a confirmed draft replacement", async () => {
    authState = { status: "authorized", staff, error: null };
    const first = record();
    const second = record({
      id: "d".repeat(64),
      subjectName: "Second employee",
      data: { name: "Second employee" },
    });
    const cursor = { seconds: 100, nanoseconds: 0, id: first.id };
    service.loadArchivePage
      .mockResolvedValueOnce({ records: [first], nextCursor: cursor })
      .mockResolvedValueOnce({ records: [second], nextCursor: null });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Previous offers" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more offers" }),
    );
    await waitFor(() =>
      expect(service.loadArchivePage).toHaveBeenLastCalledWith(
        "offers",
        cursor,
      ),
    );
    await screen.findByText("Second employee");
    fireEvent.click(screen.getAllByRole("button", { name: "View PDF" })[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Load saved details" }),
    );
    expect(onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load offer" }));
    expect(onLoad).toHaveBeenCalledWith(first.data);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("presents safe feedback and clears the password when a failed sign-in is closed", async () => {
    service.signIn.mockRejectedValue(
      Object.assign(new Error("Firebase: Error (auth/invalid-credential)."), {
        code: "auth/invalid-credential",
      }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Admin sign in" }));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "admin@thecarepal.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Sign in" }).closest("form")!,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "email or password is incorrect",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Admin sign in" }));
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    expect(service.archiveDocument).not.toHaveBeenCalled();
  });

  it("rejects a corrupt snapshot even when its archived PDF can be previewed", async () => {
    authState = { status: "authorized", staff, error: null };
    service.loadArchivePage.mockResolvedValue({
      records: [record({ data: { name: 123 } })],
      nextCursor: null,
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Previous offers" }));
    fireEvent.click(await screen.findByRole("button", { name: "View PDF" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Load saved details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load offer" }));
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("not compatible");
  });
});
