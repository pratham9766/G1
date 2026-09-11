import test from "node:test";
import assert from "node:assert/strict";
import { configureHostedDemo } from "../server/hosted-config";

const config = (): NodeJS.ProcessEnv => ({
  G1_HOSTED_DEMO: "true",
  NODE_ENV: "development",
  ABDM_MODE: "mock",
  CLINICAL_AI_PROVIDER: "local",
  DATA_DIR: "/demo/data",
  G1_DEMO_MASTER_KEY: "synthetic-test-secret-01234567890123456789",
  RENDER_EXTERNAL_URL: "https://demo.onrender.com",
});

test("hosted demo derives stable distinct vault keys and canonical HTTPS origin", () => {
  const a = config(),
    b = config();
  assert.equal(configureHostedDemo(a), "https://demo.onrender.com");
  configureHostedDemo(b);
  const keys = ["IDENTITY", "CLINICAL", "AUDIT", "LOOKUP"].map(
    (d) => a[d + "_KEY"],
  );
  assert.equal(new Set(keys).size, 4);
  for (const key of keys) assert.match(key!, /^[a-f0-9]{64}$/);
  assert.equal(a.IDENTITY_KEY, b.IDENTITY_KEY);
  assert.equal((a as Record<string, string>).G1_RUNTIME_PROFILE, "hosted-demo");
});

test("hosted demo is allowed when NODE_ENV is production if G1_HOSTED_DEMO is true and synthetic safeguards pass", () => {
  const env = { ...config(), NODE_ENV: "production" };
  assert.equal(configureHostedDemo(env), "https://demo.onrender.com");
  assert.equal((env as Record<string, string>).G1_RUNTIME_PROFILE, "hosted-demo");
  assert.equal(env.NODE_ENV, "development");
});

test("hosted demo rejects missing safeguards, insecure origins, non-mock ABDM, and external AI", () => {
  for (const change of [
    { G1_HOSTED_DEMO: "false" },
    { G1_HOSTED_DEMO: "" },
    { G1_DEMO_MASTER_KEY: "short" },
    { G1_DEMO_MASTER_KEY: "" },
    { RENDER_EXTERNAL_URL: "http://demo.onrender.com" },
    { RENDER_EXTERNAL_URL: "https://demo.onrender.com/path" },
    { ABDM_MODE: "sandbox" },
    { ABDM_MODE: "production" },
    { CLINICAL_AI_PROVIDER: "private" },
    { CLINICAL_AI_PROVIDER: "openai" },
    { DATA_DIR: "" },
    { DATABASE_URL: "postgres://example" },
  ])
    assert.throws(() => configureHostedDemo({ ...config(), ...change }));
});
