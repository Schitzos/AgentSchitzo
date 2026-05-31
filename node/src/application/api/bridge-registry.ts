import type { ChatSendResponseDTO } from "../../shared/dto.ts";

type ChatBridge = (prompt: string, sessionId?: string) => Promise<ChatSendResponseDTO>;
type SessionStartBridge = () => Promise<{ ok: boolean; message: string }>;
type SessionNewBridge = () => Promise<{ ok: boolean; sessionId: string | null; message: string }>;
type SessionDeleteBridge = (id: string) => void;
type ProjectBridge = (dir: string) => { ok: boolean; cwd: string; message: string };
type ProviderBridge = (provider: string) => Promise<{ ok: boolean; sessionId: string | null; message: string }>;

const bridges: {
  chatBridge: ChatBridge | null;
  sessionStartBridge: SessionStartBridge | null;
  sessionNewBridge: SessionNewBridge | null;
  sessionDeleteBridge: SessionDeleteBridge | null;
  projectBridge: ProjectBridge | null;
  providerBridge: ProviderBridge | null;
} = {
  chatBridge: null,
  sessionStartBridge: null,
  sessionNewBridge: null,
  sessionDeleteBridge: null,
  projectBridge: null,
  providerBridge: null,
};

export function setChatBridge(fn: ChatBridge | null): void { bridges.chatBridge = fn; }
export function setSessionStartBridge(fn: SessionStartBridge | null): void { bridges.sessionStartBridge = fn; }
export function setSessionNewBridge(fn: SessionNewBridge | null): void { bridges.sessionNewBridge = fn; }
export function setSessionDeleteBridge(fn: SessionDeleteBridge | null): void { bridges.sessionDeleteBridge = fn; }
export function setProjectBridge(fn: ProjectBridge | null): void { bridges.projectBridge = fn; }
export function setProviderBridge(fn: ProviderBridge | null): void { bridges.providerBridge = fn; }

export function getChatBridge(): ChatBridge | null { return bridges.chatBridge; }
export function getSessionStartBridge(): SessionStartBridge | null { return bridges.sessionStartBridge; }
export function getSessionNewBridge(): SessionNewBridge | null { return bridges.sessionNewBridge; }
export function getSessionDeleteBridge(): SessionDeleteBridge | null { return bridges.sessionDeleteBridge; }
export function getProjectBridge(): ProjectBridge | null { return bridges.projectBridge; }
export function getProviderBridge(): ProviderBridge | null { return bridges.providerBridge; }
