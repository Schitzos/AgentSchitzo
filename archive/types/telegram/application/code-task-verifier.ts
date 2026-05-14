export type CoverageSummary = {
  total?: {
    branches?: {
      covered?: number;
      total?: number;
      pct?: number;
    };
  };
  [filePath: string]:
    | {
        branches?: {
          covered?: number;
          total?: number;
          pct?: number;
        };
      }
    | undefined;
};

export type VerificationCommandResult = {
  success: boolean;
  output: string;
};

export type VerificationResult = {
  success: boolean;
  coverage: number | null;
  output: string;
};
