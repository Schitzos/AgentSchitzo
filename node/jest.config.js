/** @type {import('jest').Config} */
export default {
  rootDir: "..",
  roots: ["<rootDir>/node/tests"],
  testEnvironment: "node",
  watchman: false,
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.ts$": "$1.ts",
    "^@root/(.*)$": "<rootDir>/$1",
    "^@node/(.*)$": "<rootDir>/node/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },
  collectCoverageFrom: [
    "node/src/adapters/**/*.ts",
    "node/src/session/**/*.ts",
    "node/src/telegram/**/*.ts",
    "node/src/utils/**/*.ts",
    "node/src/main.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 85,
      lines: 84,
      statements: 84,
    },
  },
};
