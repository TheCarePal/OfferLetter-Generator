import { spawn } from "node:child_process";

const argumentsForEmulator = [
  "emulators:exec",
  "--only", "firestore,storage",
  "--project", "demo-carepal-document-archives",
  "node node_modules/vitest/vitest.mjs run tests/firebase/archive-rules.test.ts",
];
// A local pinned CLI can be supplied for offline use. Otherwise Corepack uses
// the pinned CLI through pnpm's download cache; no global install is required.
const localCli = process.env.FIREBASE_CLI_PATH;
const executable = localCli ? process.execPath : "corepack";
const args = localCli ? [localCli, ...argumentsForEmulator] : ["pnpm", "dlx", "firebase-tools@15.28.1", ...argumentsForEmulator];
const child = spawn(executable, args, {
  stdio: "inherit",
  env: { ...process.env, DEBUG: "", FIREBASE_RULES_TESTS: "true" },
});
child.on("error", (error) => {
  console.error(`Unable to start Firebase rules tests: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
