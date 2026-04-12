import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = __dirname;
const gitDir = path.join(repoRoot, ".git");
const huskyEntry = path.join(repoRoot, "node_modules", "husky", "bin.js");

if (!existsSync(gitDir)) {
  process.exit(0);
}

if (!existsSync(huskyEntry)) {
  console.warn("Skipping Husky install because the local husky package is missing.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [huskyEntry], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error("Failed to run Husky during prepare.", result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
