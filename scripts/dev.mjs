import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sharedEnvironment = {
  ...process.env,
  STN_DATA_DIR: path.resolve(projectRoot, process.env.STN_DATA_DIR ?? "data"),
};

const packageBuild = spawnSync("npm", ["run", "build:packages"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: sharedEnvironment,
});

if (packageBuild.status !== 0) {
  process.exit(packageBuild.status ?? 1);
}

const commands = [
  ["server", ["run", "dev", "--workspace", "@stn/server"]],
  ["legacy", ["run", "dev", "--workspace", "@stn/legacy-host"]],
  [
    "web",
    [
      "run",
      "dev",
      "--workspace",
      "@stn/web",
      "--",
      "--port",
      "4173",
      "--strictPort",
    ],
  ],
];

const children = commands.map(([name, args]) => {
  const child = spawn("npm", args, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: sharedEnvironment,
  });

  child.stdout.on("data", (chunk) =>
    process.stdout.write(`[${name}] ${chunk}`),
  );
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[${name}] ${chunk}`),
  );
  return child;
});

function stop() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const exits = children.map(
  (child) =>
    new Promise((resolve) => {
      child.once("exit", (code) => resolve(code ?? 0));
    }),
);

const firstExit = await Promise.race(exits);
stop();
process.exitCode = Number(firstExit);
