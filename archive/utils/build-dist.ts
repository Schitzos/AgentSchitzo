import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { minify } = require("uglify-js") as {
  minify: (
    code: string,
    options?: Record<string, unknown>
  ) => { code?: string; error?: Error };
};

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
const tscCliPath = path.resolve(
  thisFileDir,
  "..",
  "node_modules",
  "typescript",
  "bin",
  "tsc"
);

async function ensureDistDir() {
  await mkdir(distDir, { recursive: true });
}

function runTypeScriptBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tscCliPath, "-p", "tsconfig.build.json"], {
      cwd: rootDir,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`TypeScript build exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function rewriteRootAliasImports(currentDir = distDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await rewriteRootAliasImports(entryPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }

    const source = await readFile(entryPath, "utf8");
    const rewritten = source.replaceAll(
      /(["'])@root\/([^"'`]+)\1/g,
      (_match, quote, importPath) => {
        const emittedTarget = path.join(distDir, importPath).replace(/\.ts$/, ".js");
        const relativeImport = path
          .relative(path.dirname(entryPath), emittedTarget)
          .split(path.sep)
          .join("/");
        const normalizedImport = relativeImport.startsWith(".")
          ? relativeImport
          : `./${relativeImport}`;
        return `${quote}${normalizedImport}${quote}`;
      }
    );

    if (rewritten !== source) {
      await writeFile(entryPath, rewritten, "utf8");
    }
  }
}

async function minifyDistFiles(currentDir = distDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await minifyDistFiles(entryPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }

    const source = await readFile(entryPath, "utf8");
    const result = minify(source, {
      compress: true,
      mangle: true,
      output: {
        comments: false
      }
    });

    if (result.error != null) {
      throw new Error(`Failed to uglify ${entryPath}: ${result.error.message}`);
    }

    if (result.code != null && result.code !== source) {
      await writeFile(entryPath, result.code, "utf8");
    }
  }
}

async function writeDistManifest() {
  const manifest = {
    name: "agentschitzo-dist",
    version: "1.0.0",
    private: true,
    description: "Built runtime output for AgentSchitzo.",
    type: "module",
    main: "telegram-listener.js",
    scripts: {
      start: "node telegram-listener.js"
    },
    dependencies: {
      openai: "^6.34.0"
    }
  };

  await writeFile(
    path.join(distDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  await ensureDistDir();
  await runTypeScriptBuild();
  await rewriteRootAliasImports();
  await minifyDistFiles();
  await writeDistManifest();
}

main().catch((error) => {
  console.error("Failed to build dist output.");
  console.error(error);
  process.exitCode = 1;
});
