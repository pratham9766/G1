import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHmac } from "node:crypto";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "g1-workflow-test-"));
process.env.NODE_ENV = "test";
process.env.ABDM_MODE = "mock";
process.env.WORKFLOW_TICK_MS = "600000";
process.env.ABDM_WEBHOOK_SECRET =
  "synthetic-webhook-signing-secret-at-least-32";
let app: any,
  store: any,
  workflow: any,
  createUser: any,
  patientUser: any,
  doctorUser: any;
const base = "http://127.0.0.1:3109/api/v1";
const password = "G1-Workflow-Demo-2026!";
class Client {
  cookies = new Map<string, string>();
  csrf = "";
  headers: Record<string, string> = {};
  async call(
    path: string,
    method = "GET",
    body?: any,
    extra: Record<string, string> = {},
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "Content-Type": "application/json",
        "X-CSRF-Token": this.csrf,
        ...this.headers,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      this.cookies.set(k, v);
    }
    const data = await r.json().catch(() => ({}));
    if (data.csrf) this.csrf = data.csrf;
    return { status: r.status, data };
  }
}
const p = new Client(),
  d = new Client();
before(async () => {
  const { bootstrap } = await import("../server/main");
  ({ store } = await import("../server/store"));
  workflow = await import("../server/workflow/service");
  ({ createUser } = await import("../server/auth"));
  app = await bootstrap(3109);
  await (await import("../server/workflow/seed")).seedWorkflow();
  const { lookup } = await import("../server/security");
  patientUser = await store.get("identity", lookup("aarav@g1.demo"));
  doctorUser = await store.get("identity", lookup("meera@g1.demo"));
  assert.equal(
    (
      await p.call("/auth/login", "POST", {
        email: patientUser.email,
        password,
      })
    ).status,
    201,
  );
  assert.equal(
    (await d.call("/auth/login", "POST", { email: doctorUser.email, password }))
      .status,
    201,
  );
});
after(async () => {
  await workflow.stopWorkflow();
  await (await import("../server/ingestion")).stopProcessing();
  await app.close();
  await store.close();
});
async function request(
  scopes = [
    "allergies",
    "medications",
    "diagnoses",
    "procedures",
    "labs",
    "discharge-summaries",
    "imaging",
    "immunizations",
    "encounters",
  ],
) {
  const identity = await p.call("/workflow/identity");
  const resolved = await d.call("/workflow/resolve", "POST", {
    qr: identity.data.qr,
  });
  assert.equal(resolved.status, 201);
  const r = await d.call("/workflow/requests", "POST", {
    accessSessionId: resolved.data.accessSessionId,
    purpose: "emergency-treatment",
    requestedScopes: scopes,
    dateFrom: "1900-01-01",
    dateTo: "2030-12-31",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(r.status, 201);
  return r.data;
}
function context(r: any) {
  d.headers = { "X-Consent-Id": r.id, "X-Purpose": r.purpose };
}
async function build(r: any) {
  assert.equal(
    (
      await p.call(`/workflow/requests/${r.id}/decision`, "POST", {
        decision: "approve",
      })
    ).status,
    201,
  );
  for (let i = 0; i < 5; i++) await workflow.workflowTick();
  return (await d.call(`/workflow/requests/${r.id}`)).data;
}
test("identity link is synthetic, QR has no ABHA/clinical data, scan returns minimal identity only", async () => {
  assert.equal(
    (await p.call("/workflow/identity")).data.status,
    "disconnected",
  );
  assert.equal(
    (
      await p.call("/workflow/identity/connect", "POST", {
        identifier: "11111111111111",
      })
    ).status,
    403,
  );
  const connected = await p.call("/workflow/identity/connect", "POST", {
    identifier: "aarav.sharma@abdm",
  });
  assert.equal(connected.status, 201);
  assert.equal(connected.data.verified, false);
  assert.equal(connected.data.verificationStatus, "MOCK_VERIFIED");
  assert.equal(connected.data.maskedABHA, "**-****-****-1234");
  assert.ok(!JSON.stringify(connected.data).includes("90000000001234"));
  const decoded = Buffer.from(
    connected.data.qr.split(":")[1].split(".")[0],
    "base64url",
  ).toString();
  assert.ok(!/900000|allergy|medication|Sharma|abdm/.test(decoded));
  const resolved = await d.call("/workflow/resolve", "POST", {
    qr: connected.data.qr,
  });
  assert.equal(resolved.status, 201);
  assert.deepEqual(
    Object.keys(resolved.data).sort(),
    [
      "accessSessionId",
      "identityStatus",
      "maskedABHA",
      "mode",
      "name",
      "verificationStatus",
    ].sort(),
  );
  assert.equal(
    (await d.call(`/patients/${patientUser.patientId}/brief`)).status,
    403,
  );
  assert.equal((await p.call("/records")).data.length, 0);
});
test("invalid, tampered and external QR payloads fail closed", async () => {
  for (const qr of [
    "https://evil.example/identity",
    '{"medications":["bad"]}',
    "g1id:bad.signature",
  ])
    assert.equal(
      (await d.call("/workflow/resolve", "POST", { qr })).status,
      400,
    );
  const identity = (await p.call("/workflow/identity")).data;
  assert.equal(
    (await d.call("/workflow/resolve", "POST", { qr: identity.qr + "x" }))
      .status,
    400,
  );
});
test("fake doctor and unverified hospital cannot resolve or request records", async () => {
  const fake = await createUser(
    "fake@g1.test",
    password,
    "Fake doctor",
    "doctor",
    doctorUser.tenant,
    { verified: false },
  );
  const c = new Client();
  await c.call("/auth/login", "POST", { email: fake.email, password });
  assert.equal(
    (
      await c.call("/workflow/resolve", "POST", {
        identifier: "aarav.sharma@abdm",
      })
    ).status,
    403,
  );
  const hospital = await store.get("identity", doctorUser.tenant);
  hospital.verified = false;
  await store.put("identity", hospital);
  assert.equal(
    (
      await d.call("/workflow/resolve", "POST", {
        identifier: "aarav.sharma@abdm",
      })
    ).status,
    403,
  );
  hospital.verified = true;
  await store.put("identity", hospital);
});
test("complete QR → explicit consent → asynchronous retrieval → brief → evidence flow", async () => {
  const r = await request();
  context(r);
  assert.equal(r.status, "PENDING");
  assert.equal((await d.call(`/patients/${r.patientId}/brief`)).status, 403);
  await workflow.workflowTick();
  assert.equal(
    (await d.call(`/workflow/requests/${r.id}`)).data.transferStatus,
    "WAITING_FOR_PATIENT",
  );
  const final = await build(r);
  assert.equal(final.transferStatus, "READY");
  assert.ok(final.lastSuccessfulSync);
  const brief = await d.call(`/patients/${r.patientId}/brief`);
  assert.equal(brief.status, 200);
  assert.ok(brief.data.facts.length >= 10);
  assert.ok(brief.data.facts.some((f: any) => f.type === "immunization"));
  assert.ok(
    brief.data.conflicts.some((c: any) =>
      c.description.includes("Blood group"),
    ),
  );
  assert.ok(brief.data.facts.every((f: any) => f.evidence.length > 0));
  const f = brief.data.facts[0];
  assert.equal((await d.call(`/facts/${f.id}/evidence`)).status, 200);
  assert.equal(
    (
      await d.call(`/doctors/${doctorUser.id}/annotations`, "POST", {
        patientId: r.patientId,
        factId: f.id,
        note: "Synthetic source review note",
        type: "annotation",
      })
    ).status,
    201,
  );
  assert.ok(
    (await p.call("/audit/me")).data.some(
      (e: any) => e.action === "qr.scanned",
    ),
  );
  assert.ok(
    (await p.call("/audit/me")).data.some(
      (e: any) => e.action === "data.retrieved",
    ),
  );
});
test("allergy-only grant excludes medication/lab facts and out-of-scope original sources", async () => {
  const r = await request(["allergies"]);
  context(r);
  await build(r);
  const brief = await d.call(`/patients/${r.patientId}/brief`);
  assert.equal(brief.status, 200);
  assert.ok(brief.data.facts.length > 0);
  assert.ok(brief.data.facts.every((f: any) => f.type === "allergy"));
  const all = await store.list("clinical", "fact", { owner: r.patientId });
  const medication = all.find((f: any) => f.type === "medication");
  assert.equal((await d.call(`/facts/${medication.id}/evidence`)).status, 403);
  assert.equal(
    (await d.call(`/documents/${medication.evidence[0].documentId}/source`))
      .status,
    403,
  );
});
test("doctor B cannot use doctor A patient resolution session or consent", async () => {
  const user = await createUser(
    "doctor-b@g1.test",
    password,
    "Doctor B",
    "doctor",
    doctorUser.tenant,
    { verified: true },
  );
  const other = new Client();
  await other.call("/auth/login", "POST", { email: user.email, password });
  const resolved = (
    await d.call("/workflow/resolve", "POST", {
      identifier: "aarav.sharma@abdm",
    })
  ).data;
  assert.equal(
    (
      await other.call("/workflow/requests", "POST", {
        accessSessionId: resolved.accessSessionId,
        purpose: "treatment",
        requestedScopes: ["allergies"],
        dateFrom: "2020-01-01",
        dateTo: "2030-01-01",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      })
    ).status,
    403,
  );
  const r = await request();
  context(r);
  await build(r);
  other.headers = d.headers;
  assert.equal(
    (await other.call(`/patients/${r.patientId}/brief`)).status,
    403,
  );
  assert.equal((await other.call(`/workflow/requests/${r.id}`)).status, 404);
});
test("denial, expiry and revocation reject every protected read server-side", async () => {
  const denied = await request();
  context(denied);
  await p.call(`/workflow/requests/${denied.id}/decision`, "POST", {
    decision: "deny",
  });
  assert.equal(
    (await d.call(`/patients/${denied.patientId}/brief`)).status,
    403,
  );
  assert.equal(
    (
      await p.call(`/workflow/requests/${denied.id}/decision`, "POST", {
        decision: "approve",
      })
    ).status,
    400,
  );
  const expired = await request();
  context(expired);
  await build(expired);
  const saved = await store.get("consent", expired.id);
  saved.validUntil = new Date(Date.now() - 1).toISOString();
  await store.put("consent", saved);
  assert.equal(
    (await d.call(`/patients/${expired.patientId}/brief`)).status,
    403,
  );
  await workflow.workflowTick();
  assert.equal(
    (await d.call(`/workflow/requests/${expired.id}`)).data.status,
    "EXPIRED",
  );
  const revoked = await request();
  context(revoked);
  await build(revoked);
  const before = await d.call(`/patients/${revoked.patientId}/brief`);
  await p.call(`/workflow/requests/${revoked.id}/decision`, "POST", {
    decision: "revoke",
  });
  const fact = before.data.facts[0];
  assert.equal((await d.call(`/facts/${fact.id}/evidence`)).status, 403);
  assert.equal(
    (await d.call(`/documents/${fact.evidence[0].documentId}/source`)).status,
    403,
  );
});
test("signed webhook authentication, duplicate detection and approval forgery rejection", async () => {
  const r = await request();
  const event = {
    id: randomUUID(),
    requestId: r.id,
    correlationId: (await store.get("consent", r.id)).correlationId,
    type: "consent.approved",
    timestamp: new Date().toISOString(),
  };
  const send = async (e: any, signatureOverride?: string) => {
    const timestamp = String(Date.now()),
      raw = JSON.stringify(e);
    const signature =
      signatureOverride ||
      createHmac("sha256", process.env.ABDM_WEBHOOK_SECRET!)
        .update(timestamp + "." + raw)
        .digest("hex");
    return d.call("/integrations/abdm/callback", "POST", e, {
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    });
  };
  assert.equal((await send(event, "0".repeat(64))).status, 403);
  assert.equal((await send(event)).status, 403);
  await p.call(`/workflow/requests/${r.id}/decision`, "POST", {
    decision: "approve",
  });
  assert.equal((await send(event)).status, 201);
  assert.equal((await send(event)).data.duplicate, true);
  assert.equal(
    (await send({ ...event, id: randomUUID(), correlationId: randomUUID() }))
      .status,
    403,
  );
});
test("malformed provider response/retrieval outage persist failure without fresh data claims", async () => {
  for (const failure of ["malformed", "retrieval"]) {
    const r = await request();
    process.env.ABDM_MOCK_FAILURE = failure;
    await p.call(`/workflow/requests/${r.id}/decision`, "POST", {
      decision: "approve",
    });
    await workflow.workflowTick();
    for (let i = 0; i < 3; i++) {
      const saved = await store.get("consent", r.id);
      saved.nextAttemptAt = undefined;
      await store.put("consent", saved);
      await workflow.workflowTick();
    }
    const failed = (await d.call(`/workflow/requests/${r.id}`)).data;
    assert.equal(failed.transferStatus, "FAILED");
    assert.equal(failed.lastSuccessfulSync, null);
    assert.match(failed.error, /temporarily unavailable/);
    delete process.env.ABDM_MOCK_FAILURE;
  }
});
test("AI failure retains authorized source-linked fallback and low-confidence labels", async () => {
  const r = await request();
  context(r);
  await build(r);
  process.env.CLINICAL_AI_PROVIDER = "mock";
  process.env.CLINICAL_AI_MOCK_FAILURE = "true";
  const response = await d.call(`/patients/${r.patientId}/brief`);
  assert.equal(response.status, 200);
  assert.equal(response.data.summaryStatus, "fallback");
  assert.ok(response.data.records.length);
  assert.ok(response.data.facts.some((f: any) => f.confidence < 0.85));
  delete process.env.CLINICAL_AI_MOCK_FAILURE;
  delete process.env.CLINICAL_AI_PROVIDER;
});
test("sandbox mode never silently falls back to mock and invalidates old mock clinical access", async () => {
  const r = await request();
  context(r);
  await build(r);
  process.env.ABDM_MODE = "sandbox";
  assert.equal(
    (await p.call("/workflow/identity/refresh", "POST")).status,
    503,
  );
  assert.equal((await d.call(`/patients/${r.patientId}/brief`)).status, 403);
  process.env.ABDM_MODE = "mock";
});

test("unverifiable consent status denies protected data", async () => {
  const r = await request();
  context(r);
  await build(r);
  process.env.ABDM_MOCK_FAILURE = "consent-status";
  try {
    assert.equal((await d.call(`/patients/${r.patientId}/brief`)).status, 403);
  } finally {
    delete process.env.ABDM_MOCK_FAILURE;
  }
});
