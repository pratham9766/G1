# Development operations and production prerequisites

## Local maintenance

- Keep Node and locked dependencies updated. Run `npm audit`, the complete test suite and a fresh build after changes.
- Store files live under `DATA_DIR`. Do not commit keys, databases, uploaded records, `.env` files or generated screenshots containing real information.
- Before a local backup, stop the application so SQLite WAL and object files are consistent. Copy the whole data directory, including its keys, into an access-controlled encrypted backup. Restart and test restore into an isolated directory before relying on it.
- A failed record remains visible with retry/error state. A queued local job survives restart. Redis mode uses durable BullMQ jobs with three exponential-backoff attempts.
- If a source hash does not match, source delivery fails. Investigate the storage boundary; do not replace the stored hash merely to silence the error.
- For an account compromise, disable the clinician from the hospital portal or revoke owned sessions. Patients can revoke grants immediately. Preserve audit evidence before further remediation.

## Production work before any real data

1. Provision separate India-region environments and private networks, a hardened ingress gateway, TLS and service identities.
2. Replace shared local vault-key access with KMS/HSM-backed, scoped envelope keys and independently authorized identity and clinical services.
3. Use separate least-privilege database roles and storage credentials. Prevent audit UPDATE/DELETE at the database and archive external chain checkpoints/WORM objects.
4. Run untrusted parsers/OCR with network disabled, read-only filesystems, narrowly mounted input/output, CPU/memory limits and mandatory malware scanning.
5. Add structured PHI-free telemetry, distributed rate limiting, bulk-access alerts, operational dashboards and incident escalation.
6. Implement retention/holds/deletion according to reviewed policy, including derived facts, original sources, caches and backup retention.
7. Validate disaster recovery, restoration, key rotation and revocation procedures in staging.
8. Complete ABDM/professional/facility onboarding, clinical benchmarks, independent VAPT and applicable approvals.

The provided Docker/Compose files are development infrastructure. They intentionally do not imply that these production controls have been deployed.
