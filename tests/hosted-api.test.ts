import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureHostedDemo } from "../server/hosted-config";
test("hosted demo boots, seeds, sets secure cookies and rejects external writes", async () => {
  Object.assign(process.env, {
    G1_HOSTED_DEMO: "true",
    NODE_ENV: "test",
    ABDM_MODE: "mock",
    CLINICAL_AI_PROVIDER: "local",
    DATA_DIR: mkdtempSync(join(tmpdir(), "g1-hosted-test-")),
    G1_DEMO_MASTER_KEY: "synthetic-hosted-test-secret-0123456789",
    APP_ORIGIN: "https://demo.onrender.com",
    WORKFLOW_TICK_MS: "600000",
  });
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
  delete process.env.S3_BUCKET;
  configureHostedDemo();
  const { bootstrap } = await import("../server/main");
  const app = await bootstrap(3112);
  const base = "http://127.0.0.1:3112/api/v1";
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal(
      existsSync(join(process.env.DATA_DIR!, "development-keys.json")),
      false,
    );
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://demo.onrender.com",
        "X-Forwarded-For": "192.0.2.10",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        email: "aarav@g1.demo",
        password: "G1-Workflow-Demo-2026!",
      }),
    });
    assert.equal(login.status, 201);
    assert.ok(login.headers.getSetCookie().length >= 2);
    for (const cookie of login.headers.getSetCookie()) {
      assert.match(cookie, /; Secure/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
    }
    for (const path of [
      "/auth/register",
      "/AUTH/REGISTER/",
      "/documents",
      "/documents/",
      "/integrations/hmis/callback",
      "/integrations/abdm/callback",
    ])
      assert.equal((await fetch(base + path, { method: "POST" })).status, 403);
    assert.equal(
      (
        await fetch(base + "/auth/login", {
          method: "POST",
          headers: {
            Origin: "http://localhost:5173",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
  } finally {
    await (await import("../server/workflow/service")).stopWorkflow();
    await (await import("../server/ingestion")).stopProcessing();
    await app.close();
    await (await import("../server/store")).store.close();
  }
});
