import { describe, expect, it } from "vitest";
import {
  calculateCompensation,
  createOfferDefaults,
  formatDate,
  offerDraftSchema,
  offerSchema,
  type OfferData,
} from "../offer";

function completeOffer(overrides: Partial<OfferData> = {}): OfferData {
  return {
    ...createOfferDefaults(),
    employeeName: "Priya Sharma",
    offerDate: "2026-10-31",
    joiningDate: "2026-11-09",
    ...overrides,
  };
}

describe("compensation", () => {
  it("corrects the sample annexure totals from its actual components", () => {
    const totals = calculateCompensation(completeOffer());
    expect(totals).toMatchObject({
      grossMonthly: 3000,
      grossAnnual: 36000,
      baseCtcMonthly: 3000,
      baseCtcAnnual: 36000,
      deductionsMonthly: 23,
      deductionsAnnual: 276,
      netMonthly: 2977,
      netAnnual: 35724,
      retentionAnnual: 3000,
      fixedAnnual: 39000,
      variableAnnual: 48000,
      totalAnnual: 87000,
      totalMonthlyEquivalent: 7250,
    });
  });

  it("keeps company contributions, employee deductions and variable pay separate", () => {
    const totals = calculateCompensation(completeOffer({
      basic: 50000,
      hra: 20000,
      statutoryBonus: 1000,
      specialAllowance: 2500,
      lta: 1500,
      employerPf: 1800,
      employerEsic: 500,
      employeePf: 1800,
      employeeEsic: 500,
      professionalTax: 200,
      retentionBonus: 60000,
      weeklyIncentive: 2500,
      incentiveWeeks: 50,
    }));
    expect(totals).toMatchObject({
      grossMonthly: 75000,
      employerContributionsMonthly: 2300,
      baseCtcMonthly: 77300,
      baseCtcAnnual: 927600,
      deductionsMonthly: 2500,
      netMonthly: 72500,
      netAnnual: 870000,
      fixedAnnual: 987600,
      variableAnnual: 125000,
      totalAnnual: 1112600,
      totalMonthlyEquivalent: 92716.67,
    });
  });

  it("does not invent incentive pay when no incentive weeks are eligible", () => {
    expect(calculateCompensation(completeOffer({ incentiveWeeks: 0 })).variableAnnual).toBe(0);
  });

  it("rounds fractional component sums to currency precision", () => {
    const totals = calculateCompensation(completeOffer({
      basic: 0.1, hra: 0.2, statutoryBonus: 0, specialAllowance: 0, lta: 0,
      employeePf: 0, employeeEsic: 0, professionalTax: 0,
      retentionBonus: 0, weeklyIncentive: 0,
    }));
    expect(totals.grossMonthly).toBe(0.3);
    expect(totals.grossAnnual).toBe(3.6);
  });
});

describe("offer validation", () => {
  it("allows an unfinished local draft without allowing it to be downloaded", () => {
    const data = completeOffer({ employeeName: "", role: "", offerDate: "", joiningDate: "" });
    expect(offerDraftSchema.safeParse(data).success).toBe(true);
    expect(offerSchema.safeParse(data).success).toBe(false);
  });

  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-2-01", "nonsense"])(
    "rejects the invalid calendar date %s in drafts and exports", (offerDate) => {
      const data = completeOffer({ offerDate });
      expect(offerDraftSchema.safeParse(data).success).toBe(false);
      expect(offerSchema.safeParse(data).success).toBe(false);
    },
  );

  it("accepts an actual leap day", () => {
    expect(offerSchema.safeParse(completeOffer({ offerDate: "2028-02-29", joiningDate: "2028-02-29" })).success).toBe(true);
    expect(formatDate("2028-02-29")).toBe("29 February 2028");
  });

  it.each([-1, NaN, Infinity])("rejects invalid money %s", (basic) => {
    expect(offerDraftSchema.safeParse(completeOffer({ basic })).success).toBe(false);
  });

  it.each(["basic", "retentionBonus"] as const)(
    "keeps extra precision in %s while editing but blocks PDF export",
    (field) => {
      const data = completeOffer({ [field]: 12.345 });
      expect(offerDraftSchema.safeParse(data).success).toBe(true);
      const exported = offerSchema.safeParse(data);
      expect(exported.success).toBe(false);
      if (!exported.success) {
        expect(exported.error.issues.some((issue) => issue.path[0] === field && /decimal places/.test(issue.message))).toBe(true);
      }
    },
  );

  it.each([12.34, 0.29])("accepts valid two-decimal money %s", (amount) => {
    expect(offerSchema.safeParse(completeOffer({ basic: amount, retentionBonus: amount })).success).toBe(true);
  });

  it("rejects deductions greater than the monthly gross salary", () => {
    const result = offerSchema.safeParse(completeOffer({ employeePf: 4000 }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => /deductions/.test(issue.message))).toBe(true);
  });

  it("validates chronological offer, acceptance and joining dates", () => {
    expect(offerSchema.safeParse(completeOffer({ joiningDate: "2026-10-30" })).success).toBe(false);
    expect(offerSchema.safeParse(completeOffer({ acceptanceDeadline: "2026-10-30" })).success).toBe(false);
    expect(offerSchema.safeParse(completeOffer({ acceptanceDeadline: "2026-11-10" })).success).toBe(false);
    expect(offerSchema.safeParse(completeOffer({ acceptanceDeadline: "2026-11-05" })).success).toBe(true);
  });

  it("requires training days only when the training program is enabled", () => {
    const data = completeOffer({ phase1Days: 0, phase2Days: 0, phase3Days: 0 });
    expect(offerSchema.safeParse(data).success).toBe(false);
    expect(offerSchema.safeParse({ ...data, trainingEnabled: false }).success).toBe(true);
  });

  it("rejects an incomplete or wrongly typed persisted record", () => {
    expect(offerDraftSchema.safeParse({ employeeName: "Priya Sharma" }).success).toBe(false);
    expect(offerDraftSchema.safeParse({ ...completeOffer(), basic: "3000" }).success).toBe(false);
  });
});
