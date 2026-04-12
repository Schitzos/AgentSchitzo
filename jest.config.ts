import type { Config } from "jest";

const config: Config = {
  roots: ["<rootDir>/tests"],
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@root/(.*)$": "<rootDir>/$1"
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "./tsconfig.json"
      }
    ]
  },
  collectCoverageFrom: [
    "telegram-listener.ts",
    "models/**/*.ts",
    "telegram/**/*.ts",
    "utils/**/*.ts"
  ]
};

export default config;
