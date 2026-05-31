type NotifyFn = (msg: string) => void;
let _notify: NotifyFn | null = null;
export function setGlobalNotify(fn: NotifyFn): void { _notify = fn; }
export function globalNotify(msg: string): void { _notify?.(msg); }
