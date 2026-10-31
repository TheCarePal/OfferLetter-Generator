"use client";

import { ChevronDown, LockKeyhole, Info } from "lucide-react";
import { calculateCompensation, type OfferData } from "@/lib/offer";
import type { ReactNode } from "react";

export type FormErrors = Partial<Record<keyof OfferData, string>>;
type Props = {
  data: OfferData;
  onChange: (data: OfferData) => void;
  errors: FormErrors;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="form-section" open>
      <summary>
        {title}
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="section-fields">{children}</div>
    </details>
  );
}

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

export function OfferForm({ data, onChange, errors }: Props) {
  const set = <K extends keyof OfferData>(name: K, value: OfferData[K]) =>
    onChange({ ...data, [name]: value });
  const field = (
    name: keyof OfferData,
    label: string,
    options: {
      type?: string;
      placeholder?: string;
      help?: string;
      min?: number;
      max?: number;
      required?: boolean;
      wide?: boolean;
    } = {},
  ) => (
    <div className={`field ${options.wide ? "span-two" : ""}`} key={name}>
      <label htmlFor={name}>
        {label}
        {options.required && <span className="required"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={options.type ?? "text"}
        value={String(data[name])}
        placeholder={options.placeholder}
        min={options.min ?? (options.type === "number" ? 0 : undefined)}
        max={options.max}
        step={
          options.type === "number"
            ? [
                "phase1Days",
                "phase2Days",
                "phase3Days",
                "probationMonths",
                "noticeDays",
                "absenceDays",
                "retentionMonths",
                "incentiveWeeks",
              ].includes(name)
              ? 1
              : "0.01"
            : undefined
        }
        onChange={(event) =>
          set(
            name,
            (options.type === "number"
              ? event.target.value === ""
                ? 0
                : Number(event.target.value)
              : event.target.value) as never,
          )
        }
        aria-required={options.required || undefined}
        aria-invalid={!!errors[name]}
        aria-describedby={
          errors[name]
            ? `${name}-error`
            : options.help
              ? `${name}-help`
              : undefined
        }
      />
      {options.help && (
        <p className="field-help" id={`${name}-help`}>
          {options.help}
        </p>
      )}
      {errors[name] && (
        <p className="field-error" id={`${name}-error`}>
          {errors[name]}
        </p>
      )}
    </div>
  );
  const select = (
    name: keyof OfferData,
    label: string,
    values: string[],
    labels?: string[],
  ) => (
    <div className="field" key={name}>
      <label htmlFor={name}>{label}</label>
      <select
        id={name}
        value={String(data[name])}
        onChange={(event) => set(name, event.target.value as never)}
      >
        {values.map((value, index) => (
          <option value={value} key={value}>
            {labels?.[index] ?? value}
          </option>
        ))}
      </select>
    </div>
  );
  const textarea = (name: keyof OfferData, label: string, help?: string) => (
    <div className="field span-two" key={name}>
      <label htmlFor={name}>{label}</label>
      <textarea
        id={name}
        value={String(data[name])}
        rows={3}
        onChange={(event) => set(name, event.target.value as never)}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
      />
      {help && <p className="field-help">{help}</p>}
      {errors[name] && (
        <p className="field-error" id={`${name}-error`}>
          {errors[name]}
        </p>
      )}
    </div>
  );
  const compensation = calculateCompensation(data);
  return (
    <form
      className="offer-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <Section title="General information">
        <div className="fields-grid">
          {field("offerDate", "Offer date", { type: "date", required: true })}
          {field("joiningDate", "Date of joining", {
            type: "date",
            required: true,
          })}
          {field("acceptanceDeadline", "Accept by", {
            type: "date",
            help: "Optional deadline for accepting the offer.",
            wide: true,
          })}
        </div>
      </Section>
      <Section title="Company information">
        <div className="company-card">
          <LockKeyhole size={16} aria-hidden="true" />
          <div>
            <strong>The CarePal</strong>
            <p>Carepalz Internet Private Limited</p>
            <span>Company identity is fixed for every offer.</span>
          </div>
        </div>
      </Section>
      <Section title="Employee information">
        <div className="fields-grid">
          {select(
            "salutation",
            "Salutation",
            ["", "Mr.", "Ms.", "Mx."],
            ["None", "Mr.", "Ms.", "Mx."],
          )}
          {field("employeeName", "Full name", {
            placeholder: "Enter employee's full name",
            required: true,
          })}
          {field("employeeEmail", "Email address", {
            type: "email",
            placeholder: "employee@example.com",
            wide: true,
          })}
          {textarea(
            "employeeAddress",
            "Address",
            "Optional. Appears below the employee's name.",
          )}
        </div>
      </Section>
      <Section title="Role & employment">
        <div className="fields-grid">
          {field("role", "Designation / role", {
            required: true,
            wide: true,
            placeholder: "e.g. Android Developer – Intern",
          })}
          {select("employmentType", "Employment type", [
            "Full-time",
            "Part-time",
            "Internship",
            "Contract",
          ])}
          {select("workMode", "Work mode", ["Remote", "On-site", "Hybrid"])}
          {field("reportingTo", "Reporting to", { required: true, wide: true })}
          {field("location", "Employment location", {
            required: true,
            wide: true,
          })}
          {field("projectTarget", "Project / performance target", {
            wide: true,
            help: "Describe the target and frequency, e.g. 2 projects per week.",
          })}
        </div>
      </Section>
      <Section title="Compensation & benefits">
        <p className="section-help">
          Enter monthly amounts in INR. The letter and annexure use the same
          calculated totals.
        </p>
        <div className="fields-grid">
          {field("basic", "Basic salary (₹)", { type: "number" })}
          {field("hra", "HRA (₹)", { type: "number" })}
          {field("statutoryBonus", "Statutory bonus (₹)", { type: "number" })}
          {field("specialAllowance", "Special allowance (₹)", {
            type: "number",
          })}
          {field("lta", "LTA (₹)", { type: "number", wide: true })}
        </div>
        <div className="calculated-line">
          <span>Monthly gross salary</span>
          <strong>{money(compensation.grossMonthly)}</strong>
        </div>
        <h3 className="form-subheading">Employer contributions · monthly</h3>
        <div className="fields-grid">
          {field("employerPf", "Employer PF (₹)", { type: "number" })}
          {field("employerEsic", "Employer ESIC (₹)", { type: "number" })}
        </div>
        <h3 className="form-subheading">Employee deductions · monthly</h3>
        <div className="fields-grid">
          {field("employeePf", "Employee PF (₹)", { type: "number" })}
          {field("employeeEsic", "Employee ESIC (₹)", { type: "number" })}
          {field("professionalTax", "Professional tax (₹)", {
            type: "number",
            wide: true,
          })}
        </div>
        <div className="calculated-line">
          <span>Monthly net pay before tax</span>
          <strong>{money(compensation.netMonthly)}</strong>
        </div>
        <h3 className="form-subheading">Retention bonus</h3>
        <div className="fields-grid">
          {field("retentionBonus", "Annual retention bonus (₹)", {
            type: "number",
          })}
          {field("retentionMonths", "Payable after (months)", {
            type: "number",
            min: 1,
            max: 120,
          })}
        </div>
        <h3 className="form-subheading">Variable project incentives</h3>
        <div className="fields-grid">
          {field("weeklyIncentive", "Maximum per week (₹)", { type: "number" })}
          {field("incentiveWeeks", "Eligible weeks per year", {
            type: "number",
            max: 52,
          })}
        </div>
        <div className="salary-summary">
          <div>
            <span>Annual fixed CTC</span>
            <strong>{money(compensation.fixedAnnual)}</strong>
          </div>
          <div>
            <span>Annual variable incentive, up to</span>
            <strong>{money(compensation.variableAnnual)}</strong>
          </div>
          <div className="salary-total">
            <span>Annual total CTC, up to</span>
            <strong>{money(compensation.totalAnnual)}</strong>
          </div>
        </div>
        <p className="field-help info-line">
          <Info size={14} aria-hidden="true" />
          Fixed CTC includes employer contributions and the retention bonus.
          Variable incentives depend on performance.
        </p>
      </Section>
      <Section title="Training & employment terms">
        <label className="toggle-row">
          <span>
            <strong>Include training program</strong>
            <small>Use the three phases from the sample letter.</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={data.trainingEnabled}
            onChange={(event) => set("trainingEnabled", event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
        <div className="fields-grid">
          {data.trainingEnabled && (
            <>
              {textarea("trainingDescription", "Training description")}
              {field("phase1Days", "Phase 1 · CRT (days)", {
                type: "number",
                max: 365,
              })}
              {field("phase2Days", "Phase 2 · OJT-1 (days)", {
                type: "number",
                max: 365,
              })}
              {field("phase3Days", "Phase 3 · OJT-2 (days)", {
                type: "number",
                max: 365,
              })}
              <div className="training-total">
                Total training:{" "}
                <strong>
                  {data.phase1Days + data.phase2Days + data.phase3Days} days
                </strong>
              </div>
            </>
          )}
          {field("probationMonths", "Probation (months)", {
            type: "number",
            max: 36,
          })}
          {field("noticeDays", "Notice period (days)", {
            type: "number",
            max: 365,
          })}
          {field("absenceDays", "Unapproved absence (days)", {
            type: "number",
            min: 1,
            max: 365,
            wide: true,
          })}
          {textarea("laptopPolicy", "Laptop policy")}
        </div>
      </Section>
      <Section title="Authorized signatory">
        <div className="fields-grid">
          {field("signerName", "Signatory name", {
            required: true,
            wide: true,
          })}
          {field("signerTitle", "Title", { required: true, wide: true })}
        </div>
        <p className="field-help">
          The letter includes blank lines for the company and employee to sign.
        </p>
      </Section>
    </form>
  );
}
