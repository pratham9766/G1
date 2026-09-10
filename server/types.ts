export type Role = "patient" | "doctor" | "hospital";
export type RecordType =
  "discharge" | "prescription" | "diagnostic" | "laboratory" | "hospital";
export type FactType =
  | "allergy"
  | "medication"
  | "condition"
  | "procedure"
  | "implant"
  | "hospitalization"
  | "observation";
export interface Entity {
  id: string;
  owner: string;
  tenant: string;
  kind: string;
  [key: string]: any;
}
export interface User extends Entity {
  role: Role;
  email: string;
  name: string;
  password: string;
  patientId?: string;
  verified: boolean;
  department?: string;
  professionalRef?: string;
  disabled?: boolean;
}
export interface Consent extends Entity {
  patientId: string;
  doctorId: string;
  purpose: string;
  scope: RecordType[];
  fromDate: string;
  toDate: string;
  validUntil: string;
  status: "requested" | "granted" | "denied" | "revoked";
  createdAt: string;
}
export interface Evidence {
  documentId: string;
  page?: number;
  section?: string;
  path?: string;
  span: string;
  sourceHash: string;
}
export interface Fact extends Entity {
  patientId: string;
  type: FactType;
  label: string;
  value: string;
  status:
    | "present"
    | "absent"
    | "historical"
    | "suspected"
    | "family-history"
    | "ruled-out";
  certainty: "source-stated" | "uncertain";
  effectiveDate: string;
  confidence: number;
  evidence: Evidence[];
  code?: string;
  dose?: string;
}
export interface MedicalDocument extends Entity {
  patientId: string;
  name: string;
  mime: string;
  recordType: RecordType;
  recordDate: string;
  hash: string;
  receivedAt: string;
  status: "queued" | "processing" | "completed" | "failed" | "deleting";
  attempts: number;
  error?: string;
  storageKey: string;
  extractor?: string;
}
export const RECORD_TYPES: RecordType[] = [
  "discharge",
  "prescription",
  "diagnostic",
  "laboratory",
  "hospital",
];
export const PURPOSES = ["care-management", "emergency-history", "follow-up"];
