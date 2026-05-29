# Design: AgentSchitzo

## Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────┐
│  Telegram    │◄─────►│  AgentSchitzo    │◄─────►│  CLI Tool   │
│  (user)      │ HTTP  │  (Node.js app)   │ stdio │  (kiro/etc) │
└──────────────┘       └──────────────────┘       └─────────────┘
                               │
                               ▼
                       ┌──────────────┐
                       │   Langfuse   │
                       │  (tracing)   │
                       └──────────────┘
```

## Execution Flow

```
Telegram message / Terminal command
    │
    ▼
┌─────────────────────────────────┐
│ 1. Create session_id (UUID)     │
│ 2. Start Langfuse trace         │
│    - trace_id = session_id      │
│    - metadata: adapter, cwd     │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ 3. Spawn CLI tool               │
│    - adapter.command + args     │
│    - pipe stdin/stdout/stderr   │
│ 4. Create Langfuse span         │
│    - input: user command        │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ 5. Capture stdout/stderr        │
│    - buffer with 500ms debounce │
│    - strip ANSI codes           │
│    - forward to Telegram        │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────┐
│ 6. On process exit:             │
│    - Run `git diff` for diffs   │
│    - End Langfuse span          │
│      - output: stdout capture   │
│      - metadata: diffs, stderr  │
│      - exit_code, duration      │
│ 7. Notify Telegram (summary)    │
└─────────────────────────────────┘
```

## Module Structure

```
adapters/
├── cli-model-adapter.ts    # Interface
├── kiro.ts                 # Primary adapter
├── codex-cli.ts
├── gemini-cli.ts
├── local-llm.ts
└── index.ts                # Registry

session/
├── model-session.ts        # Child process lifecycle
└── output-buffer.ts        # Debounced output + ANSI strip

tracing/
├── langfuse-client.ts      # Langfuse SDK wrapper
└── trace-session.ts        # Session trace lifecycle

telegram/
├── application/
│   └── handle-telegram-command.ts  # Command router
├── domain/
│   └── message-utils.ts
└── infrastructure/
    ├── telegram-api.ts
    └── task-log.ts

utils/
└── env.ts
```

## New Module: `tracing/langfuse-client.ts`

Thin wrapper around the Langfuse SDK:

```ts
interface LangfuseTracer {
  startTrace(sessionId: string, metadata: TraceMetadata): Trace;
  startSpan(trace: Trace, input: string): Span;
  endSpan(span: Span, output: string, metadata: SpanMetadata): void;
  flush(): Promise<void>;
}

interface TraceMetadata {
  adapter: string;
  cwd: string;
}

interface SpanMetadata {
  exitCode: number | null;
  durationMs: number;
  diffs: string;
  stderr: string;
}
```

## New Module: `tracing/trace-session.ts`

Orchestrates tracing around a model session execution:

```ts
interface TraceSession {
  begin(command: string): void;   // Creates span, records input
  captureOutput(text: string): void;  // Appends to output buffer
  captureStderr(text: string): void;
  end(exitCode: number | null): Promise<void>;  // Captures diffs, ends span
}
```

## Modified: `session/model-session.ts`

Add hooks for tracing integration:

- `onProcessStart` callback — fired when child process spawns (for span creation)
- `onProcessEnd` callback — fired with exit code (for span completion)
- Expose raw stderr separately (currently only stdout is buffered)

## Modified: `telegram/application/handle-telegram-command.ts`

Wire `TraceSession` into the command flow:

```
user message arrives
  → create TraceSession
  → traceSession.begin(message)
  → modelSession.write(message)
  → on output: traceSession.captureOutput(text)
  → on exit: traceSession.end(exitCode)
```

## File Diff Capture

After CLI tool exits:

```ts
import { execSync } from "child_process";

function captureDiffs(cwd: string): string {
  try {
    return execSync("git diff", { cwd, encoding: "utf-8" });
  } catch {
    return "";
  }
}
```

Diffs are attached to the Langfuse span as metadata. For large diffs, truncate to 10KB.

## Langfuse Trace Structure

```
Trace: session_id
├── name: "agentschitzo-session"
├── metadata: { adapter: "kiro", cwd: "/path/to/project" }
│
├── Span: "execution-1"
│   ├── input: "fix the auth bug in login.ts"
│   ├── output: "Fixed the authentication..."
│   ├── metadata:
│   │   ├── exitCode: 0
│   │   ├── durationMs: 12400
│   │   ├── diffs: "diff --git a/login.ts..."
│   │   └── stderr: ""
│   └── endTime: ...
│
├── Span: "execution-2"
│   ├── input: "now add tests for it"
│   └── ...
```

## Error Handling

| Scenario | Action |
|----------|--------|
| Langfuse unavailable | Log warning, continue execution (non-blocking) |
| CLI tool not on PATH | Send error to Telegram, no trace created |
| CLI tool exits unexpectedly | End span with exit code, notify Telegram |
| `git diff` fails (not a git repo) | Diffs field is empty string |
| Large output (>100KB) | Truncate before sending to Langfuse |

## Adapter Interface (unchanged)

```ts
interface CliModelAdapter {
  name: string;
  command: string;
  buildArgs(cwd: string): string[];
  detectLoginUrl?(output: string): string | null;
}
```

No changes needed to add Langfuse — tracing wraps around the adapter, not inside it.

## Dependencies to Add

```json
{
  "langfuse": "^3.x"
}
```

Single new dependency. The Langfuse Node SDK handles batching and async flushing internally.
