import { spawn } from "node:child_process";
const children = [
  spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "watch", "server/main.ts"],
    { stdio: "inherit", windowsHide: true },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { stdio: "inherit", windowsHide: true },
  ),
];
function close() {
  children.forEach((c) => c.kill());
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
children.forEach((c) =>
  c.on("exit", (code) => {
    close();
    process.exitCode = code || 0;
  }),
);
