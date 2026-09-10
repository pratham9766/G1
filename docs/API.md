# Internal API contract

All routes are under `/api/v1`. Errors use a JSON `message` with an HTTP status. Cookie-based authentication is required except health, sign-in/registration/refresh, and independently authenticated callback routes. Every mutation after sign-in requires `X-CSRF-Token`, returned by login and `/auth/me`.

For clinician clinical reads and annotations, send both `X-Consent-Id` and `X-Purpose`. The server checks role, verification, tenant affiliation, grant status, expiry, purpose and record/date scope. The client cannot assert its own role or patient ownership.

| Method       | Path                                       | Behavior                                                        |
| ------------ | ------------------------------------------ | --------------------------------------------------------------- |
| POST         | /auth/register                             | Patient-only registration; name, email, password                |
| POST         | /auth/login                                | Email/password and optional TOTP code                           |
| GET          | /auth/me                                   | Current safe identity and CSRF token                            |
| POST         | /auth/refresh                              | Rotate refresh token and access session                         |
| POST         | /auth/logout                               | Revoke session family                                           |
| GET / DELETE | /auth/sessions, /auth/sessions/:id         | List/revoke owned sessions                                      |
| POST         | /auth/mfa/setup, /auth/mfa/confirm         | TOTP enrollment                                                 |
| GET          | /patients                                  | Self or patients with currently active clinician grants         |
| GET          | /patients/:id/brief, /timeline, /conflicts | Scoped clinical history                                         |
| GET          | /facts/:id/evidence                        | Scoped source excerpts and hash pointers                        |
| GET          | /records                                   | Patient-owned record metadata and processing status             |
| POST         | /documents                                 | Multipart `file`, `recordType`, `recordDate`                    |
| GET          | /documents/:id/status, /source             | Authorized status/source download                               |
| POST         | /documents/:id/retry                       | Retry an owned failed record                                    |
| DELETE       | /documents/:id                             | Delete owned original and its extracted facts                   |
| GET          | /consents                                  | User-scoped consent requests and grants                         |
| POST         | /consents/requests                         | Patient UUID, purpose, scope, date range, validUntil            |
| POST         | /consents/:id/grant, /deny, /revoke        | Patient-only state transitions                                  |
| GET / PATCH  | /profile                                   | Patient profile; declarations stay separate from evidence       |
| GET          | /audit/me                                  | Patient, clinician or tenant-scoped audit events                |
| GET          | /notifications                             | Owned processing notifications                                  |
| POST         | /doctors/:id/annotations                   | Scoped flag or annotation on an existing fact                   |
| GET          | /patients/:id/annotations                  | Scoped annotations                                              |
| GET          | /hospital                                  | Organization settings, doctors, departments, audit integrity    |
| POST / PATCH | /hospital/doctors, /hospital/doctors/:id   | Provision, verify and disable tenant doctors                    |
| POST         | /hospital/departments                      | Add a tenant department                                         |
| PATCH        | /hospital/policy                           | Store retention intent, incident contact and annotation setting |
| GET          | /integrations/abdm/health                  | Honest unavailable/configuration state                          |
| POST         | /integrations/abdm/callback                | Fails closed until a validated adapter exists                   |
| POST         | /integrations/hmis/callback                | Optional signed custom FHIR intake                              |

## HMIS callback protocol

This is a G1 development connector contract, **not the ABDM callback protocol**.

Set `HMIS_WEBHOOK_SECRET` on the server and the trusted sender. The sender provides:

- `X-Timestamp`: Unix time in milliseconds; maximum five-minute clock window.
- `X-Request-Id`: unique UUID; replayed IDs are rejected.
- `X-Signature`: lowercase hexadecimal HMAC-SHA256 over `timestamp + '.' + requestId + '.' + rawRequestBody`.
- JSON body: `{ consentId, recordDate: 'YYYY-MM-DD', recordType, bundle: <FHIR Bundle> }`.

Consent must already be active and cover the supplied record type and date. The endpoint saves the encrypted original and queues extraction. Do not connect real patient data before provider-specific testing, source identity validation, callback atomicity, and clinical/security review.

Supported record types: discharge, prescription, diagnostic, laboratory, hospital. Internal purposes: care-management, emergency-history, follow-up. These internal strings are not claimed to be current ABDM purpose codes.
