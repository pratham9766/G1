# Connected identity and consent workflow handoff

Implemented September 10, 2026. The existing React web application, NestJS API, authentication, encrypted vaults, roles and visual structure are preserved. This is a runnable synthetic development implementation, not a live ABDM integration or a medically validated system. No mobile application, autonomous diagnosis, prescribing, payments or unrestricted break-glass access was added.

## 1. Files created

- `server/workflow/{scopes,models,trust,adapters,ai,qr,service,controller,seed,normalization}.ts`: workflow contracts, trust, adapters, orchestration, routes and synthetic seed.
- `server/migrations/002-workflow.ts`, `scripts/migrate.ts`: additive schema migration.
- `server/audit-context.ts`: request-scoped audit metadata.
- `src/workflow.tsx`, `src/workflow.css`: connected identity, scanner, consent and live progress components.
- `fixtures/abdm/synthetic-records.json`: synthetic provider envelopes.
- `tests/workflow.test.ts`, `tests/browser/workflow.spec.ts`: API and browser workflow coverage.
- This handoff document.

## 2. Files modified

`package.json`, `package-lock.json`, `.env.example`, `README.md`, `docs/WORK_STATUS.md`, `server/types.ts`, `server/store.ts`, `server/policy.ts`, `server/main.ts`, `server/controller.ts`, `server/clinical.ts`, `server/ingestion.ts`, `server/seed.ts`, `src/main.tsx`, `tests/api.test.ts`, `tests/browser/flows.spec.ts`, and `scripts/e2e-server.ts`.

## 3. Database migrations

Run `npm run migrate`; startup also applies migration 002 idempotently. Existing encrypted entities and IDs are preserved. Back up the data directory and keys before migrating valuable local data.

Identity vault projections: `abha_connections`, `doctor_verifications`, `hospital_verifications`. Consent vault: `consent_requests`, `consent_grants`, `access_sessions`, `webhook_events`. Clinical vault: `health_records`, `health_record_sources`, `clinical_entities`, `clinical_conflicts`, `emergency_briefs`, `evidence_references`, `clinical_notes`. Existing append-only, hash-chained audit storage retains audit events.

Projection rows have primary keys, foreign keys to their same-vault encrypted entity and optional parent, plus owner/tenant and parent indexes. SQLite foreign keys are enabled; PostgreSQL statements use separate domain schemas. Cross-vault relationships remain application-validated to preserve separation. New workflow resources use UUIDs; legacy deterministic opaque fact IDs are preserved, with no sequential public identifiers. These are indexed projections over encrypted payloads, not a complete normalized transactional redesign. Multi-vault atomicity and multi-replica coordination remain production work.

## 4. New APIs

All paths below are under `/api/v1/workflow`:

| Method    | Path                     | Purpose                                      |
| --------- | ------------------------ | -------------------------------------------- |
| GET       | `/health`                | Adapter mode and availability                |
| GET       | `/identity`              | Patient's masked connection and identity QR  |
| POST      | `/identity/connect`      | Verify and connect assigned identity         |
| POST      | `/identity/refresh`      | Refresh verification                         |
| DELETE    | `/identity`              | Disconnect and revoke related grants         |
| POST      | `/resolve`               | Trusted doctor resolves QR/manual identifier |
| GET       | `/trust`                 | Current doctor/facility trust result         |
| GET, POST | `/requests`              | List own requests or create scoped request   |
| GET       | `/requests/:id`          | Authorized request status                    |
| POST      | `/requests/:id/decision` | Patient approve, deny or revoke              |
| POST      | `/requests/:id/retry`    | Retry retrieval under valid approval         |
| GET       | `/events`                | Authenticated SSE workflow state             |
| GET       | `/recent-access`         | Patient-visible access summary               |

`POST /api/v1/integrations/abdm/callback` validates signed mock events. Existing brief, timeline, conflicts, facts/evidence, documents and annotation APIs enforce workflow scope and current consent on every protected read/write. Existing routes remain available.

## 5. UI routes and components

The app retains its existing workspace navigation rather than introducing a new router. Patient Overview gains Connected Health Identity and Recent Access. Doctor navigation gains Scan patient and the primary Scan Patient ABHA QR action. Existing Consent & access includes live connected-health requests. Existing brief gains retrieval/source metadata, information categories, clinical notes and live revocation clearing.

Components include `IdentityCard`, `ScanPatient`, `WorkflowConsents`, `ConsentCard`, `RecentAccess`, and `useWorkflowFeed`. Camera scanning, local PNG/JPEG decoding, manual ABHA entry and pasted G1 QR fallback are supported. Permission-denial and error states are visible. QR dialogs use native dialog behavior. Scope checkboxes are initially unchecked.

## 6. ABDM adapter architecture

`ABDMAdapter` defines verifyABHA, resolveABHA, createConsentRequest, getConsentStatus, fetchHealthInformation, revokeConsent and handleWebhook. `MockABDMAdapter` alone reads synthetic fixture envelopes. `SandboxABDMAdapter` and `ProductionABDMAdapter` deliberately reject unavailable operations; selecting either never silently falls back to mock.

The signed G1 QR contains only version/type, connection UUID, nonce and expiry. It contains no clinical data or full ABHA. It is a custom identity/consent-initiation format, clearly marked as such. It does not recreate an official ABHA card. Official ABHA QR interoperability and the official patient-scans-facility Scan & Share workflow have not been implemented or certified.

## 7. Consent flow

Connect synthetic identity → scan/resolve → doctor-bound 15-minute access session → purpose, explicit categories, date window and expiry (maximum 24 hours) → request sent → waiting for explicit patient decision → approved → data requested → data received → processing → ready.

