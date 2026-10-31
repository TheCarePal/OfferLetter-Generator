import React, { type ReactNode } from "react";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  COMPANY,
  calculateCompensation,
  formatDate,
  formatMoney,
  type OfferData,
} from "@/lib/offer";
import { getPublicAssetPath } from "@/lib/public-path";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Times-Roman",
    fontSize: 10,
    lineHeight: 1.23,
    color: "#111111",
    paddingTop: 58,
    paddingBottom: 58,
    paddingHorizontal: 60,
  },
  title: {
    textAlign: "center",
    fontFamily: "Times-Bold",
    fontSize: 12,
    textDecoration: "underline",
    marginBottom: 22,
  },
  date: { textAlign: "right", marginBottom: 10 },
  recipient: { marginBottom: 10 },
  address: { marginTop: 3, color: "#333333" },
  paragraph: { marginBottom: 9, textAlign: "justify" },
  intro: { marginBottom: 15, textAlign: "justify" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  clause: { marginBottom: 10 },
  clauseHeading: { marginBottom: 2 },
  underlined: { textDecoration: "underline" },
  clauseBody: { paddingLeft: 25 },
  subheading: { fontFamily: "Times-Bold", marginTop: 6, marginBottom: 3 },
  footer: {
    position: "absolute",
    bottom: 25,
    left: 60,
    fontSize: 8,
    color: "#777777",
  },
  stationeryClip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 595.28,
    height: 100,
    overflow: "hidden",
  },
  stationeryImage: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 595.28,
    height: 765.17,
  },
  signatureIntro: { marginBottom: 16 },
  signatureBlock: { marginTop: 12, marginBottom: 18 },
  signatureLine: {
    borderBottomWidth: 0.6,
    borderBottomColor: "#444444",
    width: 190,
    height: 42,
    marginBottom: 6,
  },
  label: { fontSize: 8.5, color: "#666666", marginBottom: 9 },
  acceptance: {
    marginTop: 26,
    paddingTop: 15,
    borderTopWidth: 0.5,
    borderTopColor: "#b8b8b8",
  },
  acceptanceFields: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  acceptanceColumn: { width: "46%" },
  acceptanceLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#444444",
    height: 26,
    marginBottom: 6,
  },
  employeeDetails: { marginBottom: 17 },
  detailRow: { flexDirection: "row", marginBottom: 5 },
  detailLabel: { width: 112, fontFamily: "Times-Bold" },
  detailValue: { flex: 1 },
  tableTitle: {
    fontFamily: "Times-Bold",
    textDecoration: "underline",
    marginBottom: 8,
    fontSize: 10.5,
  },
  tableNote: { fontSize: 8.4, color: "#555555", marginBottom: 6 },
  table: {
    borderTopWidth: 0.5,
    borderLeftWidth: 0.5,
    borderColor: "#808080",
    marginBottom: 11,
  },
  row: { flexDirection: "row", minHeight: 18 },
  headerRow: {
    backgroundColor: "#e1e1e1",
    fontFamily: "Times-Bold",
    minHeight: 28,
  },
  totalRow: { backgroundColor: "#ededed", fontFamily: "Times-Bold" },
  finalRow: { backgroundColor: "#d9e8e7", fontFamily: "Times-Bold" },
  cell: {
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: "#808080",
    paddingTop: 3,
    paddingBottom: 3,
    paddingHorizontal: 5,
    fontSize: 8.5,
    justifyContent: "center",
  },
  category: { width: "24%" },
  component: { width: "40%" },
  totalLabel: { width: "64%" },
  amount: { width: "18%", textAlign: "right" },
  footnote: { fontSize: 9, marginBottom: 6, textAlign: "justify" },
  companyEnd: {
    fontFamily: "Times-Bold",
    marginTop: 10,
    textAlign: "right",
    fontSize: 10,
  },
});

function Strong({ children }: { children: ReactNode }) {
  return <Text style={styles.bold}>{children}</Text>;
}

function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function flattenContent(children: ReactNode): ReactNode[] {
  return React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ children?: ReactNode }>(child) &&
    child.type === React.Fragment
      ? flattenContent(child.props.children)
      : [child],
  );
}

