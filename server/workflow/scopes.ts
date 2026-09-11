import type { Consent, Fact, MedicalDocument, RecordType } from "../types";
export const INFORMATION_SCOPES = [
  "allergies",
  "medications",
  "diagnoses",
  "procedures",
  "labs",
  "discharge-summaries",
  "imaging",
  "immunizations",
  "encounters",
] as const;
export type InformationScope = (typeof INFORMATION_SCOPES)[number];
export function informationScope(
  f: Fact,
  d: MedicalDocument,
): InformationScope {
  if (f.type === "allergy") return "allergies";
  if (f.type === "medication") return "medications";
  if (f.type === "condition") return "diagnoses";
  if (["procedure", "implant", "surgery"].includes(f.type)) return "procedures";
  if (f.type === "immunization") return "immunizations";
  if (f.type === "hospitalization") return "encounters";
  return d.recordType === "diagnostic" ? "imaging" : "labs";
}
export function allowsInformation(c: Consent, d: MedicalDocument, f?: Fact) {
  if (!c.requestedScopes) return true;
  if (f) return c.requestedScopes.includes(informationScope(f, d));
  return true; // metadata date/type eligibility; whole-source checks are stricter below
}
export function recordTypesFor(scopes: InformationScope[]): RecordType[] {
  // Clinical concepts can occur in any record type. Filter facts after extraction.
  return ["discharge", "prescription", "diagnostic", "laboratory", "hospital"];
}
export function allowsWholeSource(c: Consent, d: MedicalDocument) {
  if (!c.requestedScopes) return true;
  // Mixed narrative documents require every concept plus explicit document-class scope.
  return (
    INFORMATION_SCOPES.every((s) => c.requestedScopes.includes(s)) ||
    (d.synthetic === true &&
      Array.isArray(d.informationScopes) &&
      d.informationScopes.every((s: string) => c.requestedScopes.includes(s)))
  );
}
