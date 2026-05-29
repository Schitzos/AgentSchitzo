# Design: AgentSchitzo

## Architecture
```
Telegram ◄─HTTP─► AgentSchitzo ◄─stdio─► CLI Tool
   │                    │                    │
   └──────────────────► Langfuse ◄──────────┘
```

## Execution Flow
```
Telegram/Terminal command
→ Create session_id (UUID)
→ Start Langfuse trace (trace_id = session_id, metadata: adapter/cwd)
→ Spawn CLI tool (adapter.command + args, pipe stdio)
→ Create Langfuse span (input: user command)
→ Capture stdout/stderr (buffer 500ms debounce, strip ANSI, forward to Telegram)
→ On exit: git diff capture, end span (output: stdout, metadata: diffs/stderr/exit_code/duration), notify Telegram
```

## Module Structure
```
adapters/           # Interface + kiro/codex-cli/gemini-cli/local-llm + registry
session/            # model-session.ts (child lifecycle) + output-buffer.ts (debounced + ANSI strip)
tracing/            # langfuse-client.ts (SDK wrapper) + trace-session.ts (session trace lifecycle)
telegram/           # handle-telegram-command.ts (router) + message-utils + telegram-api + task-log
utils/              # env.ts
```

## New: `tracing/langfuse-client.ts`
```ts
interface LangfuseTracer {
  startTrace(sessionId: string, metadata: TraceMetadata): Trace;
  startSpan(trace: Trace, input: string): Span;
  endSpan(span: Span, output: string, metadata: SpanMetadata): void;
  flush(): Promise<void>;
}
```

## New: `tracing/trace-session.ts`
```ts
interface TraceSession {
  begin(command: string): void;   // Creates span, records input
  captureOutput(text: string): void;  // Appends to output buffer
  captureStderr(text: string): void;
  end(exitCode: number | null): Promise<void>;  // Captures diffs, ends span
}
```

## Modified: `session/model-session.ts`
Add hooks: `onProcessStart` (span creation), `onProcessEnd` (span completion), expose raw stderr

## Modified: `telegram/application/handle-telegram-command.ts`
Wire TraceSession: message → create TraceSession → begin(message) → modelSession.write → on output: captureOutput → on exit: end(exitCode)

## File Diff Capture
```ts
function captureDiffs(cwd: string): string {
  try { return execSync("git diff", { cwd, encoding: "utf-8" }); }
  catch { return ""; }
}
```
Attach to Langfuse span metadata. Truncate large diffs to 10KB.

## Langfuse Trace Structure
```
Trace: session_id
├── name: "agentschitzo-session"
├── metadata: { adapter: "kiro", cwd: "/path" }
├── Span: "execution-1"
│   ├── input: "fix auth bug"
│   ├── output: "Fixed..."
│   └── metadata: { exitCode: 0, durationMs: 12400, diffs: "...", stderr: "" }
└── Span: "execution-2"...
```

## Error Handling
| Scenario | Action |
|----------|--------|
| Langfuse unavailable | Log warning, continue (non-blocking) |
| CLI tool not on PATH | Error to Telegram, no trace |
| CLI tool exits unexpectedly | End span w/ exit code, notify Telegram |
| git diff fails | Empty diffs string |
| Large output (>100KB) | Truncate before Langfuse |

## Dependencies
```json
{ "langfuse": "^3.x" }
```
