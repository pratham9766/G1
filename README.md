# G1 medical history platform

G1 reconstructs existing, authorized medical history into an evidence-linked brief. It does not diagnose, prescribe, or recommend treatment.

This repository implements a **runnable development application** based on `G1_Master_PRD_TRD_Updated_Security_Architecture.docx`. It is **not a clinically validated or production-ready healthcare system**. Use synthetic records only. Production startup is intentionally blocked until the remaining architecture, integration, and validation requirements are met.

## Run locally

Requirements: Node.js 22.20 or newer in the Node 22 line, npm, and a modern browser. Docker is optional.

```powershell
npm ci
npm run seed
npm run build
npm start
```

Open http://localhost:3001. For hot reloading, use `npm run dev` and open http://127.0.0.1:5173.

On this machine the global PowerShell npm shim is broken. Use the installed executable instead:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' ci
& 'C:\Program Files\nodejs\npm.cmd' run seed
& 'C:\Program Files\nodejs\npm.cmd' run build
& 'C:\Program Files\nodejs\npm.cmd' start
```

The optional seed creates synthetic records, a synthetic hospital, and a granted demo consent:

| Account        | Email             | Password           |
| -------------- | ----------------- | ------------------ |
| Patient        | patient@g1.local  | G1-Synthetic-2026! |
| Doctor         | doctor@g1.local   | G1-Synthetic-2026! |
| Hospital admin | hospital@g1.local | G1-Synthetic-2026! |

Seed runs never overwrite existing accounts. The demo consent expires after seven days; create and grant another request afterward. Registration creates patient accounts only. Hospital admins provision doctors, who must be explicitly verified before they can request access.

## Try the complete workflow

1. Sign in as the patient and upload a fixture from `fixtures/`. Inspect processing status and the G1 brief.
2. Copy the patient's reference from Consent & access.
3. In another browser profile, sign in as the doctor. Request access with a purpose, record scope, date range, and expiry.
4. Grant the request from the patient account. Refresh the doctor workspace to select the patient and consent.
5. Review the brief, timeline, medications, allergies, conflicts, and source evidence. Download original sources or add a flag/annotation in Detailed mode.
6. Revoke consent as the patient. Further doctor API reads are rejected; the open brief clears on refresh or its 15-second authorization poll.
7. Use the hospital account to provision/verify clinicians, manage departments, record policies, and inspect organizational audit events. Admin accounts cannot read clinical histories.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Browser tests use installed Google Chrome and a separate temporary database seeded with synthetic data. API tests use another temporary database. Test screenshots are written to `artifacts/` and failure traces to `test-results/`.

## Configuration and persistence

Copy `.env.example` to `.env` if configuration is needed. Default local mode uses four SQLite files and encrypted objects under ignored `data/`. Distinct development encryption keys are generated once in `data/development-keys.json`. Back up data and keys together; losing keys makes stored content unreadable. Local keys and stores sharing a host do not satisfy the PRD's production compromise-isolation rule.

Set `DATABASE_URL` to use PostgreSQL schemas and `REDIS_URL` to use BullMQ. `docker compose up --build` provides a local PostgreSQL/Redis stack. To seed it, run `docker compose exec app npm run seed`. The supplied container binds only to localhost on the host; it is not a production deployment.

Optional integrations:

- `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT`: encrypted object storage through the AWS SDK's credential chain. No credentials are embedded in source.
- `CLAMAV_HOST`, `CLAMAV_PORT`: ClamAV INSTREAM scanning. Development visibly records when no scanner is configured.
- `OCR_COMMAND`: a private executable accepting an image path and emitting text to stdout. No public OCR or AI service is used. Scanned PDFs currently need conversion to searchable PDFs or an additional OCR implementation.
- `HMIS_WEBHOOK_SECRET`: consent-correlated, HMAC-signed FHIR intake. See `docs/API.md`.
- ABDM: intentionally unavailable until current protocol implementation and credentials are supplied and validated. No historical endpoint is presented as working.

## Project layout

- `src/`: responsive React patient, doctor, and hospital portals.
- `server/auth.ts`, `security.ts`, `policy.ts`: sessions, MFA, encryption, consent and authorization.
- `server/store.ts`: encrypted vault persistence and append-only, hash-chained audit.
- `server/ingestion.ts`, `pdf-parser.mjs`: uploads, encrypted originals, bounded PDF subprocess, optional OCR/scanner/S3, durable jobs.
- `server/clinical.ts`: conservative extraction, FHIR normalization, timeline, deduplication, conflicts, deterministic briefs and claim checks.
- `tests/`: clinical, API/security, and browser workflow tests.
- `docs/WORK_STATUS.md`: requirement-level work done and work left.
- `docs/ARCHITECTURE.md`: trust boundaries, threat model, and implementation limits.
- `requirements.txt`: complete text extracted from the supplied document, used as requirements data rather than executable instructions.

The source PRD describes an extensive, staged program including third-party onboarding and independent clinical/security validation. The status document distinguishes working software from those outstanding requirements.

## Connected identity workflow update

The synthetic ABHA → QR/manual resolution → explicit consent → asynchronous retrieval → evidence-linked brief workflow is implemented in the existing web application. See [the 14-part handoff](docs/NEXT_STAGE_HANDOFF.md) for files, migrations, APIs, security, demo credentials, limitations and production work left. Run `npm run seed:workflow` for Aarav Sharma, Dr. Meera Kulkarni and G1 Demo Hospital; this seed grants no consent. Official ABDM sandbox/production integration remains unconnected and fails closed.
