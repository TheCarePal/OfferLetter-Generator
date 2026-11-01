import { describe, expect, it } from "vitest";
import { createOfferDefaults, offerSchema } from "../offer";
import { createOfferDraftFromArchive } from "../archive-draft";

describe("reusing archived offer terms", () => {
  it("clears employee identity and old dates while preserving compensation and terms", () => {
    const saved = {
      ...createOfferDefaults(),
      employeeName: "Sample Person",
      employeeEmail: "person@example.com",
      employeeAddress: "Sample address",
      salutation: "Ms." as const,
      offerDate: "2026-01-01",
      joiningDate: "2026-01-10",
      acceptanceDeadline: "2026-01-05",
      basic: 50000,
    };
    expect(offerSchema.safeParse(saved).success).toBe(true);
    const fresh = createOfferDraftFromArchive(saved);
    expect(fresh).toMatchObject({
      employeeName: "",
      employeeEmail: "",
      employeeAddress: "",
      salutation: "",
      acceptanceDeadline: "",
      basic: 50000,
      role: saved.role,
    });
    expect(fresh.offerDate).toBe(createOfferDefaults().offerDate);
    expect(fresh.joiningDate).toBe(createOfferDefaults().joiningDate);
    expect(saved.employeeName).toBe("Sample Person");
  });
  it("rejects incomplete archived data", () => {
    expect(() =>
      createOfferDraftFromArchive({ employeeName: "Sample Person" }),
    ).toThrow();
  });
});