Denial, expiry, disconnect and revocation remove protected access. Signed webhook approval cannot substitute for explicit patient approval. Terminal consent history cannot be revived by delayed events. Persisted correlation IDs and transfer states support retries; three failed attempts produce a visible failure and no fresh-sync claim. Patient and doctor receive state-only SSE updates; clinical records are fetched through protected APIs.

## 8. Security and privacy

Preserved encrypted identity/clinical storage, encrypted original objects, rotating opaque sessions, TOTP support, CSRF protection, CORS restrictions, secure headers, rate limits, validation, provenance requirements and audit integrity. Added live doctor/facility/account trust checks, doctor-bound resolution sessions, granular information scope/date enforcement and identity-adapter checks.

Real mixed original documents require broad enough consent to avoid leaking excluded categories. Synthetic scope-tagged envelopes may be downloaded only within their complete scope. Evidence and annotations remain patient/doctor/consent-bound. Unverifiable consent fails closed. HMAC callbacks require a configured secret, timestamp window, schema/correlation validation, event ID/body-hash duplicate checks. Audit events include actor role, resource, purpose, timestamp and available request IP/device/session context; normal accounts cannot mutate them. No public AI integration or health-data training was added.

## 9. Tests added and validation

Workflow API tests cover invalid/tampered QR, identity-only preview, fake/unverified doctor and hospital, explicit approval, restricted scope/originals, cross-doctor session and grant IDOR, denial/expiry/revocation, signed/duplicate/forged webhooks, malformed provider transfer, retrieval failure, AI fallback, low-confidence facts, provenance and sandbox fail-closed behavior. An additional test explicitly covers unavailable consent verification.

Browser tests use separate patient/doctor sessions, decode the displayed QR PNG, grant consent, wait for SSE retrieval, open the evidence-linked brief and revoke access live. Camera permission failure is tested. Existing patient, clinician, hospital and responsive-layout regressions remain. Build/typecheck and automated test results are reported in the final delivery; generated screenshots are in `artifacts/`.

## 10. Environment variables

Existing settings remain documented in `.env.example` and operations docs. New settings:

| Variable                   | Default / use                                              |
| -------------------------- | ---------------------------------------------------------- |
| `ABDM_MODE`                | `mock`; `sandbox` and `production` remain unavailable      |
| `CLINICAL_AI_PROVIDER`     | `local`; deterministic source-bound summary                |
| `WORKFLOW_TICK_MS`         | `1000`; background progress interval                       |
| `ABDM_WEBHOOK_SECRET`      | Required for signed mock callbacks, at least 32 characters |
| `ABDM_MOCK_FAILURE`        | Test only: `retrieval`, `malformed`, `consent-status`      |
| `CLINICAL_AI_MOCK_FAILURE` | Test only: `true`, with provider `mock`                    |

Private AI is an unconfigured interface; public providers are disabled. Existing distinct encryption keys, data directory, origin and optional PostgreSQL/Redis/S3/ClamAV/OCR settings remain applicable. Production startup remains blocked.

## 11. Mock demo credentials and walkthrough

Run `npm ci`, `npm run migrate`, `npm run seed:workflow`, `npm run build`, then `npm start`. Open `http://localhost:3001`. On this Windows machine use `& 'C:\Program Files\nodejs\npm.cmd'` instead of the broken global PowerShell npm shim.

| Role                   | Account         | Password                 |
| ---------------------- | --------------- | ------------------------ |
| Aarav Sharma           | `aarav@g1.demo` | `G1-Workflow-Demo-2026!` |
| Dr. Meera Kulkarni     | `meera@g1.demo` | `G1-Workflow-Demo-2026!` |
| G1 Demo Hospital admin | `admin@g1.demo` | `G1-Workflow-Demo-2026!` |

The seed is idempotent and creates no pre-approved consent or patient records. Connect `aarav.sharma@abdm` as the patient. In a separate browser profile sign in as the doctor, scan/upload the patient's G1 QR or enter the address. Choose Complete available history and the desired categories, then submit. Grant from the patient's Consent & access screen. Doctor progress updates automatically; open the brief and evidence, then revoke from the patient screen to demonstrate access removal. These identities and records are synthetic, not verified by NHA.

## 12. Features still mocked or limited

ABHA ownership/verification, HPR/HFR trust, consent-manager/HIP transport and provider records are synthetic. Official callbacks, authentication and cryptographic transfer protocols are not connected. Local extraction is conservative and rule-based; private AI is unconfigured. Terminology normalization does not invent SNOMED/LOINC codes. Clinical conflicts are flagged, never resolved automatically. Actual camera hardware, PostgreSQL, Redis, S3, external OCR and antivirus require environment-specific validation beyond the local browser/SQLite tests.

## 13. Production blockers / work left

Official sandbox onboarding, current protocol contracts, ownership OTP/verification, HPR/HFR verification, interoperable QR and HIP transfer integration; external KMS/secrets/rotation, operational infrastructure, transactional outbox and durable multi-replica locks; load/security testing, disaster recovery and monitoring; robust diverse-document extraction and terminology services; clinician-led accuracy/safety validation and applicable governance review. Legacy opaque IDs and projection schema need a planned migration if universal UUID storage is required. No real patient production use is authorized by this implementation.

## 14. Next recommended phase

Connect and test one official ABDM sandbox identity/consent/HIP vertical slice behind the existing adapter contract, using sandbox identities. Add protocol contract tests, signed-transfer validation and replay/race tests, then strengthen transactional persistence and deployment infrastructure. Clinical validation follows with a governed representative dataset before any real patient rollout.

Validation completed: TypeScript/Vite build passed; 28 API/clinical tests passed; 6 Chrome browser tests passed; formatting check passed. Local additive migration 002 and the workflow demo seed completed successfully.
