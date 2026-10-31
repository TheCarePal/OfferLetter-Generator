import { z } from "zod";

export const COMPANY = {
  name: "TheCarePal",
  legalName: "Carepalz Internet Private Limited",
} as const;

const amount = z
  .number()
  .finite()
  .min(0, "Use a positive amount or zero.")
  .max(1_000_000_000);
const wholeDays = z
  .number()
  .int("Use a whole number of days.")
  .min(0)
  .max(3650);
const dateIsValid = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(value.slice(0, 4)) &&
    date.getMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getDate() === Number(value.slice(8, 10))
  );
};
const draftDate = z
  .string()
  .refine((value) => value === "" || dateIsValid(value), "Enter a valid date.");
const requiredDate = z.string().refine(dateIsValid, "Choose a valid date.");

/** Complete local drafts may contain empty required fields while they are edited. */
export const offerDraftSchema = z.object({
  employeeName: z.string().max(160),
  salutation: z.enum(["Mr.", "Ms.", "Mx.", ""]),
  employeeAddress: z.string().max(1000),
  employeeEmail: z.string().max(254),
  role: z.string().max(180),
  employmentType: z.enum(["Full-time", "Part-time", "Internship", "Contract"]),
  offerDate: draftDate,
  joiningDate: draftDate,
  acceptanceDeadline: draftDate,
  reportingTo: z.string().max(180),
  location: z.string().max(300),
  workMode: z.enum(["Remote", "On-site", "Hybrid"]),
  trainingEnabled: z.boolean(),
  phase1Days: wholeDays,
  phase2Days: wholeDays,
  phase3Days: wholeDays,
  trainingDescription: z.string().max(2500),
  probationMonths: z.number().int().min(0).max(36),
  noticeDays: wholeDays,
  projectTarget: z.string().max(500),
  absenceDays: z.number().int().min(1).max(365),
  laptopPolicy: z.string().max(2500),
  signerName: z.string().max(160),
  signerTitle: z.string().max(160),
  basic: amount,
  hra: amount,
  statutoryBonus: amount,
  specialAllowance: amount,
  lta: amount,
  employerPf: amount,
  employerEsic: amount,
  employeePf: amount,
  employeeEsic: amount,
  professionalTax: amount,
  retentionBonus: amount,
  retentionMonths: z.number().int().min(1).max(120),
  weeklyIncentive: amount,
  incentiveWeeks: z.number().int().min(0).max(53),
});

export type OfferData = z.infer<typeof offerDraftSchema>;

