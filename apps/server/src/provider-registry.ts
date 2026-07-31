import {
  DeterministicFakeProvider,
  OpenAICompatibleProvider,
  TextCompletionProvider,
  type ModelProvider,
} from "@stn/providers";
import type { AppStore, ProviderConnection } from "@stn/storage";

import type { ServerSecretVault } from "./secrets.js";

export interface ProviderConnectionDto {
  readonly id: string;
  readonly name: string;
  readonly protocol: ProviderConnection["protocol"];
  readonly baseUrl: string;
  readonly model: string;
  readonly headers: Record<string, string>;
  readonly hasApiKey: boolean;
  readonly nativeToolCalling: boolean;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class ProviderRegistry {
  constructor(
    private readonly store: AppStore,
    private readonly vault: ServerSecretVault,
  ) {}

  async get(connectionId: string): Promise<ModelProvider> {
    if (connectionId === "fake") {
      return new DeterministicFakeProvider({
        chunks: [
          "The deterministic local provider is connected. ",
          "This response is persisted only after the stream finishes.",
        ],
      });
    }
    const connection = this.store.getProviderConnection(connectionId);
    const apiKey = await this.vault.get(connection.apiKeyRef);
    const config = {
      baseUrl: connection.baseUrl,
      model: connection.model,
      headers: connection.headers,
      nativeToolCalling: connection.nativeToolCalling,
      ...(apiKey === undefined ? {} : { apiKey }),
    };
    if (connection.protocol === "openai-compatible") {
      return new OpenAICompatibleProvider(config);
    }
    if (connection.protocol === "text-completion") {
      return new TextCompletionProvider(config);
    }
    return new DeterministicFakeProvider();
  }

  async dto(connection: ProviderConnection): Promise<ProviderConnectionDto> {
    return {
      id: connection.id,
      name: connection.name,
      protocol: connection.protocol,
      baseUrl: connection.baseUrl,
      model: connection.model,
      headers: connection.headers,
      hasApiKey: (await this.vault.get(connection.apiKeyRef)) !== undefined,
      nativeToolCalling: connection.nativeToolCalling,
      revision: connection.revision,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  async list(): Promise<ProviderConnectionDto[]> {
    return Promise.all(
      this.store
        .listProviderConnections()
        .map((connection) => this.dto(connection)),
    );
  }
}
