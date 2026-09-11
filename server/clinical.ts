import { randomUUID } from "node:crypto";
import type { Fact, FactType, MedicalDocument } from "./types";
export const EXTRACTOR_VERSION = "g1-deterministic-0.1.0";
const categories: Record<string, FactType> = {
  immunization: "immunization",
  immunizations: "immunization",
  surgery: "procedure",
  vital: "observation",
  vitals: "observation",
  demographic: "demographic",
  allergy: "allergy",
  allergies: "allergy",
  medication: "medication",
  medications: "medication",
  condition: "condition",
  conditions: "condition",
  diagnosis: "condition",
  procedure: "procedure",
  procedures: "procedure",
  implant: "implant",
  implants: "implant",
  hospitalization: "hospitalization",
  observation: "observation",
  observations: "observation",
  lab: "observation",
};
export function makeFact(
  d: MedicalDocument,
  type: FactType,
  label: string,
  value: string,
  span: string,
  location: { page?: number; section?: string; path?: string },
  date = d.recordDate,
  status: Fact["status"] = "present",
  confidence = 0.85,
): Fact {
  return {
    id: randomUUID(),
    kind: "fact",
    owner: d.patientId,
    tenant: "",
    patientId: d.patientId,
    type,
    label,
    value,
    status,
    certainty: status === "suspected" ? "uncertain" : "source-stated",
    effectiveDate: date,
    confidence,
    evidence: [
      {
        documentId: d.id,
        ...location,
        span,
        sourceHash: d.hash,
        sourceDocument: d.name,
        sourceDate: d.recordDate,
      },
    ],
  };
}
export function context(text: string): Fact["status"] {
  if (/\b(family history|mother|father|sibling)\b/i.test(text))
    return "family-history";
  if (/\bruled out\b/i.test(text)) return "ruled-out";
  if (/\b(no|not|denies|negative for|without)\b/i.test(text)) return "absent";
  if (/\b(possible|suspected|probable|query|may have)\b/i.test(text))
    return "suspected";
  if (
    /\b(history of|historical|resolved|discontinued|stopped|previous)\b/i.test(
      text,
    )
  )
    return "historical";
  return "present";
}
// Conservative, section-oriented baseline. Instructions and free prose are never executed.
export function extractText(pages: string[], d: MedicalDocument): Fact[] {
  const facts: Fact[] = [];
  pages.forEach((page, index) => {
    let section: FactType | undefined;
    for (const raw of page.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.length > 1000) continue;
      if (
        /ignore.{0,30}(instruction|previous)|system prompt|recommend treatment|prescribe|assistant:|<script/i.test(
          line,
        )
      )
        continue;
      const match = line.match(/^([a-z ]{2,24})\s*:\s*(.*)$/i);
      let value = line;
      if (match) {
        section = categories[match[1].toLowerCase()];
        value = match[2].trim();
      }
      if (!section || !value) continue;
      if (!match && !/^[-•]\s/.test(value)) {
        section = undefined;
        continue;
      }
      value = value.replace(/^[-•]\s*/, "");
      const dateMatch = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      const date = dateMatch?.[1] || d.recordDate;
      if (!Number.isFinite(Date.parse(date))) continue;
      const status = context(value);
      const label = value
        .replace(
          /\b(no known|no|denies|possible|suspected|history of|discontinued|stopped|resolved|family history of|ruled out)\b/gi,
          "",
        )
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
        .trim()
        .replace(/^[,; -]+|[,; -]+$/g, "");
      if (!label) continue;
      const fact = makeFact(
        d,
        section,
        label,
        value,
        line,
        { page: index + 1, section },
        date,
        status,
        0.8,
      );
      if (section === "medication")
        fact.dose = value.match(
          /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units)\b/i,
        )?.[0];
      facts.push(fact);
    }
  });
  return facts;
}
const codingText = (concept: any): string =>
  concept?.text ||
  concept?.coding?.[0]?.display ||
  concept?.coding?.[0]?.code ||
  "";
