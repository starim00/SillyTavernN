import type {
  PortableProviderConnection,
  ProviderConnectionInput,
  ProviderProtocol,
} from "./domain/workspace";

const portableProtocols = new Set<ProviderProtocol>([
  "openai-compatible",
  "openai-responses",
  "text-completion",
  "fake",
]);

const recordValue = (
  value: unknown,
  field: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
};

const stringValue = (
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = false,
): string => {
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串。`);
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new Error(`${field} 不能为空。`);
  }
  if (normalized.length > maximum) {
    throw new Error(`${field} 超出长度限制。`);
  }
  return normalized;
};

const headersValue = (value: unknown): Record<string, string> => {
  if (value === undefined) return {};
  const record = recordValue(value, "headers");
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error(`headers 包含不允许的字段：${key}。`);
    }
    if (typeof entry !== "string") {
      throw new Error(`headers.${key} 必须是字符串。`);
    }
    headers[key] = entry;
  }
  return headers;
};

export function parsePortableProviderConnection(
  value: unknown,
): ProviderConnectionInput {
  const root = recordValue(value, "导入文件");
  if (root.format !== "sillytavern-n.provider-connection") {
    throw new Error("不是 SillyTavern N Provider 连接文件。");
  }
  if (root.version !== 1) throw new Error("不支持此 Provider 文件版本。");

  const connection = recordValue(root.connection, "connection");
  if (
    typeof connection.protocol !== "string" ||
    !portableProtocols.has(connection.protocol as ProviderProtocol)
  ) {
    throw new Error("connection.protocol 不是可导入的 Provider 协议。");
  }

  if (
    connection.apiKey !== undefined &&
    typeof connection.apiKey !== "string"
  ) {
    throw new Error("connection.apiKey 必须是字符串。");
  }
  if (
    typeof connection.apiKey === "string" &&
    connection.apiKey.length > 16_384
  ) {
    throw new Error("connection.apiKey 超出长度限制。");
  }
  const apiKey = connection.apiKey || undefined;
  return {
    name: stringValue(connection.name, "connection.name", 256),
    protocol: connection.protocol as ProviderProtocol,
    baseUrl: stringValue(connection.baseUrl, "connection.baseUrl", 2048, true),
    model: stringValue(connection.model, "connection.model", 512),
    headers: headersValue(connection.headers),
    nativeToolCalling:
      typeof connection.nativeToolCalling === "boolean"
        ? connection.nativeToolCalling
        : connection.protocol === "openai-responses",
    ...(apiKey ? { apiKey } : {}),
  };
}

export function providerConnectionExportFilename(name: string): string {
  const safeName = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safeName || "provider"}-provider.json`;
}

export function serializePortableProviderConnection(
  value: PortableProviderConnection,
): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
