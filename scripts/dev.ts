import { spawn } from "bun";

const api = spawn({
  cmd: ["bun", "--hot", "src/server/index.ts"],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, PORT: "3000" },
});

const web = spawn({
  cmd: ["bun", "x", "vite"],
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  api.kill();
  web.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race([api.exited, web.exited]);
shutdown();
