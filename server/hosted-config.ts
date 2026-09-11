import { createHmac } from "node:crypto";
export function configureHostedDemo(env: NodeJS.ProcessEnv = process.env) {
  if (env.G1_HOSTED_DEMO !== "true")
    throw new Error("Hosted demo mode must be explicit");
  if (env.ABDM_MODE !== "mock" || env.CLINICAL_AI_PROVIDER !== "local")
    throw new Error(
      "Hosted demo requires mock ABDM and local clinical processing",
    );
  const secret = env.G1_DEMO_MASTER_KEY || "";
  if (secret.length < 32)
    throw new Error(
      "Configure a stable demo master secret of at least 32 characters",
    );
  const url = new URL(env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Hosted demo requires a canonical HTTPS origin");
  if (!env.DATA_DIR) throw new Error("Configure the persistent data directory");
  if (env.DATABASE_URL || env.REDIS_URL || env.S3_BUCKET)
    throw new Error(
      "This demo profile uses one instance with a persistent local disk",
    );
  env.APP_ORIGIN = url.origin;
  env.G1_RUNTIME_PROFILE = "hosted-demo";
  env.NODE_ENV = "development";
  for (const domain of ["IDENTITY", "CLINICAL", "AUDIT", "LOOKUP"])
    env[domain + "_KEY"] = createHmac("sha256", secret)
      .update("g1-hosted-demo-v1:" + domain)
      .digest("hex");
  return url.origin;
}
