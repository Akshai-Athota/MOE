// Run a Python script with whatever Python is available, on Windows, macOS and Linux.
// Tries the project's uv environment first (has pyyaml), then python3 / python / py.
//   node scripts/run_python.mjs scripts/build_data.py
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = process.argv[2];
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const candidates = [
  ["uv", ["run", "--project", repo, "python"]],
  ["python3", []],
  ["python", []],
  ["py", ["-3"]],
];

for (const [cmd, pre] of candidates) {
  const probe = spawnSync(cmd, [...pre, "-c", "import yaml"], { stdio: "ignore", shell: false });
  if (probe.status !== 0) continue;
  const run = spawnSync(cmd, [...pre, script], { stdio: "inherit", shell: false });
  process.exit(run.status ?? 1);
}
console.error("No Python with PyYAML found. Install uv (recommended) or run: pip install pyyaml");
process.exit(1);
