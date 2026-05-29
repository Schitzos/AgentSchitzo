import { jest } from "@jest/globals";
import { createOutputBuffer, stripAnsi } from "../session/output-buffer.ts";

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi("\x1b[32mhello\x1b[0m")).toBe("hello");
  });

  it("removes cursor codes", () => {
    expect(stripAnsi("\x1b[?25ltext\x1b[?25h")).toBe("text");
  });

  it("passes plain text through", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("removes OSC sequences", () => {
    expect(stripAnsi("\x1b]0;title\x07text")).toBe("text");
  });

  it("removes set/reset mode sequences", () => {
    expect(stripAnsi("\x1b[1mtext\x1b[0m")).toBe("text");
    expect(stripAnsi("\x1b[?7htext")).toBe("text");
    expect(stripAnsi("\x1b[?7ltext")).toBe("text");
  });
});

describe("createOutputBuffer", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("flushes after debounce", () => {
    const buf = createOutputBuffer(100);
    const cb = jest.fn();
    buf.onFlush(cb);

    buf.append("hello ");
    buf.append("world");

    expect(cb).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledWith("hello world");
  });

  it("strips ANSI before flushing", () => {
    const buf = createOutputBuffer(50);
    const cb = jest.fn();
    buf.onFlush(cb);

    buf.append("\x1b[31mred\x1b[0m");
    jest.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledWith("red");
  });

  it("does not flush empty content", () => {
    const buf = createOutputBuffer(50);
    const cb = jest.fn();
    buf.onFlush(cb);

    buf.append("   ");
    jest.advanceTimersByTime(50);
    expect(cb).not.toHaveBeenCalled();
  });

  it("manual flush works", () => {
    const buf = createOutputBuffer(1000);
    const cb = jest.fn();
    buf.onFlush(cb);

    buf.append("data");
    buf.flush();
    expect(cb).toHaveBeenCalledWith("data");
  });

  it("destroy stops callbacks", () => {
    const buf = createOutputBuffer(50);
    const cb = jest.fn();
    buf.onFlush(cb);

    buf.append("data");
    buf.destroy();
    jest.advanceTimersByTime(100);
    expect(cb).not.toHaveBeenCalled();
  });

  it("flush with no callback does not throw", () => {
    const buf = createOutputBuffer(50);
    buf.append("data");
    expect(() => buf.flush()).not.toThrow();
  });

  it("flush with empty buffer does nothing", () => {
    const buf = createOutputBuffer(50);
    const cb = jest.fn();
    buf.onFlush(cb);
    buf.flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it("resets timer on subsequent appends", () => {
    const buf = createOutputBuffer(100);
    const cb = jest.fn();
    buf.onFlush(cb);

    buf.append("a");
    jest.advanceTimersByTime(80);
    buf.append("b");
    jest.advanceTimersByTime(80);
    expect(cb).not.toHaveBeenCalled();
    jest.advanceTimersByTime(20);
    expect(cb).toHaveBeenCalledWith("ab");
  });

  it("uses default debounceMs when not provided", () => {
    const buf = createOutputBuffer();
    const cb = jest.fn();
    buf.onFlush(cb);
    buf.append("test");
    jest.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledWith("test");
  });
});
