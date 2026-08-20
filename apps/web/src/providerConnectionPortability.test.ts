import { describe, expect, it } from "vitest";

import {
  parsePortableProviderConnection,
  providerConnectionExportFilename,
  serializePortableProviderConnection,
} from "./providerConnectionPortability";

describe("Provider connection portability", () => {
  it("parses a versioned connection with an optional API key", () => {
    expect(
      parsePortableProviderConnection({
        format: "sillytavern-n.provider-connection",
        version: 1,
        connection: {
          name: "Imported Responses",
          protocol: "openai-responses",
          baseUrl: "https://example.test",
          model: "example-model",
          headers: { "X-Provider": "example" },
          nativeToolCalling: true,
          apiKey: " portable-secret ",
        },
      }),
    ).toEqual({
      name: "Imported Responses",
      protocol: "openai-responses",
      baseUrl: "https://example.test",
      model: "example-model",
      headers: { "X-Provider": "example" },
      nativeToolCalling: true,
      apiKey: " portable-secret ",
    });
  });

  it("rejects unsupported protocols and unversioned Provider data", () => {
    expect(() =>
      parsePortableProviderConnection({
        format: "sillytavern-n.provider-connection",
        version: 1,
        connection: {
          name: "Built in",
          protocol: "unsupported",
          baseUrl: "",
          model: "deterministic",
        },
      }),
    ).toThrow("不是可导入的 Provider 协议");
    expect(() => parsePortableProviderConnection({ name: "legacy" })).toThrow(
      "不是 SillyTavern N Provider 连接文件",
    );
  });

  it("uses a safe filename and stable pretty JSON", () => {
    expect(providerConnectionExportFilename("  DeepSeek / CPA  ")).toBe(
      "DeepSeek-CPA-provider.json",
    );
    const serialized = serializePortableProviderConnection({
      format: "sillytavern-n.provider-connection",
      version: 1,
      connection: {
        name: "CPA",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:8317/v1",
        model: "example",
        headers: {},
        nativeToolCalling: false,
      },
    });
    expect(serialized.endsWith("}\n")).toBe(true);
  });
});
