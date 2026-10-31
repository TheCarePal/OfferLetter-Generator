import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfferDefaults } from "../offer";
import {
  DRAFT_KEY,
  HISTORY_KEY,
  offerFilename,
  readDraft,
  readHistory,
  recordDownload,
} from "../offer-storage";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  let sequence = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `offer-${++sequence}` });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local drafts and history", () => {
  it("returns empty state when no data has been saved", () => {
    expect(readDraft()).toBeNull();
    expect(readHistory()).toEqual([]);
  });

  it("restores an unfinished draft exactly", () => {
    const draft = { ...createOfferDefaults(), employeeName: "", joiningDate: "", basic: 8200.5 };
    store.set(DRAFT_KEY, JSON.stringify(draft));
    expect(readDraft()).toEqual(draft);
  });

  it("reports malformed JSON and invalid schemas instead of silently accepting them", () => {
    store.set(DRAFT_KEY, "{broken");
    expect(() => readDraft()).toThrow();
    store.set(DRAFT_KEY, JSON.stringify({ employeeName: "Missing fields" }));
    expect(() => readDraft()).toThrow();
    store.set(HISTORY_KEY, JSON.stringify([{ id: "old", savedAt: "2026-10-31", data: {} }]));
    expect(() => readHistory()).toThrow();
  });

  it("records the precise downloaded data as an independent snapshot", () => {
    const data = { ...createOfferDefaults(), employeeName: "Priya Sharma", basic: 12345.67 };
    const expected = { ...data };
    const records = recordDownload(data);
    data.basic = 999;
    data.employeeName = "Another employee";
    expect(records[0].data).toEqual(expected);
    expect(readHistory()[0].data).toEqual(expected);
  });

  it("deduplicates an identical offer and moves it to the top using its original ID", () => {
    const first = { ...createOfferDefaults(), employeeName: "Priya Sharma" };
    const firstId = recordDownload(first)[0].id;
    recordDownload({ ...first, employeeName: "Arjun Verma" });
    const records = recordDownload({ ...first });
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe(firstId);
    expect(records[0].data.employeeName).toBe("Priya Sharma");
  });

  it("preserves different compensation offers for the same employee", () => {
    const first = { ...createOfferDefaults(), employeeName: "Priya Sharma" };
    recordDownload(first);
    const records = recordDownload({ ...first, basic: 50000 });
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.data.basic)).toEqual([50000, first.basic]);
    expect(records[0].id).not.toBe(records[1].id);
  });

  it("retains only the latest 50 unique offers", () => {
    const data = createOfferDefaults();
    for (let i = 0; i < 52; i++) recordDownload({ ...data, employeeName: `Employee ${i}` });
    const records = readHistory();
    expect(records).toHaveLength(50);
    expect(records[0].data.employeeName).toBe("Employee 51");
    expect(records[49].data.employeeName).toBe("Employee 2");
    expect(records.some((record) => record.data.employeeName === "Employee 0")).toBe(false);
  });

  it("lets the caller handle unavailable or full browser storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new DOMException("Storage full", "QuotaExceededError"); },
    });
    expect(() => recordDownload(createOfferDefaults())).toThrow("Storage full");
  });
});

describe("download filenames", () => {
  it("includes the employee and date while removing unsafe filename characters", () => {
    const data = { ...createOfferDefaults(), employeeName: "  Priya / Sharma:*?  ", offerDate: "2026-10-31" };
    expect(offerFilename(data)).toBe("CarePal-Offer-Letter-Priya-Sharma-2026-10-31.pdf");
  });

  it("preserves names written in Indian scripts", () => {
    expect(offerFilename({ ...createOfferDefaults(), employeeName: "अनु", offerDate: "2026-10-31" }))
      .toBe("CarePal-Offer-Letter-अनु-2026-10-31.pdf");
  });

  it("falls back safely for an unnamed draft", () => {
    expect(offerFilename({ ...createOfferDefaults(), employeeName: "", offerDate: "" }))
      .toBe("CarePal-Offer-Letter-Employee-draft.pdf");
  });
});
