/** @type {import('jest').Config} */
export default {
  roots: ["<rootDir>/tests"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.ts$": "$1.ts",
    "^@root/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "./tsconfig.json",
      },
    ],
  },
  collectCoverageFrom: [
    "adapters/**/*.ts",
    "session/**/*.ts",
    "telegram/**/*.ts",
    "utils/**/*.ts",
    "telegram-listener.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
