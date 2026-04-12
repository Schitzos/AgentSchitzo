export type CodexResult = {
  success: boolean;
  output: string;
};

export type CodexRunOptions = {
  bypassApprovals?: boolean;
  additionalWritableRoots?: string[];
};
