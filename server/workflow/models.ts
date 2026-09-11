import { z } from "zod";
import type { Entity } from "../types";
import { INFORMATION_SCOPES } from "./scopes";
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const requestSchema = z
  .object({
    accessSessionId: z.uuid(),
    purpose: z.enum(["emergency-treatment", "treatment", "follow-up-care"]),
    requestedScopes: z.array(z.enum(INFORMATION_SCOPES)).min(1).max(9),
    dateFrom: isoDate,
    dateTo: isoDate,
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const eventSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    type: z.enum([
      "consent.approved",
      "consent.denied",
      "consent.expired",
      "consent.revoked",
      "health.received",
      "transfer.failed",
    ]),
    timestamp: z.iso.datetime(),
    correlationId: z.uuid(),
  })
  .strict();
export type WorkflowEvent = z.infer<typeof eventSchema>;
export type WorkflowStatus =
  "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "REVOKED" | "FAILED";
export type TransferStatus =
  | "REQUEST_SENT"
  | "WAITING_FOR_PATIENT"
  | "APPROVED"
  | "DATA_REQUESTED"
  | "DATA_RECEIVED"
  | "PROCESSING"
  | "READY"
  | "FAILED";
export interface WorkflowRequest extends Entity {
  id: string;
  patientId: string;
  doctorId: string;
  purpose: string;
  requestedScopes: string[];
  scope: string[];
  fromDate: string;
  toDate: string;
  validUntil: string;
  status: "requested" | "granted" | "denied" | "revoked" | "expired" | "failed";
  workflow: true;
  workflowStatus: WorkflowStatus;
  transferStatus: TransferStatus;
  adapterMode: "mock" | "sandbox" | "production";
  correlationId: string;
  connectionId: string;
  accessSessionId: string;
  createdAt: string;
  updatedAt: string;
  doctorName: string;
  hospitalName: string;
  attempts: number;
  nextAttemptAt?: string;
  documentIds: string[];
  sourceIds: string[];
  error?: string;
  patientDecision?: string;
}
export const parse = <T>(schema: z.ZodType<T>, body: unknown) => {
  const result = schema.safeParse(body);
  if (!result.success) throw new Error("Invalid request fields");
  return result.data;
};
