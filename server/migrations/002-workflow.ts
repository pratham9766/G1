export const workflowTables: Record<string, Record<string, string>> = {
  identity: {
    abhaConnection: "abha_connections",
    doctorVerification: "doctor_verifications",
    hospitalVerification: "hospital_verifications",
  },
  consent: {
    consent: "consent_requests",
    consentGrant: "consent_grants",
    accessSession: "access_sessions",
    webhookEvent: "webhook_events",
  },
  clinical: {
    document: "health_records",
    healthRecordSource: "health_record_sources",
    fact: "clinical_entities",
    conflict: "clinical_conflicts",
    emergencyBrief: "emergency_briefs",
    evidenceReference: "evidence_references",
    annotation: "clinical_notes",
  },
};
export function migrationStatements(domain: string, postgres: boolean) {
  const p = postgres ? domain + "." : "";
  return [
    `CREATE TABLE IF NOT EXISTS ${p}schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL)`,
    ...Object.values(workflowTables[domain] || {}).flatMap((t) => [
      `CREATE TABLE IF NOT EXISTS ${p}${t}(id TEXT PRIMARY KEY REFERENCES ${p}entities(id) ON DELETE CASCADE, owner_ref TEXT NOT NULL,tenant_ref TEXT NOT NULL,parent_id TEXT REFERENCES ${p}entities(id) ON DELETE CASCADE,created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS ${t}_owner_tenant ON ${p}${t}(owner_ref,tenant_ref)`,
      `CREATE INDEX IF NOT EXISTS ${t}_parent ON ${p}${t}(parent_id)`,
    ]),
    `INSERT INTO ${p}schema_migrations(version,applied_at) VALUES('002-workflow','2026-09-10T00:00:00Z') ON CONFLICT(version) DO NOTHING`,
  ];
}
