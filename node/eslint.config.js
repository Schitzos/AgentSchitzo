import path from "node:path";
const nodeGlobals = {
  __dirname: "readonly",
  __filename: "readonly",
  Buffer: "readonly",
  clearImmediate: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  global: "readonly",
  process: "readonly",
  setImmediate: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly"
};

const jestGlobals = {
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  jest: "readonly",
  test: "readonly"
};

import tseslint from "typescript-eslint";

const repoRoot = path.resolve(import.meta.dirname, "..");

export default [
  {
    ignores: ["coverage/**", "dist/**", "logs/**", "node_modules/**", "archive/**"]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals
    },
    rules: {
      "no-const-assign": "error",
      "no-constant-condition": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty-pattern": "error",
      "no-import-assign": "error",
      "no-irregular-whitespace": "error",
      "no-loss-of-precision": "error",
      "no-new-symbol": "error",
      "no-obj-calls": "error",
      "no-redeclare": "error",
      "no-self-assign": "error",
      "no-shadow-restricted-names": "error",
      "no-sparse-arrays": "error",
      "no-this-before-super": "error",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-negation": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" }
      ],
      "no-useless-catch": "error",
      "valid-typeof": "error"
    }
  },
  {
    files: ["node/tests/**/*.js"],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        ...jestGlobals
      }
    }
  },
  {
    files: ["**/*.ts"],
    ignores: [
      "node/tests/**/*.ts",
      "coverage/**",
      "dist/**",
      "logs/**",
      "node_modules/**"
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repoRoot
      },
      globals: nodeGlobals
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" }
      ]
    }
  },
  {
    files: ["node/tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...nodeGlobals,
        ...jestGlobals
      }
    }
  }
];
