import {
  ServiceUnavailableException,
  ForbiddenException,
} from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { User, Entity } from "../types";
import type { WorkflowRequest, WorkflowEvent } from "./models";
import { INFORMATION_SCOPES } from "./scopes";
export type Mode = "mock" | "sandbox" | "production";
export interface ABHAIdentity {
  number: string;
  address: string;
  name: string;
  verificationStatus: "MOCK_VERIFIED" | "VERIFIED";
  provider: string;
  verifiedAt: string;
}
export const recordEnvelope = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    mime: z.enum([
      "application/fhir+json",
      "application/json",
      "text/plain",
      "application/pdf",
    ]),
    recordType: z.enum([
      "discharge",
      "prescription",
      "diagnostic",
      "laboratory",
      "hospital",
    ]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    informationScopes: z.array(z.enum(INFORMATION_SCOPES)).min(1),
    content: z.string().max(14_000_000),
    encoding: z.enum(["utf8", "base64"]),
    source: z.string().max(120),
  })
  .strict();
export const transferSchema = z
  .object({
    correlationId: z.uuid(),
    records: z.array(recordEnvelope).max(100),
  })
  .strict();
export type Transfer = z.infer<typeof transferSchema>;
export interface ABDMAdapter {
  readonly mode: Mode;
  verifyABHA(identifier: string, patient: User): Promise<ABHAIdentity>;
  resolveABHA(identifier: string, connection: Entity): Promise<boolean>;
  createConsentRequest(
    request: WorkflowRequest,
  ): Promise<{ correlationId: string }>;
  getConsentStatus(request: WorkflowRequest): Promise<string>;
  fetchHealthInformation(request: WorkflowRequest): Promise<Transfer>;
  revokeConsent(request: WorkflowRequest): Promise<void>;
  handleWebhook(
    event: WorkflowEvent,
    request: WorkflowRequest,
  ): Promise<WorkflowEvent>;
}
export const unavailable = () =>
  new ServiceUnavailableException(
    "Health information service temporarily unavailable",
  );
export class MockABDMAdapter implements ABDMAdapter {
  readonly mode = "mock" as const;
  async verifyABHA(identifier: string, patient: User) {
    if (
      !patient.synthetic ||
      !patient.demoABHA ||
      ![patient.demoABHA.number, patient.demoABHA.address].includes(identifier)
    )
      throw new ForbiddenException(
        "Mock verification accepts only the linked synthetic demo identity. No real ABHA verification has occurred.",
      );
    return {
      ...patient.demoABHA,
      name: patient.name,
      verificationStatus: "MOCK_VERIFIED" as const,
      provider: "G1 synthetic simulator",
      verifiedAt: new Date().toISOString(),
    };
  }
  async resolveABHA(identifier: string, connection: Entity) {
    return (
      connection.synthetic === true &&
      [connection.number, connection.address].includes(identifier)
    );
  }
  async createConsentRequest(request: WorkflowRequest) {
    return { correlationId: request.correlationId };
  }
  async getConsentStatus(request: WorkflowRequest) {
    if (process.env.ABDM_MOCK_FAILURE === "consent-status")
      throw new ServiceUnavailableException(
        "Health information service temporarily unavailable",
      );
    return request.workflowStatus;
  }
  async fetchHealthInformation(request: WorkflowRequest) {
    if (request.workflowStatus !== "APPROVED")
      throw new ForbiddenException("Patient approval is required");
    if (process.env.ABDM_MOCK_FAILURE === "retrieval") throw unavailable();
    if (process.env.ABDM_MOCK_FAILURE === "malformed")
      return { records: "invalid" } as unknown as Transfer;
    // Fixtures are confined to the mock adapter. Controllers never load static records.
    const fixture = JSON.parse(
      await readFile(
        resolve(__dirname, "../../fixtures/abdm/synthetic-records.json"),
        "utf8",
      ),
    );
    const records = fixture.records.filter(
      (r: any) =>
        r.date >= request.fromDate &&
        r.date <= request.toDate &&
        r.informationScopes.every((s: string) =>
          request.requestedScopes.includes(s),
        ),
    );
    return transferSchema.parse({
      correlationId: request.correlationId,
      records,
    });
  }
  async revokeConsent(_request: WorkflowRequest) {}
  async handleWebhook(event: WorkflowEvent, request: WorkflowRequest) {
    if (event.correlationId !== request.correlationId)
      throw new ForbiddenException("Callback correlation mismatch");
    return event;
  }
}
// No speculative URLs, auth scheme, official purpose codes or encryption exchange.
// This boundary stays closed until an official, versioned transport passes contract tests.
export class SandboxABDMAdapter implements ABDMAdapter {
  readonly mode: Mode = "sandbox";
  async verifyABHA(_identifier: string, _patient: User): Promise<ABHAIdentity> {
    throw unavailable();
  }
  async resolveABHA(
    _identifier: string,
    _connection: Entity,
  ): Promise<boolean> {
    throw unavailable();
  }
  async createConsentRequest(
    _request: WorkflowRequest,
  ): Promise<{ correlationId: string }> {
    throw unavailable();
  }
  async getConsentStatus(_request: WorkflowRequest): Promise<string> {
    throw unavailable();
  }
  async fetchHealthInformation(_request: WorkflowRequest): Promise<Transfer> {
    throw unavailable();
  }
  async revokeConsent(_request: WorkflowRequest): Promise<void> {
    throw unavailable();
  }
  async handleWebhook(
    _event: WorkflowEvent,
    _request: WorkflowRequest,
  ): Promise<WorkflowEvent> {
    throw unavailable();
  }
}
export class ProductionABDMAdapter extends SandboxABDMAdapter {
  readonly mode = "production" as const;
}
export function abdmMode(): Mode {
  const mode = process.env.ABDM_MODE || "mock";
  if (!["mock", "sandbox", "production"].includes(mode))
    throw new Error("Invalid ABDM_MODE");
  return mode as Mode;
}
export function adapter(): ABDMAdapter {
  return abdmMode() === "mock"
    ? new MockABDMAdapter()
    : abdmMode() === "sandbox"
      ? new SandboxABDMAdapter()
      : new ProductionABDMAdapter();
}
