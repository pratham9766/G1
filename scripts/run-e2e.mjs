import { spawn } from "node:child_process";
const url = "http://127.0.0.1:3100/api/v1/health";
let server, tests;
async function main() {
  if (
    await fetch(url)
      .then((r) => r.ok)
      .catch(() => false)
  )
    throw new Error(
      "Port 3100 is already in use. Stop the existing test server first.",
    );
  server = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/e2e-server.ts"],
    { stdio: "inherit", windowsHide: true },
  );
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null)
      throw new Error("Test server exited during startup");
    if (
      await fetch(url)
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Test server did not become ready");
  tests = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test"],
    { stdio: "inherit", windowsHide: true },
  );
  const code = await new Promise((resolve, reject) => {
    tests.on("error", reject);
    tests.on("exit", resolve);
  });
  server.kill();
  process.exitCode = code || 0;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    tests?.kill();
    server?.kill();
  });
main().catch((e) => {
  console.error(e.message);
  tests?.kill();
  server?.kill();
  process.exitCode = 1;
});
