export interface CliModelAdapter {
  name: string;
  command: string;
  buildArgs(cwd: string): string[];
  detectLoginUrl?(output: string): string | null;
  detectProcessing?(output: string): boolean;
  detectIdle?(output: string): boolean;
}
