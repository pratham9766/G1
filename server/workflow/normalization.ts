import type { Fact } from "../types";
// Keep normalized matching keys separate from verbatim source values. No clinical
// code is invented: source-provided coding remains authoritative.
export function normalizeClinicalEntities(facts: Fact[]): Fact[] {
  return facts.map((f) => ({
    ...f,
    normalizedConcept: f.label
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim(),
    entityCategory:
      f.type === "observation"
        ? /pulse|pressure|temperature|respiratory|saturation/i.test(f.label)
          ? "vitals"
          : "labs"
        : f.type === "hospitalization"
          ? "encounters"
          : f.type === "procedure"
            ? "procedures"
            : f.type,
    extractionLabel:
      f.confidence < 0.85
        ? "Extracted"
        : f.certainty === "uncertain"
          ? "Uncertain"
          : "Verified from record",
  }));
}
