// @vitest-environment happy-dom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfferDefaults, type OfferData } from "@/lib/offer";
import { DRAFT_KEY } from "@/lib/offer-storage";

const mocked = vi.hoisted(() => ({
  pdf: vi.fn(),
  archiveDownload: vi.fn(),
  openHistory: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
let historyState = { busy: false, archiveBusy: false };
let historyOptions: {
  onLoad: (snapshot: unknown) => void;
  onReuse: (snapshot: unknown) => void;
};

vi.mock("@react-pdf/renderer", () => ({ pdf: mocked.pdf }));
vi.mock("../offer-document", () => ({ OfferDocument: () => null }));
vi.mock("../offer-form", () => ({
  OfferForm: ({
    data,
    onChange,
  }: {
    data: OfferData;
    onChange: (data: OfferData) => void;
  }) => (
    <label>
      Employee name
      <input
        id="employeeName"
        aria-label="Employee name"
        value={data.employeeName}
        onChange={(event) =>
          onChange({ ...data, employeeName: event.target.value })
        }
      />
    </label>
  ),
}));
vi.mock("../pdf-preview", () => ({
  default: ({ pending }: { pending: boolean }) => (
    <div data-testid="pdf-preview" data-pending={String(pending)} />
  ),
}));
vi.mock("../document-history", () => ({
  useDocumentHistory: (options: typeof historyOptions) => {
    historyOptions = options;
    return {
      ...historyState,
      archiveDownload: mocked.archiveDownload,
      openHistory: mocked.openHistory,
      sessionActions: null,
      dialogs: null,
    };
  },
}));
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: mocked.success, error: mocked.error },
}));

import OfferCreator from "../offer-creator";

let draft: OfferData;
let generatedBlob: Blob;
let verifiedBlob: Blob;
let downloadClick: ReturnType<typeof vi.spyOn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function finishRender() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(550);
  });
}
const saveButton = () =>
  screen.getAllByRole("button", {
    name: "Save & download PDF",
  })[0] as HTMLButtonElement;
