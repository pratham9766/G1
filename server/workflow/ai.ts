import { z } from "zod";
import { buildBrief, validateClaims } from "../clinical";
import type { Fact, MedicalDocument } from "../types";
export interface ClinicalAIProvider {
  readonly name: string;
  summarize(
    facts: Fact[],
    documents: MedicalDocument[],
  ): Promise<ReturnType<typeof buildBrief>>;
}
const claimsSchema = z.array(
  z.object({ factId: z.string(), value: z.string() }).strict(),
);
export class LocalProvider implements ClinicalAIProvider {
  readonly name: string = "local-deterministic";
  async summarize(facts: Fact[], documents: MedicalDocument[]) {
    const claims = claimsSchema.parse(
      facts.map((f) => ({ factId: f.id, value: f.value })),
    );
    if (!validateClaims(claims, facts))
      throw new Error("Unsupported clinical claim");
    return buildBrief(facts, documents);
  }
}
export class MockProvider extends LocalProvider {
  readonly name = "mock";
  async summarize(facts: Fact[], docs: MedicalDocument[]) {
    if (process.env.CLINICAL_AI_MOCK_FAILURE === "true")
      throw new Error("Synthetic AI failure");
    return super.summarize(facts, docs);
  }
}
export class PrivateProvider implements ClinicalAIProvider {
  readonly name = "private-unconfigured";
  async summarize(
    _facts: Fact[],
    _documents: MedicalDocument[],
  ): Promise<ReturnType<typeof buildBrief>> {
    throw new Error("Private provider has not been configured and validated");
  }
}
export function aiProvider(): ClinicalAIProvider {
  const name = process.env.CLINICAL_AI_PROVIDER || "local";
  if (name === "local") return new LocalProvider();
  if (name === "mock") return new MockProvider();
  if (name === "private") return new PrivateProvider();
  throw new Error("Public external AI providers are disabled");
}
