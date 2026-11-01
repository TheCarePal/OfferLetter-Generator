import { createOfferDefaults, offerSchema, type OfferData } from "./offer";

/** Reusing terms creates a fresh employee draft without altering the saved PDF. */
export function createOfferDraftFromArchive(snapshot: unknown): OfferData {
  const saved = offerSchema.parse(snapshot);
  const defaults = createOfferDefaults();
  return {
    ...saved,
    employeeName: "",
    employeeEmail: "",
    employeeAddress: "",
    salutation: "",
    offerDate: defaults.offerDate,
    joiningDate: defaults.joiningDate,
    acceptanceDeadline: "",
  };
}
