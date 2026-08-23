import type { AgentStore, AppStore } from "@stn/storage";

import type { ImportService } from "./import-service.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { ServerSecretVault } from "./secrets.js";

export interface ActiveGeneration {
  readonly id: string;
  readonly conversationId: string;
  readonly mode: "send" | "regenerate";
  readonly targetMessageId?: string;
  readonly startedAt: string;
  readonly controller: AbortController;
}

export interface CompletedGeneration {
  readonly id: string;
  readonly conversationId: string;
  readonly mode: "send" | "regenerate";
  readonly targetMessageId?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly messageId?: string;
  readonly revision?: number;
  readonly incompleteReason?: "length" | "cancelled" | "error" | "limit";
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly toolProposalOnly?: boolean;
}

export interface GenerationBudget {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxEvents: number;
  readonly maxChoices: number;
  readonly maxToolCalls: number;
  readonly maxToolArgumentsBytes: number;
  readonly maxSseFrameBytes: number;
}

export const defaultGenerationBudget: GenerationBudget = {
  maxInputBytes: 8 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxEvents: 100_000,
  maxChoices: 16,
  maxToolCalls: 32,
  maxToolArgumentsBytes: 256 * 1024,
  maxSseFrameBytes: 1024 * 1024,
};

export interface ServerContext {
  readonly store: AppStore;
  readonly agents: AgentStore;
  readonly imports: ImportService;
  readonly providers: ProviderRegistry;
  readonly vault: ServerSecretVault;
  readonly generations: Map<string, ActiveGeneration>;
  readonly generationResults: Map<string, CompletedGeneration>;
  readonly generationBudget: GenerationBudget;
}

export function envelope<T>(data: T): { data: T } {
  return { data };
}
