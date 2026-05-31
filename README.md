# AgentSchitzo

AgentSchitzo is a Node.js Telegram automation service that lets a single approved Telegram chat trigger an AI coding workflow. It polls Telegram for new messages, asks a text model to classify each message as either chat or code work, and routes code requests into a Codex CLI run. After Codex finishes, the project automatically runs tests and checks branch coverage, then asks Codex to repair the code if verification fails.

## What the project does

- Polls Telegram updates for one configured chat.
- Sends plain chat requests back through a text model response.
- Converts code requests into a structured Codex prompt with a model-generated plan.
- Runs Codex locally through the CLI.
- Verifies the result with `npm run test` and a branch coverage gate above `90%`.
- Retries failed code tasks with a repair prompt.
- Stores task output in `logs/task-log.json`.

## Request flow

1. `node/src/main.ts` creates the app, Telegram API client, command handler, and polling loop.
2. `node/src/telegram/application/handle-telegram-command.ts` asks a text model to return JSON describing the request intent.
3. If the intent is `chat`, the service replies directly in Telegram.
4. If the intent is `code`, the service builds a Codex prompt and runs the local Codex CLI.
5. `node/src/telegram/application/handle-telegram-command.ts` coordinates session execution, verification prompts, and repair flow.
6. If tests or coverage fail, Codex gets a repair prompt and retries up to three times.

## Main modules

- `node/src/telegram/`: Telegram polling, command handling, permissions, and message utilities.
- `models/code/codex.js`: Local Codex CLI runner.
- `models/text/groq.js`: Intent classification through the Groq OpenAI-compatible API.
- `models/text/gemini.js`: Gemini text model adapter.
- `node/src/utils/env.ts`: Lightweight `.env` loader and environment helpers.
- `node/tests/`: Jest coverage for Telegram flow, model adapters, and utilities.

## Requirements

- Node.js
- Telegram bot token and allowed chat ID
- Codex CLI installed and available on `PATH`
- A text-model API key for the configured classifier

## Environment variables

The app reads values from `.env`.

```env
TELEGRAM_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_POLL_INTERVAL_MS=3000
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

Notes:

- `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` are required.
- `TELEGRAM_POLL_INTERVAL_MS` defaults to `3000`.
- `GROQ_API_KEY` is required for the default intent-classification path.
- `GEMINI_API_KEY` is only needed if the Gemini adapter is used.

## Scripts

```bash
npm run build
npm run dev
npm start
npm run start:dist
npm --prefix dist start
npm test
npm run lint
npm run format
```

`npm run dev` runs the source tree directly for development. `npm run build` creates a runnable, minified, and lightly obfuscated `dist/` directory, and `npm start` runs that built output from the repo root. Use `npm run start:dist` or `npm --prefix dist start` if you want to launch the generated manifest directly.

## Future roadmap

### Must have

1. Multi-step approval workflow so destructive or high-risk tasks require explicit confirmation before Codex runs.
2. Stronger sandbox and command policy enforcement with clearer allowlist and denylist coverage for file, shell, and package operations.
3. Task queue and concurrency controls so overlapping Telegram requests do not corrupt the workspace or race against each other.
4. Richer execution status updates in Telegram, including queued, running, verifying, repair-attempt, and failed states.
5. Persistent task history with searchable metadata for prompts, plans, verification results, and final outcomes.

### Nice to have

1. Real-time collaboration mode where multiple approved operators can observe progress and hand off tasks safely.
2. Built-in code review summaries that highlight changed files, likely risks, and missing tests after each Codex run.
3. Integrations with project tools such as GitHub Issues, Linear, or Jira so Telegram requests can link back to tracked work.
4. Alternative-solution suggestions that offer a second implementation approach before applying a risky or large change.
5. Smarter code analysis and optimization hints focused on flaky tests, weak coverage areas, and repeated repair failures.

## Summary

This project is a Telegram-controlled coding assistant wrapper around Codex. Its core responsibility is not general chatbot behavior, but safely turning Telegram messages into local coding runs, verifying the resulting codebase, and reporting progress and results back to the same chat.
