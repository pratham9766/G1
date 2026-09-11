import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "g1-api-test-"));
process.env.NODE_ENV = "test";
process.env.HMIS_WEBHOOK_SECRET = "synthetic-test-only-hmis-secret";
let app: any,
  store: any,
  processDocument: any,
  stopProcessing: any,
  createUser: any;
const base = "http://127.0.0.1:3099/api/v1";
class Client {
  cookies = new Map<string, string>();
  csrf = "";
  context: Record<string, string> = {};
  async call(
    path: string,
    method = "GET",
    body?: any,
    extra: Record<string, string> = {},
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "X-CSRF-Token": this.csrf,
        ...this.context,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      this.cookies.set(k, v);
    }
    const value = await res.json().catch(() => ({}));
    if (value.csrf) this.csrf = value.csrf;
    return { status: res.status, value };
  }
}
before(async () => {
  const main = await import("../server/main");
  const storage = await import("../server/store");
  store = storage.store;
  ({ processDocument, stopProcessing } = await import("../server/ingestion"));
  ({ createUser } = await import("../server/auth"));
  app = await main.bootstrap(3099);
});
after(async () => {
  await (await import("../server/workflow/service")).stopWorkflow();
  await stopProcessing();
  await app?.close();
  await store?.close();
});
test("complete patient/doctor consent, provenance, revocation and tenant isolation flow", async () => {
  const p = new Client(),
    d = new Client(),
    admin = new Client(),
    other = new Client();
  const password = "Secure-test-password-2026!";
  const registration = await p.call("/auth/register", "POST", {
    name: "Synthetic Patient",
    email: "p@test.local",
    password,
  });
  assert.equal(registration.status, 201);
  const patientId = registration.value.user.patientId;
  const tenant = randomUUID();
  await store.put("identity", {
    id: tenant,
    kind: "hospital",
    owner: tenant,
    tenant,
    verified: true,
    name: "Test Hospital",
  });
  const doctor = await createUser(
    "d@test.local",
    password,
    "Synthetic Doctor",
    "doctor",
    tenant,
    { verified: true },
  );
  await createUser("a@test.local", password, "Admin", "hospital", tenant, {
    verified: true,
  });
  await createUser(
    "o@test.local",
    password,
    "Other Doctor",
    "doctor",
    randomUUID(),
    { verified: true },
  );
  assert.equal(
    (await d.call("/auth/login", "POST", { email: "d@test.local", password }))
      .status,
    201,
  );
  await admin.call("/auth/login", "POST", { email: "a@test.local", password });
  await other.call("/auth/login", "POST", { email: "o@test.local", password });
  assert.equal((await d.call(`/patients/${patientId}/brief`)).status, 403);
  assert.equal((await admin.call(`/patients/${patientId}/brief`)).status, 403);
  const scope = {
    patientId,
    purpose: "emergency-history",
    scope: ["discharge"],
    fromDate: "2020-01-01",
    toDate: "2026-12-31",
    validUntil: new Date(Date.now() + 3600000).toISOString(),
  };
  assert.equal(
    (await d.call("/consents/requests", "POST", { ...scope, scope: [] }))
      .status,
    400,
  );
  const request = await d.call("/consents/requests", "POST", scope);
  assert.equal(request.status, 201);
  const consentId = request.value.id;
  d.context = { "X-Consent-Id": consentId, "X-Purpose": "emergency-history" };
  assert.equal((await d.call(`/patients/${patientId}/brief`)).status, 403);
  assert.equal(
    (
      await p.call(
        `/consents/${consentId}/grant`,
        "POST",
        {},
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await p.call(`/consents/${consentId}/grant`, "POST")).status,
    201,
  );
  const { ingest } = await import("../server/ingestion");
  const record = await ingest(
    patientId,
    "test.txt",
    "text/plain",
    Buffer.from("Allergy: Penicillin\nCondition: No pneumonia"),
    "discharge",
    "2026-08-12",
  );
  await processDocument(record.id);
  const hidden = await ingest(
    patientId,
    "lab.txt",
    "text/plain",
    Buffer.from("Observation: Hemoglobin 11 g/dL"),
    "laboratory",
    "2026-08-12",
  );
  await processDocument(hidden.id);
  const brief = await d.call(`/patients/${patientId}/brief`);
  assert.equal(brief.status, 200);
  assert.equal(brief.value.facts.length, 2);
  assert.ok(brief.value.facts.every((f: any) => f.evidence.length));
  const factId = brief.value.facts[0].id;
  assert.equal((await d.call(`/facts/${factId}/evidence`)).status, 200);
  assert.equal((await d.call(`/documents/${hidden.id}/source`)).status, 403);
  other.context = d.context;
  assert.equal((await other.call(`/facts/${factId}/evidence`)).status, 403);
  admin.context = d.context;
  assert.equal((await admin.call(`/patients/${patientId}/brief`)).status, 403);
  assert.equal(
    (
      await d.call(`/patients/${patientId}/brief`, "GET", undefined, {
        "X-Purpose": "follow-up",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await d.call(`/doctors/${doctor.id}/annotations`, "POST", {
        patientId,
        factId,
        note: "Verify source allergy discrepancy",
        type: "flag",
      })
    ).status,
    201,
  );
  assert.equal(
    (await p.call(`/consents/${consentId}/revoke`, "POST")).status,
    201,
  );
  assert.equal((await d.call(`/facts/${factId}/evidence`)).status, 403);
  assert.equal((await d.call(`/documents/${record.id}/source`)).status, 403);
  assert.equal((await d.call(`/patients/${patientId}/brief`)).status, 403);
  assert.equal(
    (await p.call(`/patients/${patientId}/brief`)).value.facts.length,
    3,
  );
  assert.equal((await p.call(`/documents/${record.id}`, "DELETE")).status, 200);
  assert.equal(
    (await p.call(`/patients/${patientId}/brief`)).value.facts.length,
    1,
  );
  assert.equal((await store.verifyAudit()).valid, true);
  assert.ok(
    (await p.call("/audit/me")).value.some(
      (e: any) => e.action === "access.denied",
    ),
  );
});
test("refresh rotation rejects replay and revokes successor session", async () => {
  const c = new Client();
  const r = await c.call("/auth/register", "POST", {
    name: "Token Test",
    email: "token@test.local",
    password: "Token-test-password-2026!",
  });
  assert.equal(r.status, 201);
  const old = c.cookies.get("g1_refresh")!;
  assert.equal((await c.call("/auth/refresh", "POST")).status, 201);
  const newer = c.cookies.get("g1_refresh")!;
  assert.notEqual(newer, old);
  c.cookies.set("g1_refresh", old);
  assert.equal((await c.call("/auth/refresh", "POST")).status, 401);
  assert.equal((await c.call("/auth/me")).status, 401);
});
test("registration rejects role escalation and untrusted origin", async () => {
  const c = new Client();
  assert.equal(
    (
      await c.call("/auth/register", "POST", {
        name: "Evil",
        email: "evil@test.local",
        password: "Long-enough-password!",
        role: "hospital",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await c.call(
        "/auth/register",
        "POST",
        {
          name: "Origin Test",
          email: "origin@test.local",
          password: "Long-enough-password!",
        },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
});
test("unconfigured ABDM callback fails closed", async () => {
  const c = new Client();
  assert.equal(
    (await c.call("/integrations/abdm/callback", "POST", {})).status,
    503,
  );
});
test("persistence rejects clinical facts without valid provenance", async () => {
  await assert.rejects(
    () =>
      store.put("clinical", {
        id: randomUUID(),
        kind: "fact",
        owner: "p",
        tenant: "",
        evidence: [],
      }),
    /require source evidence/,
  );
  await assert.rejects(
    () =>
      store.put("clinical", {
        id: randomUUID(),
        kind: "fact",
        owner: "p",
        tenant: "",
        evidence: [
          { documentId: "missing", sourceHash: "fake", span: "invented fact" },
        ],
      }),
    /provenance validation/,
  );
});
test("MFA enrollment, invalid-code denial, success and code replay protection", async () => {
  const c = new Client();
  const email = "mfa@test.local",
    password = "MFA-test-password-2026!";
  const r = await c.call("/auth/register", "POST", {
    name: "MFA Test",
    email,
    password,
  });
  const userId = r.value.user.id;
  assert.equal((await c.call("/auth/mfa/setup", "POST")).status, 201);
  const user = await store.get("identity", userId);
  const { totp } = await import("../server/auth");
  assert.equal(
    (await c.call("/auth/mfa/confirm", "POST", { code: "invalid" })).status,
    400,
  );
  assert.equal(
    (await c.call("/auth/mfa/confirm", "POST", { code: totp(user.pendingMfa) }))
      .status,
    201,
  );
  const fresh = await store.get("identity", userId);
  fresh.mfaLastStep = -1;
  await store.put("identity", fresh);
  const other = new Client();
  const code = totp(fresh.mfaSecret);
  assert.equal(
    (await other.call("/auth/login", "POST", { email, password })).status,
    401,
  );
  assert.equal(
    (await other.call("/auth/login", "POST", { email, password, code })).status,
    201,
  );
  assert.equal(
    (await c.call("/auth/login", "POST", { email, password, code })).status,
    401,
  );
});
test("signed HMIS callback requires active scoped consent and rejects replay", async () => {
  const client = new Client();
  const p = await createUser(
    "hmis@test.local",
    "HMIS-test-password-2026!",
    "HMIS Test",
  );
  const consentId = randomUUID();
  await store.put("consent", {
    id: consentId,
    kind: "consent",
    owner: p.patientId,
    tenant: "hmis-tenant",
    patientId: p.patientId,
    doctorId: "hmis-doctor",
    purpose: "care-management",
    scope: ["laboratory"],
    fromDate: "2026-01-01",
    toDate: "2026-12-31",
    validUntil: new Date(Date.now() + 60000).toISOString(),
    status: "granted",
    createdAt: new Date().toISOString(),
  });
  const body = {
    consentId,
    recordDate: "2026-08-12",
    recordType: "laboratory",
    bundle: {
      resourceType: "Bundle",
      entry: [
        {
          resource: {
            resourceType: "Observation",
            code: { text: "Pulse" },
            valueQuantity: { value: 72, unit: "/min" },
          },
        },
      ],
    },
  };
  const timestamp = String(Date.now()),
    id = randomUUID();
  const signature = createHmac("sha256", process.env.HMIS_WEBHOOK_SECRET!)
    .update(`${timestamp}.${id}.${JSON.stringify(body)}`)
    .digest("hex");
  const headers = {
    "X-Timestamp": timestamp,
    "X-Request-Id": id,
    "X-Signature": signature,
  };
  assert.equal(
    (
      await client.call("/integrations/hmis/callback", "POST", body, {
        "X-Signature": "bad",
      })
    ).status,
    401,
  );
  const result = await client.call(
    "/integrations/hmis/callback",
    "POST",
    body,
    headers,
  );
  assert.equal(result.status, 201);
  assert.equal(result.value.accepted, true);
  assert.equal(
    (await client.call("/integrations/hmis/callback", "POST", body, headers))
      .status,
    400,
  );
});