function Clause({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  const content = flattenContent(children);
  const headingAndOpening = (
    <View wrap={false}>
      <Text style={styles.clauseHeading}>
        {number}.{"    "}
        <Text style={styles.underlined}>{title}</Text>
      </Text>
      <View style={styles.clauseBody}>{content[0]}</View>
    </View>
  );
  if (number === 4) {
    // Training can be longer than a page. Keep each phase together while allowing
    // the surrounding section to flow between pages independently.
    return (
      <>
        {headingAndOpening}
        {content.slice(1).map((child, index) => (
          <View key={index} style={styles.clauseBody}>
            {child}
          </View>
        ))}
        <View style={{ height: 10 }} />
      </>
    );
  }
  return (
    <View style={styles.clause} wrap={false}>
      {headingAndOpening}
      {content.length > 1 ? (
        <View style={styles.clauseBody}>{content.slice(1)}</View>
      ) : null}
    </View>
  );
}

function Footer() {
  return (
    <Text style={styles.footer} fixed>
      {COMPANY.name} | {COMPANY.legalName}
    </Text>
  );
}

const numericMoney = (value: number) =>
  formatMoney(value).replace(/^Rs\. /, "");

function SalaryRow({
  category = "",
  component,
  monthly,
  annual,
}: {
  category?: string;
  component: string;
  monthly: number;
  annual: number;
}) {
  return (
    <View style={styles.row} wrap={false}>
      <View style={[styles.cell, styles.category]}>
        <Text>{category}</Text>
      </View>
      <View style={[styles.cell, styles.component]}>
        <Text>{component}</Text>
      </View>
      <View style={[styles.cell, styles.amount]}>
        <Text>{numericMoney(monthly)}</Text>
      </View>
      <View style={[styles.cell, styles.amount]}>
        <Text>{numericMoney(annual)}</Text>
      </View>
    </View>
  );
}

function TotalRow({
  label,
  monthly,
  annual,
  final = false,
}: {
  label: string;
  monthly: number;
  annual: number;
  final?: boolean;
}) {
  return (
    <View
      style={[styles.row, final ? styles.finalRow : styles.totalRow]}
      wrap={false}
    >
      <View style={[styles.cell, styles.totalLabel]}>
        <Text>{label}</Text>
      </View>
      <View style={[styles.cell, styles.amount]}>
        <Text>{numericMoney(monthly)}</Text>
      </View>
      <View style={[styles.cell, styles.amount]}>
        <Text>{numericMoney(annual)}</Text>
      </View>
    </View>
  );
}

/** A shared PDF source powers both the live preview and the downloaded offer. */
export function OfferDocument({
  data,
  stationerySource = getPublicAssetPath("/offer-stationery.png"),
}: {
  data: OfferData;
  stationerySource?: string;
}) {
  const pay = calculateCompensation(data);
  const employee = data.employeeName.trim() || "[Employee name]";
  const role = data.role.trim() || "[Designation]";
  const signer = data.signerName.trim() || "[Authorized signatory]";
  const signerTitle = data.signerTitle.trim() || "[Title]";
  const manager = data.reportingTo.trim() || "[Reporting manager]";
  const location = data.location.trim() || "[Employment location]";
  const trainingDays = data.phase1Days + data.phase2Days + data.phase3Days;
  const hasIncentives = pay.variableAnnual > 0;
  const employmentArticle = data.employmentType === "Internship" ? "an" : "a";
  const probationStart = data.trainingEnabled
    ? "successful completion of the training program"
    : "date of joining";
  const phases = [
    {
      number: 1,
      days: data.phase1Days,
      title: "Class Room Training (CRT)",
      description:
        "You will undergo classroom training held by Company experts. You are required to successfully clear this phase before proceeding to the next phase. If you do not successfully clear CRT, this offer shall become null and void and the Company may terminate your employment immediately. The Company will not be liable to pay you for the days spent undergoing this phase. Out-of-pocket expenses during this phase, including conveyance, transport and food, are not reimbursable by the Company.",
    },
    {
      number: 2,
      days: data.phase2Days,
      title: "On Job Training - 1 (OJT-1)",
      description:
        "You will undertake practical, supervised work as part of your training program. Assessment and progression will be at the discretion of the Company's management.",
    },
    {
      number: 3,
      days: data.phase3Days,
      title: "On Job Training - 2 (OJT-2)",
      description:
        "You will undertake the final phase of on-the-job training as part of your training program. Your reporting manager will review your performance and completion of the training program.",
    },
  ].filter((phase) => phase.days > 0);

  return (
    <Document
      title={`Offer letter - ${employee}`}
      author={COMPANY.legalName}
      subject="Offer of employment and compensation annexure"
      creator={`${COMPANY.name} Offer Letter Creator`}
      language="en-IN"
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.stationeryClip} fixed>
          <Image src={stationerySource} style={styles.stationeryImage} />
        </View>
        <Text style={styles.title}>OFFER LETTER</Text>
        <Text style={styles.date}>Date: {formatDate(data.offerDate)}</Text>
        <View style={styles.recipient}>
          <Text>
            {data.salutation ? `${data.salutation} ` : ""}
            {employee},
          </Text>
          {data.employeeAddress.trim() ? (
            <Text style={styles.address}>{data.employeeAddress.trim()}</Text>
          ) : null}
          {data.employeeEmail.trim() ? (
            <Text style={styles.address}>{data.employeeEmail.trim()}</Text>
          ) : null}
        </View>
        <Text style={styles.intro}>
          <Strong>{COMPANY.legalName}</Strong> (
          <Text style={styles.italic}>"Company"</Text>) is delighted to offer
          you employment as <Strong>{role}</Strong> on {employmentArticle}{" "}
          <Strong>{data.employmentType.toLowerCase()}</Strong> basis, subject to
          the following terms and conditions.
        </Text>

        <Clause number={1} title="Position and Date of Joining:">
          <Paragraph>
            Your position in the Company will be <Strong>{role}</Strong>
            {data.trainingEnabled
              ? ", subject to successful completion of the training program"
              : ""}
            . Your date of joining shall be no later than{" "}
            <Strong>{formatDate(data.joiningDate)}</Strong>.
          </Paragraph>
        </Clause>

        <Clause number={2} title="Reporting and Employment Location:">
          <Paragraph>
            You will initially report to <Strong>{manager}</Strong>. Your
            initial employment location will be <Strong>{location}</Strong>,
            with a <Strong>{data.workMode.toLowerCase()}</Strong> work
            arrangement. The Company reserves the right to change your reporting
            manager and/or employment location as required by the business.
          </Paragraph>
        </Clause>

        <Clause
          number={3}
          title="Compensation and Employee Benefits (Refer Annexure):"
        >
          <Paragraph>
            Your gross base compensation will be{" "}
            <Strong>{formatMoney(pay.grossAnnual)} per annum</Strong>, paid
            monthly at <Strong>{formatMoney(pay.grossMonthly)}</Strong>, subject
            to applicable deductions. Employer contributions, employee
            deductions and the complete compensation structure are detailed in
            the Annexure.
          </Paragraph>
          {data.retentionBonus > 0 ? (
            <Paragraph>
              Your offer includes a fixed retention bonus of{" "}
              <Strong>{formatMoney(pay.retentionAnnual)}</Strong>, payable once
              after completing{" "}
              <Strong>
                {data.retentionMonths}{" "}
                {data.retentionMonths === 1 ? "month" : "months"}
              </Strong>{" "}
              with the Company. Including employer contributions and this
              retention award, your fixed cost to company is{" "}
              <Strong>{formatMoney(pay.fixedAnnual)}</Strong> for the
              illustrated year.
            </Paragraph>
          ) : (
            <Paragraph>
              Your fixed cost to company, including employer contributions, is{" "}
              <Strong>{formatMoney(pay.fixedAnnual)} per annum</Strong>. No
              fixed retention bonus is included in this offer.
            </Paragraph>
          )}
          {hasIncentives ? (
            <Paragraph>
              Project-based incentives may be up to{" "}
              <Strong>
                {formatMoney(data.weeklyIncentive)} per eligible week
              </Strong>
              . Based on <Strong>{data.incentiveWeeks} eligible weeks</Strong>,
              the illustrated annual incentive opportunity is{" "}
              <Strong>{formatMoney(pay.variableAnnual)}</Strong>. Incentives
              depend on achievement of assigned targets and are not guaranteed.
              The Company's incentive structure and targets may change with
              business needs.
            </Paragraph>
          ) : (
            <Paragraph>
              No variable project incentive is included in this offer.
            </Paragraph>
          )}
        </Clause>

        <Clause number={4} title="Training Program:">
          {data.trainingEnabled ? (
            <>
              <Paragraph>
                You will be required to undergo a training program designed by
                the Company. You will operate as <Strong>{role}</Strong> during
                this program. {data.trainingDescription.trim()}
              </Paragraph>
              <Paragraph>
                The training program will span{" "}
                <Strong>
                  {trainingDays} {trainingDays === 1 ? "day" : "days"}
                </Strong>{" "}
                from your date of joining and will be conducted in{" "}
                {phases.length} {phases.length === 1 ? "phase" : "phases"}, as
                described below.
              </Paragraph>
              {phases.map((phase) => (
                <View key={phase.number} wrap={false}>
                  <Text style={styles.subheading}>
                    Phase {phase.number}: {phase.title}
                  </Text>
                  <Paragraph>
                    This phase will run for{" "}
                    <Strong>
                      {phase.days} {phase.days === 1 ? "day" : "days"}
                    </Strong>
                    . {phase.description}
                  </Paragraph>
                </View>
              ))}
              <View wrap={false}>
                <Text style={styles.subheading}>
                  Separation during the program
                </Text>
                <Paragraph>
                  If you choose to leave the Company during the training
                  program, you will be required to serve a{" "}
                  <Strong>{data.noticeDays}-day notice period</Strong>, unless
                  the Company waives this requirement at its sole discretion.
                </Paragraph>
              </View>
            </>
          ) : (
            <Paragraph>
              No separate training program applies to this offer. You will
              commence your role from your date of joining.
            </Paragraph>
          )}
        </Clause>

        <Clause number={5} title="Probation:">
          {data.probationMonths > 0 ? (
            <Paragraph>
              You will be on probation for{" "}
              <Strong>
                {data.probationMonths}{" "}
                {data.probationMonths === 1 ? "month" : "months"}
              </Strong>{" "}
              from your {probationStart} ("Probation Period"). During the
              Probation Period, either you or the Company may terminate the
              employment. Depending on the circumstances of separation, you will
              be required to serve{" "}
              <Strong>{data.noticeDays} days' notice</Strong> or the equivalent
              notice pay, subject to applicable Company policy.
            </Paragraph>
          ) : (
            <Paragraph>
              No separate probation period applies to this offer.
            </Paragraph>
          )}
          {data.probationMonths > 0 && data.projectTarget.trim() ? (
            <Paragraph>
              Your performance target during this period will be{" "}
              <Strong>{data.projectTarget.trim()}</Strong>, or as amended by the
              Company from time to time.
            </Paragraph>
          ) : null}
        </Clause>

        <Clause number={6} title="Employment Relationship and Target:">
          <Paragraph>
            {data.probationMonths > 0
              ? "After successful completion of the Probation Period, "
              : "From your date of joining, "}
            your employment as <Strong>{role}</Strong> will be subject to the
            Company's confirmation and policies.
            {data.projectTarget.trim()
              ? ` Your ongoing performance target will be ${data.projectTarget.trim()}, or as amended by the Company from time to time.`
              : ""}
          </Paragraph>
          <Paragraph>
            Your employment is for no specific period of time. After
            confirmation, either party may terminate the employment by giving{" "}
            <Strong>{data.noticeDays} days' notice in writing</Strong>, subject
            to the terms of employment and applicable Company policies.
          </Paragraph>
        </Clause>

        <Clause number={7} title="Absence/Leave:">
          <Paragraph>
            Uninformed or unapproved absence from work for a continuous period
            of{" "}
            <Strong>
              {data.absenceDays} {data.absenceDays === 1 ? "day" : "days"}
            </Strong>
            , or remaining absent beyond approved leave without prior approval
            from your reporting manager, may result in termination of employment
            without further notice, unless the Company waives this requirement.
          </Paragraph>
        </Clause>

        <Clause number={8} title="Company Policies:">
          <Paragraph>
            You shall be bound by all active policies and procedures of the
            Company, which may be amended from time to time. The Company's
            management reserves the right to amend its policies and procedures.
          </Paragraph>
        </Clause>

        <Clause number={9} title="Reimbursement for Expenses:">
          <Paragraph>
            You will be entitled to reimbursement for pre-approved, reasonable
            expenses incurred in the performance of your duties, in accordance
            with the Company's policies.
          </Paragraph>
        </Clause>

        <Clause number={10} title="Laptop Policy:">
          <Paragraph>{data.laptopPolicy.trim() || "[Laptop policy]"}</Paragraph>
        </Clause>

        <Clause number={11} title="Indemnity:">
          <Paragraph>
            You are required to indemnify and keep the Company indemnified
            against claims, damages and losses it may suffer on account of a
            breach by you of the terms of employment or Company policies. In
            addition to other remedies available under applicable law, the
            Company may seek an injunction restraining any such breach.
          </Paragraph>
        </Clause>

        <Footer />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <View style={styles.stationeryClip} fixed>
          <Image src={stationerySource} style={styles.stationeryImage} />
        </View>
        <Text style={styles.title}>ACCEPTANCE OF OFFER</Text>
        <Clause number={12} title="Understanding:">
          <Paragraph>
            This letter contains the entire understanding between you and the
            Company and supersedes all previous discussions, agreements and
            arrangements relating to your engagement with the Company.
          </Paragraph>
        </Clause>

        <Paragraph>
          We hope you find the above terms acceptable. Kindly indicate your
          agreement with these terms and conditions by signing and dating this
          letter and returning a copy to the Company.
          {data.acceptanceDeadline
            ? ` Please return your acceptance by ${formatDate(data.acceptanceDeadline)}.`
            : ""}
        </Paragraph>
        <Paragraph>
          We welcome you to our organisation and look forward to your
          contribution to the growth of the organisation and yourself.
        </Paragraph>
        <View style={styles.signatureBlock} wrap={false}>
          <Text>Sincerely,</Text>
          <View style={styles.signatureLine} />
          <Text style={styles.label}>Authorized signature</Text>
          <Text>
            For and on behalf of <Strong>{COMPANY.legalName}</Strong>
          </Text>
          <Text style={{ marginTop: 10, fontFamily: "Times-Bold" }}>
            {signer}
          </Text>
          <Text>{signerTitle}</Text>
        </View>
        <View style={styles.acceptance} wrap={false}>
          <Text style={styles.subheading}>Employee acceptance</Text>
          <Paragraph>
            I have read and hereby accept this offer letter, the terms of
            employment and the compensation structure set out in the Annexure.
          </Paragraph>
          <Text>
            Name: <Strong>{employee}</Strong>
          </Text>
          <Text style={{ marginTop: 6 }}>Designation: {role}</Text>
          <View style={styles.acceptanceFields}>
            <View style={styles.acceptanceColumn}>
              <View style={styles.acceptanceLine} />
              <Text style={styles.label}>Employee signature</Text>
            </View>
            <View style={styles.acceptanceColumn}>
              <View style={styles.acceptanceLine} />
              <Text style={styles.label}>Date of acceptance</Text>
            </View>
          </View>
        </View>
        <Footer />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <View style={styles.stationeryClip} fixed>
          <Image src={stationerySource} style={styles.stationeryImage} />
        </View>
        <Text style={styles.title}>ANNEXURE</Text>
        <View style={styles.employeeDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Employee name</Text>
            <Text style={styles.detailValue}>- {employee}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Designation</Text>
            <Text style={styles.detailValue}>- {role}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date of joining</Text>
            <Text style={styles.detailValue}>
              - {formatDate(data.joiningDate)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Employment type</Text>
            <Text style={styles.detailValue}>- {data.employmentType}</Text>
          </View>
        </View>
        <Text style={styles.tableTitle}>Compensation structure</Text>
        <Text style={styles.tableNote}>
          All amounts in INR. Monthly equivalents of annual awards are
          illustrative; they are not monthly payouts.
        </Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]} wrap={false}>
            <View style={[styles.cell, styles.category]}>
              <Text>Category</Text>
            </View>
            <View style={[styles.cell, styles.component]}>
              <Text>Component</Text>
            </View>
            <View style={[styles.cell, styles.amount]}>
              <Text>Monthly / equivalent</Text>
            </View>
            <View style={[styles.cell, styles.amount]}>
              <Text>Yearly</Text>
            </View>
          </View>
          <SalaryRow
            category="Taxable"
            component="Basic"
            monthly={data.basic}
            annual={data.basic * 12}
          />
          <SalaryRow
            component="HRA"
            monthly={data.hra}
            annual={data.hra * 12}
          />
          <SalaryRow
            component="Statutory bonus"
            monthly={data.statutoryBonus}
            annual={data.statutoryBonus * 12}
          />
          <SalaryRow
            component="Special allowance"
            monthly={data.specialAllowance}
            annual={data.specialAllowance * 12}
          />
          <SalaryRow
            category="Reimbursement"
            component="LTA (1)"
            monthly={data.lta}
            annual={data.lta * 12}
          />
          <TotalRow
            label="Gross salary"
            monthly={pay.grossMonthly}
            annual={pay.grossAnnual}
          />
          <SalaryRow
            category="Retirals"
            component="PF contribution (employer)"
            monthly={data.employerPf}
            annual={data.employerPf * 12}
          />
          <SalaryRow
            component="ESIC contribution (employer)"
            monthly={data.employerEsic}
            annual={data.employerEsic * 12}
          />
          <TotalRow
            label="Base cost to company (CTC)"
            monthly={pay.baseCtcMonthly}
            annual={pay.baseCtcAnnual}
          />
          <SalaryRow
            category="Deductions"
            component="PF contribution (employee)"
            monthly={data.employeePf}
            annual={data.employeePf * 12}
          />
          <SalaryRow
            component="ESIC contribution (employee)"
            monthly={data.employeeEsic}
            annual={data.employeeEsic * 12}
          />
          <SalaryRow
            component="Professional tax (2)"
            monthly={data.professionalTax}
            annual={data.professionalTax * 12}
          />
          <TotalRow
            label="Net pay before income tax"
            monthly={pay.netMonthly}
            annual={pay.netAnnual}
          />
        </View>
        <View style={styles.table}>
          <View style={styles.row} wrap={false}>
            <View style={[styles.cell, styles.totalLabel]}>
              <Text>Fixed retention bonus (3)</Text>
            </View>
            <View style={[styles.cell, styles.amount]}>
              <Text>{numericMoney(pay.retentionMonthlyEquivalent)}</Text>
            </View>
            <View style={[styles.cell, styles.amount]}>
              <Text>{numericMoney(pay.retentionAnnual)}</Text>
            </View>
          </View>
          <TotalRow
            label="Fixed cost to company (CTC)"
            monthly={pay.fixedMonthlyEquivalent}
            annual={pay.fixedAnnual}
          />
          <View style={styles.row} wrap={false}>
            <View style={[styles.cell, styles.totalLabel]}>
              <Text>Variable project incentives (4)</Text>
            </View>
            <View style={[styles.cell, styles.amount]}>
              <Text>{numericMoney(pay.variableMonthlyEquivalent)}</Text>
            </View>
            <View style={[styles.cell, styles.amount]}>
              <Text>{numericMoney(pay.variableAnnual)}</Text>
            </View>
          </View>
          <TotalRow
            label="Total cost to company (CTC)"
            monthly={pay.totalMonthlyEquivalent}
            annual={pay.totalAnnual}
            final
          />
        </View>
        <Text style={styles.footnote}>
          (1) Tax treatment of reimbursements is subject to the required
          documents and bills being submitted.
        </Text>
        <Text style={styles.footnote}>
          (2) Professional tax may change according to applicable state norms
          and monthly gross income. Net pay is shown before income tax or other
          applicable deductions.
        </Text>
        <Text style={styles.footnote}>
          (3){" "}
          {data.retentionBonus > 0
            ? `A single retention award of ${formatMoney(pay.retentionAnnual)} is payable after completing ${data.retentionMonths} ${data.retentionMonths === 1 ? "month" : "months"} with the Company. The monthly column shows its annualized equivalent only.`
            : "No fixed retention bonus is included in this offer."}
        </Text>
        <Text style={styles.footnote}>
          (4){" "}
          {hasIncentives
            ? `Project-based incentives of up to ${formatMoney(data.weeklyIncentive)} per eligible week are illustrated over ${data.incentiveWeeks} weeks per year (${formatMoney(pay.variableAnnual)} annually). Payment is subject to achievement of assigned targets${data.projectTarget.trim() ? ` (${data.projectTarget.trim()})` : ""} and the Company's incentive policy.`
            : "No variable project incentive is included in this offer."}
        </Text>
        <Text style={styles.footnote}>
          Fixed CTC includes gross salary, employer contributions and the stated
          retention award. Total CTC adds the illustrated variable incentive
          opportunity; employee deductions reduce net pay, not CTC.
        </Text>
        <Text style={styles.companyEnd}>{COMPANY.legalName}</Text>
        <Footer />
      </Page>
    </Document>
  );
}

export default OfferDocument;
