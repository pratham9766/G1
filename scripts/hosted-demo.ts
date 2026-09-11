import "dotenv/config";
import { configureHostedDemo } from "../server/hosted-config";
process.env.G1_RUNTIME_PROFILE = "hosted-demo";
async function main() {
  configureHostedDemo();
  const { bootstrap } = await import("../server/main");
  const app = await bootstrap();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await (await import("../server/workflow/service")).stopWorkflow();
      await (await import("../server/ingestion")).stopProcessing();
      await app.close();
      await (await import("../server/store")).store.close();
      process.exit(0);
    });
}
main().catch((err) => {
  console.error(
    "Hosted demo startup failed. Verify HTTPS origin, persistent disk, stable master key and mock/local mode configuration.",
    err,
  );
  process.exitCode = 1;
});