async function clickSave() {
  await act(async () => {
    fireEvent.click(saveButton());
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  historyState = { busy: false, archiveBusy: false };
  draft = {
    ...createOfferDefaults(),
    employeeName: "Priya Sharma",
    offerDate: "2026-11-01",
    joiningDate: "2026-11-09",
  };
  localStorage.clear();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  generatedBlob = new Blob(["%PDF-rendered-offer"], {
    type: "application/pdf",
  });
  verifiedBlob = new Blob(["%PDF-verified-stored-offer"], {
    type: "application/pdf",
  });
  mocked.pdf.mockImplementation(() => ({
    toBlob: () => Promise.resolve(generatedBlob),
  }));
  mocked.archiveDownload.mockResolvedValue({
    status: "saved",
    blob: verifiedBlob,
    record: { id: "stored" },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:test-pdf"),
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
  downloadClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("offer creator shared archive integration", () => {
  it("archives the current rendered bytes with an independent matching snapshot and downloads the verified stored PDF", async () => {
    render(<OfferCreator />);
    await finishRender();
    expect(saveButton().disabled).toBe(false);
    await clickSave();
    const input = mocked.archiveDownload.mock.calls[0][0];
    expect(input).toMatchObject({
      blob: generatedBlob,
      snapshot: draft,
      label: draft.employeeName,
      subtitle: draft.role,
      documentDate: draft.offerDate,
    });
    expect(input.snapshot).not.toBe(draft);
    expect(mocked.pdf.mock.calls[0][0].props.data).toEqual(input.snapshot);
    expect(URL.createObjectURL).toHaveBeenLastCalledWith(verifiedBlob);
    expect(downloadClick).toHaveBeenCalledTimes(1);
    expect(mocked.success).toHaveBeenCalledWith(
      "Offer saved to shared history and PDF downloaded.",
    );
  });

  it("retains the exact untrimmed form snapshot used by the PDF renderer", async () => {
    draft = { ...draft, employeeName: "  Priya Sharma  " };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    render(<OfferCreator />);
    await finishRender();
    await clickSave();
    const input = mocked.archiveDownload.mock.calls[0][0];
    expect(input.snapshot.employeeName).toBe("  Priya Sharma  ");
    expect(mocked.pdf.mock.calls[0][0].props.data).toEqual(input.snapshot);
    expect(downloadClick).toHaveBeenCalledTimes(1);
  });

  it("rejects an unfinished draft before invoking shared storage or a download", async () => {
    draft = { ...draft, employeeName: "" };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    render(<OfferCreator />);
    await finishRender();
    await clickSave();
    expect(mocked.archiveDownload).not.toHaveBeenCalled();
    expect(downloadClick).not.toHaveBeenCalled();
    expect(mocked.error).toHaveBeenCalledWith(
      "Please complete the highlighted offer details before downloading.",
    );
    expect(mocked.success).not.toHaveBeenCalled();
  });

  it("does not download or claim a save when staff sign-in is required", async () => {
    mocked.archiveDownload.mockResolvedValue({ status: "sign-in-required" });
    render(<OfferCreator />);
    await finishRender();
    await clickSave();
    expect(mocked.archiveDownload).toHaveBeenCalledTimes(1);
    expect(downloadClick).not.toHaveBeenCalled();
    expect(mocked.success).not.toHaveBeenCalled();
  });

  it("reports an archive failure without downloading or claiming success", async () => {
    mocked.archiveDownload.mockRejectedValue(
      new Error("Storage upload failed. Retry safely."),
    );
    render(<OfferCreator />);
    await finishRender();
    await clickSave();
    expect(mocked.error).toHaveBeenCalledWith(
      "Storage upload failed. Retry safely.",
    );
    expect(downloadClick).not.toHaveBeenCalled();
    expect(mocked.success).not.toHaveBeenCalled();
  });

  it("keeps stale PDF bytes unavailable while an employee edit is rendering", async () => {
    render(<OfferCreator />);
    await finishRender();
    const nextPdf = deferred<Blob>();
    const nextBlob = new Blob(["%PDF-new-employee"], {
      type: "application/pdf",
    });
    mocked.pdf.mockImplementationOnce(() => ({
      toBlob: () => nextPdf.promise,
    }));
    fireEvent.change(screen.getByLabelText("Employee name"), {
      target: { value: "New Employee" },
    });
    expect(
      screen
        .getAllByRole("button", { name: "Generating PDF…" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    await finishRender();
    expect(mocked.archiveDownload).not.toHaveBeenCalled();
    await act(async () => {
      nextPdf.resolve(nextBlob);
      await nextPdf.promise;
    });
    await clickSave();
    expect(mocked.archiveDownload.mock.calls[0][0]).toMatchObject({
      blob: nextBlob,
      snapshot: { employeeName: "New Employee" },
      label: "New Employee",
    });
    expect(mocked.pdf.mock.calls[1][0].props.data.employeeName).toBe(
      "New Employee",
    );
  });

  it("locks editing and new-document actions while shared storage is saving", async () => {
    historyState = { busy: true, archiveBusy: true };
    render(<OfferCreator />);
    await finishRender();
    expect(
      (
        screen
          .getByLabelText("Employee name")
          .closest("fieldset") as HTMLFieldSetElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "New offer" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Previous offers",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen
        .getAllByRole("button", { name: "Saving PDF…" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(mocked.archiveDownload).not.toHaveBeenCalled();
  });

  it("loads saved fields but clears personal details when archived terms are reused", async () => {
    render(<OfferCreator />);
    await finishRender();
    const archived = {
      ...draft,
      employeeName: "Archived Employee",
      basic: 7000,
    };
    act(() => historyOptions.onLoad(archived));
    expect(
      (screen.getByLabelText("Employee name") as HTMLInputElement).value,
    ).toBe("Archived Employee");
    act(() => historyOptions.onReuse(archived));
    expect(
      (screen.getByLabelText("Employee name") as HTMLInputElement).value,
    ).toBe("");
    await finishRender();
    expect(mocked.pdf.mock.calls.at(-1)?.[0].props.data.basic).toBe(7000);
    expect(mocked.archiveDownload).not.toHaveBeenCalled();
  });
});