export function extractFhir(bundle: any, d: MedicalDocument): Fact[] {
  if (
    bundle.resourceType !== "Bundle" ||
    !Array.isArray(bundle.entry) ||
    bundle.entry.length > 2000
  )
    throw new Error("A FHIR Bundle with at most 2000 entries is required");
  const facts: Fact[] = [];
  bundle.entry.forEach((entry: any, i: number) => {
    const r = entry.resource;
    if (!r || typeof r !== "object") return;
    let type: FactType;
    let value: string;
    let status: Fact["status"] = "present";
    switch (r.resourceType) {
      case "Condition":
        type = "condition";
        value = codingText(r.code);
        break;
      case "AllergyIntolerance":
        type = "allergy";
        value = codingText(r.code);
        break;
      case "MedicationStatement":
      case "MedicationRequest":
        type = "medication";
        value = codingText(r.medicationCodeableConcept);
        if (r.dosage?.[0]?.text) value += " " + r.dosage[0].text;
        if (r.dosageInstruction?.[0]?.text)
          value += " " + r.dosageInstruction[0].text;
        break;
      case "Procedure":
        type = "procedure";
        value = codingText(r.code);
        break;
      case "Device":
        type = "implant";
        value = codingText(r.type);
        break;
      case "Observation":
        type = "observation";
        value = [
          codingText(r.code),
          r.valueQuantity?.value,
          r.valueQuantity?.unit,
          codingText(r.valueCodeableConcept),
          r.valueString,
        ]
          .filter((v) => v !== undefined && v !== "")
          .join(" ");
        break;
      case "Encounter":
        type = "hospitalization";
        value = codingText(r.type?.[0]) || "Recorded encounter";
        break;
      case "Immunization":
        type = "immunization";
        value = codingText(r.vaccineCode);
        break;
      case "Patient":
        if (!r.gender) return;
        type = "demographic";
        value = "Recorded sex: " + r.gender;
        break;
      default:
        return;
    }
    const clinical = r.clinicalStatus?.coding?.[0]?.code || r.status;
    const verification = r.verificationStatus?.coding?.[0]?.code;
    if (
      ["entered-in-error", "cancelled"].includes(clinical) ||
      verification === "entered-in-error"
    )
      return;
    if (verification === "refuted") status = "ruled-out";
    else if (
      ["unconfirmed", "provisional", "differential"].includes(verification)
    )
      status = "suspected";
    else if (
      ["resolved", "inactive", "stopped", "completed"].includes(clinical)
    )
      status = "historical";
    const date = String(
      r.effectiveDateTime ||
        r.onsetDateTime ||
        r.performedDateTime ||
        r.period?.start ||
        r.authoredOn ||
        r.occurrenceDateTime ||
        d.recordDate,
    ).slice(0, 10);
    if (!value || value.length > 2000 || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return;
    // Preview contains only the extracted field, never the unrestricted resource or identifiers.
    const f = makeFact(
      d,
      type,
      codingText(r.code) || value,
      value,
      value,
      { path: `Bundle.entry[${i}].resource`, section: r.resourceType },
      date,
      status,
      0.98,
    );
    f.code = r.code?.coding?.[0]?.code;
    f.dose =
      type === "medication"
        ? value.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units)\b/i)?.[0]
        : undefined;
    facts.push(f);
  });
  return facts;
}
export function deduplicate(facts: Fact[]) {
  const map = new Map<string, Fact>();
  for (const f of facts) {
    const k = [f.type, f.value.toLowerCase(), f.status, f.effectiveDate].join(
      "|",
    );
    const existing = map.get(k);
    if (existing) existing.evidence.push(...f.evidence);
    else map.set(k, structuredClone(f));
  }
  return [...map.values()];
}
const subject = (f: Fact) =>
  f.label
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|g|ml|units)\b/g, "")
    .replace(/\b(daily|twice|once|active|present|negative|positive)\b/g, "")
    .replace(/[^a-z]/g, "");
