export type CoverageSummary = {
  total?: {
    branches?: {
      pct?: number;
    };
  };
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
