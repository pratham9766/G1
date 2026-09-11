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
});
test("hosted demo rejects missing secrets, insecure origin and real integration modes", () => {
  for (const change of [
    { G1_DEMO_MASTER_KEY: "short" },
    { RENDER_EXTERNAL_URL: "http://demo.onrender.com" },
    { RENDER_EXTERNAL_URL: "https://demo.onrender.com/path" },
    { ABDM_MODE: "production" },
    { NODE_ENV: "production" },
    { CLINICAL_AI_PROVIDER: "private" },
    { DATA_DIR: "" },
    { DATABASE_URL: "postgres://example" },
  ])
    assert.throws(() => configureHostedDemo({ ...config(), ...change }));
});
