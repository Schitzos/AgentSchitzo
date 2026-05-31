import { jest } from "@jest/globals";
import {
  createSendFn,
  downloadFile,
  processUpdate,
  createWebhookHandler,
  type TelegramUpdate,
} from "../src/main.ts";
import { createCommandContext } from "../src/telegram/application/handle-telegram-command.ts";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import os from "os";

describe("createSendFn", () => {
  it("calls api.sendMessage for non-silent", async () => {
    const api = { sendMessage: jest.fn<() => Promise<boolean>>().mockResolvedValue(true), getUpdates: jest.fn() };
    const send = createSendFn(api as any, "tok", "123");
    const result = await send("hello");
    expect(result).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledWith("hello");
  });

  it("uses fetch for silent messages", async () => {
    const api = { sendMessage: jest.fn(), getUpdates: jest.fn() };
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const send = createSendFn(api as any, "tok", "123", mockFetch as typeof fetch);
    const result = await send("hi", true);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("returns false on silent fetch error", async () => {
    const api = { sendMessage: jest.fn(), getUpdates: jest.fn() };
    const mockFetch = jest.fn<typeof fetch>().mockRejectedValue(new Error("fail"));
    const send = createSendFn(api as any, "tok", "123", mockFetch as typeof fetch);
    const result = await send("hi", true);
    expect(result).toBe(false);
  });
});

describe("downloadFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("downloads and saves file creating dir if needed", async () => {
    const subDir = path.join(tmpDir, "newdir");
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { file_path: "docs/test.txt" } }))
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("content"))
      );
    const result = await downloadFile("file123", "tok", subDir, mockFetch as typeof fetch);
    expect(result).toBe(path.join(subDir, "test.txt"));
    expect(fs.readFileSync(result!, "utf8")).toBe("content");
  });

  it("downloads file when uploads dir already exists", async () => {
    // Dir already exists — tests the false branch of existsSync check
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { file_path: "docs/test2.txt" } }))
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("content2"))
      );
    const result = await downloadFile("file456", "tok", tmpDir, mockFetch as typeof fetch);
    expect(result).toBe(path.join(tmpDir, "test2.txt"));
  });

  it("returns null when getFile fails", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false }))
    );
    expect(await downloadFile("f", "tok", tmpDir, mockFetch as typeof fetch)).toBeNull();
  });

  it("returns null when file download fails", async () => {
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { file_path: "x.txt" } }))
      )
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await downloadFile("f", "tok", tmpDir, mockFetch as typeof fetch)).toBeNull();
  });

  it("returns null on fetch exception", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockRejectedValue(new Error("net"));
    expect(await downloadFile("f", "tok", tmpDir, mockFetch as typeof fetch)).toBeNull();
  });

  it("returns null when file_path is missing", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: {} }))
    );
    expect(await downloadFile("f", "tok", tmpDir, mockFetch as typeof fetch)).toBeNull();
  });
});

