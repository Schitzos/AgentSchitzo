export interface CliModelAdapter {
  name: string;
  command: string;
  closeStdin?: boolean;
  mergeStderr?: boolean;
  buildArgs(cwd: string, model?: string): string[];
  detectLoginUrl?(output: string): string | null;
  detectProcessing?(output: string): boolean;
  detectIdle?(output: string): boolean;
}
