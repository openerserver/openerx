import { createHmac } from "node:crypto";
import type { ChatSettingsVisualization } from "../../lib/chat-settings-visualization";
import type { ChatSettingsConfigType, OrchestrationStrategyPreview } from "./types";

export interface ChatSettingsMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface PendingPatch {
  index: number;
  action: "preview" | "apply" | "explain" | "validate";
  configType: ChatSettingsConfigType;
  patch: Record<string, unknown>;
  explanation: string;
  rawText: string;
  mermaidPreview?: Record<string, string>;
  visualizations?: ChatSettingsVisualization[];
  orchestrationPreview?: OrchestrationStrategyPreview;
  configVersion: string;
  createdAt: string;
  signature: string;
}

export interface ConversationState {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatSettingsMessage[];
  pendingPatches: PendingPatch[];
}

function createConversationId(): string {
  return `chatcfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

function serializePendingPatchForSignature(patch: Omit<PendingPatch, "signature">): string {
  return JSON.stringify(sortValue(patch));
}

function getPendingPatchSigningSecret(): string {
  return (
    process.env.CHAT_SETTINGS_PENDING_PATCH_SECRET ||
    process.env.OPENCODE_ROOT ||
    "openerx-chat-settings"
  );
}

export function signPendingPatch(patch: Omit<PendingPatch, "signature">): string {
  return createHmac("sha256", getPendingPatchSigningSecret())
    .update(serializePendingPatchForSignature(patch))
    .digest("hex");
}

export function verifyPendingPatchSignature(patch: PendingPatch): boolean {
  return (
    signPendingPatch({
      index: patch.index,
      action: patch.action,
      configType: patch.configType,
      patch: patch.patch,
      explanation: patch.explanation,
      rawText: patch.rawText,
      mermaidPreview: patch.mermaidPreview,
      visualizations: patch.visualizations,
      orchestrationPreview: patch.orchestrationPreview,
      configVersion: patch.configVersion,
      createdAt: patch.createdAt,
    }) === patch.signature
  );
}

export class ConversationManager {
  private readonly conversations = new Map<string, ConversationState>();

  getOrCreate(conversationId?: string): ConversationState {
    if (conversationId) {
      const existing = this.conversations.get(conversationId);
      if (existing) {
        existing.updatedAt = new Date().toISOString();
        return existing;
      }
    }

    const now = new Date().toISOString();
    const conversation: ConversationState = {
      id: conversationId || createConversationId(),
      createdAt: now,
      updatedAt: now,
      messages: [],
      pendingPatches: [],
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  get(conversationId: string): ConversationState | undefined {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.updatedAt = new Date().toISOString();
    }
    return conversation;
  }

  appendMessage(
    conversationId: string,
    role: "user" | "assistant",
    content: string,
  ): ConversationState {
    const conversation = this.getOrCreate(conversationId);
    conversation.messages.push({ role, content, createdAt: new Date().toISOString() });
    conversation.updatedAt = new Date().toISOString();
    return conversation;
  }

  addPendingPatch(
    conversationId: string,
    patch: Omit<PendingPatch, "index" | "createdAt" | "signature">,
  ): PendingPatch {
    const conversation = this.getOrCreate(conversationId);
    const unsignedPatch: Omit<PendingPatch, "signature"> = {
      ...patch,
      index: conversation.pendingPatches.length,
      createdAt: new Date().toISOString(),
    };
    const nextPatch: PendingPatch = {
      ...unsignedPatch,
      signature: signPendingPatch(unsignedPatch),
    };
    conversation.pendingPatches.push(nextPatch);
    conversation.updatedAt = nextPatch.createdAt;
    return nextPatch;
  }

  getPendingPatch(conversationId: string, index: number): PendingPatch | undefined {
    return this.get(conversationId)?.pendingPatches[index];
  }

  list(): ConversationState[] {
    return Array.from(this.conversations.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  pruneInactive(maxAgeMs = 30 * 60 * 1000) {
    const deadline = Date.now() - maxAgeMs;
    for (const [conversationId, conversation] of this.conversations.entries()) {
      if (Date.parse(conversation.updatedAt) < deadline) {
        this.conversations.delete(conversationId);
      }
    }
  }
}

export const chatSettingsConversationManager = new ConversationManager();
