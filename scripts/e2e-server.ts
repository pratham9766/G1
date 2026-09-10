import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "g1-browser-test-"));
process.env.PORT = "3100";
process.env.NODE_ENV = "test";
async function main() {
  const { seed } = await import("../server/seed");
  const { store } = await import("../server/store");
  await seed();
  await store.close();
  const { bootstrap } = await import("../server/main");
  const { stopProcessing } = await import("../server/ingestion");
  const app = await bootstrap(3100);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await stopProcessing();
      await app.close();
      await store.close();
      process.exit(0);
    });
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
