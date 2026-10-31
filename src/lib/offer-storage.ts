import { offerDraftSchema, type OfferData } from "./offer";
import { z } from "zod";

export const DRAFT_KEY = "carepal-offer:draft:v1";
export const HISTORY_KEY = "carepal-offer:history:v1";

const recordSchema = z.object({
  id: z.string(),
  savedAt: z.string(),
  data: offerDraftSchema,
});

export type OfferRecord = { id: string; savedAt: string; data: OfferData };

export function readDraft(): OfferData | null {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  return offerDraftSchema.parse(JSON.parse(raw));
}

export function readHistory(): OfferRecord[] {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  return z.array(recordSchema).max(50).parse(JSON.parse(raw)) as OfferRecord[];
}

/** Only completed downloads are recorded; a repeated identical offer replaces its entry. */
export function recordDownload(data: OfferData): OfferRecord[] {
  const history = readHistory();
  const serialized = JSON.stringify(data);
  const same = history.find(
    (record) => JSON.stringify(record.data) === serialized,
  );
  const record: OfferRecord = {
    id: same?.id ?? crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    data: { ...data },
  };
  const next = [
    record,
    ...history.filter((item) => item.id !== record.id),
  ].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function offerFilename(data: OfferData): string {
  const name =
    data.employeeName
      .trim()
      .replace(/[^\p{L}\p{M}\p{N} -]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "Employee";
  return `CarePal-Offer-Letter-${name}-${data.offerDate || "draft"}.pdf`;
}
