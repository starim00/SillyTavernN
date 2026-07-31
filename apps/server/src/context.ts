import type { AgentStore, AppStore } from "@stn/storage";

import type { ImportService } from "./import-service.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { ServerSecretVault } from "./secrets.js";

export interface ActiveGeneration {
  readonly id: string;
  readonly conversationId: string;
  readonly controller: AbortController;
}

export interface ServerContext {
  readonly store: AppStore;
  readonly agents: AgentStore;
  readonly imports: ImportService;
  readonly providers: ProviderRegistry;
  readonly vault: ServerSecretVault;
  readonly generations: Map<string, ActiveGeneration>;
}

export function envelope<T>(data: T): { data: T } {
  return { data };
}