/** Export requires a complete offer; saving an unfinished draft does not. */
export const offerSchema = offerDraftSchema
  .extend({
    employeeName: z
      .string()
      .trim()
      .min(1, "Enter the employee's full name.")
      .max(160),
    employeeEmail: z
      .string()
      .trim()
      .email("Enter a valid email address.")
      .or(z.literal("")),
    role: z.string().trim().min(1, "Enter a role or designation.").max(180),
    offerDate: requiredDate,
    joiningDate: requiredDate,
    reportingTo: z
      .string()
      .trim()
      .min(1, "Enter the reporting manager or title.")
      .max(180),
    location: z
      .string()
      .trim()
      .min(1, "Enter the employment location.")
      .max(300),
    signerName: z
      .string()
      .trim()
      .min(1, "Enter the authorized signer's name.")
      .max(160),
    signerTitle: z
      .string()
      .trim()
      .min(1, "Enter the authorized signer's title.")
      .max(160),
    laptopPolicy: z
      .string()
      .trim()
      .min(1, "Enter the laptop policy.")
      .max(2500),
  })
  .superRefine((data, context) => {
    const amountFields = [
      "basic",
      "hra",
      "statutoryBonus",
      "specialAllowance",
      "lta",
      "employerPf",
      "employerEsic",
      "employeePf",
      "employeeEsic",
      "professionalTax",
      "retentionBonus",
      "weeklyIncentive",
    ] as const;
    for (const field of amountFields) {
      if (
        Math.abs(data[field] - Math.round(data[field] * 100) / 100) > 0.00000001
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Use no more than two decimal places.",
        });
      }
    }
    if (
      dateIsValid(data.offerDate) &&
      dateIsValid(data.joiningDate) &&
      data.joiningDate < data.offerDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["joiningDate"],
        message: "Joining date cannot be before the offer date.",
      });
    }
    if (
      data.acceptanceDeadline &&
      dateIsValid(data.offerDate) &&
      data.acceptanceDeadline < data.offerDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptanceDeadline"],
        message: "Acceptance deadline cannot be before the offer date.",
      });
    }
    if (
      data.acceptanceDeadline &&
      dateIsValid(data.joiningDate) &&
      data.acceptanceDeadline > data.joiningDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptanceDeadline"],
        message: "Acceptance deadline cannot be after the joining date.",
      });
    }
    if (
      data.trainingEnabled &&
      data.phase1Days + data.phase2Days + data.phase3Days <= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["phase1Days"],
        message: "Add at least one training day or turn training off.",
      });
    }
    if (calculateCompensation(data).netMonthly < 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["professionalTax"],
        message: "Total employee deductions cannot exceed gross salary.",
      });
    }
  });

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createOfferDefaults(): OfferData {
  const today = localDate(new Date());
  return {
    employeeName: "",
    salutation: "",
    employeeAddress: "",
    employeeEmail: "",
    role: "Android Developer - Intern",
    employmentType: "Internship",
    offerDate: today,
    joiningDate: today,
    acceptanceDeadline: "",
    reportingTo: "Founder & Project Lead",
    location: "Remote",
    workMode: "Remote",
    trainingEnabled: true,
    phase1Days: 7,
    phase2Days: 9,
    phase3Days: 12,
    trainingDescription:
      "The program combines guided learning, practical project work, and feedback from your reporting manager to prepare you for your role.",
    probationMonths: 6,
    noticeDays: 30,
    projectTarget: "2 projects per week",
    absenceDays: 3,
    laptopPolicy:
      "You will be required to bring your own laptop to work. The Company will reimburse eligible laptop costs in accordance with its existing policy.",
    signerName: "Sandeep Mallick",
    signerTitle: "Founder",
    basic: 2200,
    hra: 375,
    statutoryBonus: 25,
    specialAllowance: 200,
    lta: 200,
    employerPf: 0,
    employerEsic: 0,
    employeePf: 0,
    employeeEsic: 0,
    professionalTax: 23,
    retentionBonus: 3000,
    retentionMonths: 6,
    weeklyIncentive: 1000,
    incentiveWeeks: 48,
  };
}

const cents = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateCompensation(data: OfferData) {
  const grossMonthly = cents(
    data.basic +
      data.hra +
      data.statutoryBonus +
      data.specialAllowance +
      data.lta,
  );
  const grossAnnual = cents(grossMonthly * 12);
  const employerContributionsMonthly = cents(
    data.employerPf + data.employerEsic,
  );
  const baseCtcMonthly = cents(grossMonthly + employerContributionsMonthly);
  const baseCtcAnnual = cents(baseCtcMonthly * 12);
  const deductionsMonthly = cents(
    data.employeePf + data.employeeEsic + data.professionalTax,
  );
  const deductionsAnnual = cents(deductionsMonthly * 12);
  const netMonthly = cents(grossMonthly - deductionsMonthly);
  const netAnnual = cents(netMonthly * 12);
  const retentionAnnual = cents(data.retentionBonus);
  const retentionMonthlyEquivalent = cents(retentionAnnual / 12);
  const fixedAnnual = cents(baseCtcAnnual + retentionAnnual);
  const fixedMonthlyEquivalent = cents(fixedAnnual / 12);
  const variableAnnual = cents(data.weeklyIncentive * data.incentiveWeeks);
  const variableMonthlyEquivalent = cents(variableAnnual / 12);
  const totalAnnual = cents(fixedAnnual + variableAnnual);
  const totalMonthlyEquivalent = cents(totalAnnual / 12);
  return {
    grossMonthly,
    grossAnnual,
    employerContributionsMonthly,
    baseCtcMonthly,
    baseCtcAnnual,
    deductionsMonthly,
    deductionsAnnual,
    netMonthly,
    netAnnual,
    retentionAnnual,
    retentionMonthlyEquivalent,
    fixedMonthlyEquivalent,
    fixedAnnual,
    variableMonthlyEquivalent,
    variableAnnual,
    totalMonthlyEquivalent,
    totalAnnual,
  };
}

/** "Rs." is supported by the PDF's built-in Times font, including offline. */
export function formatMoney(value: number): string {
  return `Rs. ${(Number.isFinite(value) ? value : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(iso: string): string {
  if (!dateIsValid(iso)) return "Not specified";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