export function conflicts(facts: Fact[]) {
  const result: {
    id: string;
    type: string;
    factRefs: string[];
    description: string;
    status: string;
  }[] = [];
  for (let i = 0; i < facts.length; i++)
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i],
        b = facts[j];
      if (a.type !== b.type) continue;
      let reason = "";
      if (
        a.type === "allergy" &&
        ((a.status === "absent" &&
          /known|allerg/i.test(a.value) &&
          b.status === "present") ||
          (b.status === "absent" &&
            /known|allerg/i.test(b.value) &&
            a.status === "present"))
      )
        reason = "Allergy records disagree";
      if (
        subject(a) === subject(b) &&
        ((a.status === "present" &&
          ["absent", "ruled-out"].includes(b.status)) ||
          (b.status === "present" &&
            ["absent", "ruled-out"].includes(a.status)))
      )
        reason = "Conflicting presence or negation";
      if (
        a.type === "medication" &&
        subject(a) === subject(b) &&
        a.dose &&
        b.dose &&
        a.dose !== b.dose
      )
        reason =
          "Medication doses differ across records; verify dates and source";
      if (
        a.type === "observation" &&
        /blood (group|type)/i.test(a.value) &&
        /blood (group|type)/i.test(b.value) &&
        a.value.toLowerCase() !== b.value.toLowerCase()
      )
        reason = "Blood group records disagree";
      if (
        a.type === "medication" &&
        subject(a) === subject(b) &&
        a.status !== b.status &&
        [a.status, b.status].includes("historical")
      )
        reason = "Medication statuses differ; verify source and dates";
      if (
        a.type === "demographic" &&
        a.label.split(":")[0] === b.label.split(":")[0] &&
        a.value !== b.value
      )
        reason = "Conflicting source demographics detected";
      if (reason)
        result.push({
          id: `${a.id}:${b.id}`,
          type: a.type,
          factRefs: [a.id, b.id],
          description: reason,
          status: "unresolved",
        });
    }
  return result;
}
export function buildBrief(facts: Fact[], documents: MedicalDocument[]) {
  const unique = deduplicate(facts);
  const issues = conflicts(unique);
  const critical = unique
    .filter(
      (f) =>
        ["allergy", "implant"].includes(f.type) ||
        (f.type === "medication" &&
          /warfarin|apixaban|rivaroxaban|dabigatran|insulin|heparin/i.test(
            f.value,
          )) ||
        f.type === "condition" ||
        (["hospitalization", "procedure"].includes(f.type) &&
          Date.now() - Date.parse(f.effectiveDate) < 30 * 86400000),
    )
    .filter(
      (f) => !["family-history", "ruled-out", "absent"].includes(f.status),
    );
  return {
    facts: unique,
    activeMedications: unique.filter(
      (f) => f.type === "medication" && f.status === "present",
    ),
    recentEvents: unique
      .filter((f) => ["hospitalization", "procedure"].includes(f.type))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
    importantLabs: unique.filter((f) => f.type === "observation"),
    critical,
    conflicts: issues,
    timeline: [...unique].sort((a, b) =>
      b.effectiveDate.localeCompare(a.effectiveDate),
    ),
    coverage: {
      documents: documents.length,
      facts: unique.length,
      latest:
        documents
          .map((d) => d.receivedAt)
          .sort()
          .at(-1) || null,
    },
    versions: {
      extractor: EXTRACTOR_VERSION,
      summary: "structured-template-1",
      model: "none",
    },
    notice:
      "Reconstructed source history. No diagnosis or treatment advice. Extraction is unvalidated; verify the original records.",
  };
}
export function validateClaims(
  claims: { factId: string; value: string }[],
  facts: Fact[],
) {
  return claims.every((c) =>
    facts.some(
      (f) => f.id === c.factId && f.value === c.value && f.evidence.length > 0,
    ),
  );
}