describe("processUpdate", () => {
  it("ignores updates from wrong chat", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const update: TelegramUpdate = { update_id: 1, message: { chat: { id: 999 }, text: "hi" } };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123" });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores updates with no message", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    await processUpdate({ update_id: 1 }, ctx, send, { token: "t", chatId: "123" });
    expect(send).not.toHaveBeenCalled();
  });

  it("handles text messages", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const update: TelegramUpdate = { update_id: 1, message: { chat: { id: 123 }, text: "/help" } };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123" });
    expect(send).toHaveBeenCalledWith(expect.stringContaining("/start"));
  });

  it("ignores message with no actionable content", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const update: TelegramUpdate = { update_id: 1, message: { chat: { id: 123 } } };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123" });
    expect(send).not.toHaveBeenCalled();
  });

  it("handles document upload with session", async () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "idle",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "f.txt" } })))
      .mockResolvedValueOnce(new Response(Buffer.from("data")));
    const update: TelegramUpdate = {
      update_id: 1,
      message: { chat: { id: 123 }, document: { file_id: "fid", file_name: "f.txt" } },
    };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123", fetchFn: mockFetch as typeof fetch });
    expect(ctx.session!.write).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("File saved"), true);
  });

  it("handles photo upload with session", async () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "idle",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "p.jpg" } })))
      .mockResolvedValueOnce(new Response(Buffer.from("img")));
    const update: TelegramUpdate = {
      update_id: 1,
      message: { chat: { id: 123 }, photo: [{ file_id: "pid" }] },
    };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123", fetchFn: mockFetch as typeof fetch });
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Photo saved"), true);
  });

  it("handles voice upload with session", async () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "idle",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "v.ogg" } })))
      .mockResolvedValueOnce(new Response(Buffer.from("audio")));
    const update: TelegramUpdate = {
      update_id: 1,
      message: { chat: { id: 123 }, voice: { file_id: "vid" } },
    };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123", fetchFn: mockFetch as typeof fetch });
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Voice saved"), true);
  });

  it("skips file upload when no session", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const mockFetch = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "f.txt" } })))
      .mockResolvedValueOnce(new Response(Buffer.from("data")));
    const update: TelegramUpdate = {
      update_id: 1,
      message: { chat: { id: 123 }, document: { file_id: "fid" } },
    };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123", fetchFn: mockFetch as typeof fetch });
    expect(send).not.toHaveBeenCalled();
  });

  it("handles photo upload when download fails", async () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "idle",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false }))
    );
    const update: TelegramUpdate = {
      update_id: 1,
      message: { chat: { id: 123 }, photo: [{ file_id: "pid" }] },
    };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123", fetchFn: mockFetch as typeof fetch });
    expect(send).not.toHaveBeenCalled();
  });

  it("handles voice upload when download fails", async () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "idle",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    const send = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false }))
    );
    const update: TelegramUpdate = {
      update_id: 1,
      message: { chat: { id: 123 }, voice: { file_id: "vid" } },
    };
    await processUpdate(update, ctx, send, { token: "t", chatId: "123", fetchFn: mockFetch as typeof fetch });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("createWebhookHandler", () => {
  function createMockResponse() {
    return {
      statusCode: 0,
      body: "",
      writeHead(code: number) {
        this.statusCode = code;
      },
      end(chunk?: string) {
        if (chunk) this.body += chunk;
      },
    };
  }

  it("processes POST requests", async () => {
    const handler = jest.fn<(u: TelegramUpdate) => Promise<void>>().mockResolvedValue(undefined);
    const listener = createWebhookHandler(handler);
    const req = new EventEmitter() as EventEmitter & { method?: string };
    req.method = "POST";
    const res = createMockResponse();

    await listener(req as any, res as any);
    req.emit("data", Buffer.from(JSON.stringify({ update_id: 1, message: { text: "hi" } })));
    req.emit("end");
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
    expect(handler).toHaveBeenCalledWith({ update_id: 1, message: { text: "hi" } });
  });

  it("responds to GET requests", async () => {
    const handler = jest.fn<(u: TelegramUpdate) => Promise<void>>().mockResolvedValue(undefined);
    const listener = createWebhookHandler(handler);
    const req = new EventEmitter() as EventEmitter & { method?: string };
    req.method = "GET";
    const res = createMockResponse();

    await listener(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("AgentSchitzo webhook active");
  });

  it("handles malformed POST body", async () => {
    const handler = jest.fn<(u: TelegramUpdate) => Promise<void>>().mockResolvedValue(undefined);
    const listener = createWebhookHandler(handler);
    const req = new EventEmitter() as EventEmitter & { method?: string };
    req.method = "POST";
    const res = createMockResponse();

    await listener(req as any, res as any);
    req.emit("data", Buffer.from("not json"));
    req.emit("end");
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
    expect(handler).not.toHaveBeenCalled();
  });
});
