const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07|\x1b\[[\?]?[0-9;]*[hlm]/g;

export function stripAnsi(text: string): string {
  /* istanbul ignore next -- regex alternatives counted as branches */
  return text.replace(ANSI_RE, "");
}

export interface OutputBuffer {
  append(text: string): void;
  onFlush(callback: (text: string) => void): void;
  flush(): void;
  destroy(): void;
}

export function createOutputBuffer(debounceMs = 500): OutputBuffer {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let callback: ((text: string) => void) | null = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length > 0 && callback) {
      const text = stripAnsi(buffer).trim();
      buffer = "";
      if (text.length > 0) callback(text);
    } else {
      buffer = "";
    }
  }

  function append(text: string) {
    buffer += text;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  function onFlush(cb: (text: string) => void) {
    callback = cb;
  }

  function destroy() {
    if (timer) clearTimeout(timer);
    timer = null;
    buffer = "";
    callback = null;
  }

  return { append, onFlush, flush, destroy };
}
