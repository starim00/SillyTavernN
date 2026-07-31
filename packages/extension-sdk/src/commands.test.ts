import { describe, expect, it, vi } from "vitest";

import { SlashCommandRegistry, type SlashCommandHost } from "./index.js";

function createHost(): SlashCommandHost {
  return {
    stop: vi.fn(),
    send: vi.fn((text: string) => text),
    continue: vi.fn(() => "continued"),
    regenerate: vi.fn(() => "regenerated"),
    swipe: vi.fn((index: number | undefined) => index),
    setVariable: vi.fn((_name: string, value: string) => value),
    getVariable: vi.fn((name: string) => `value:${name}`),
  };
}

describe("SlashCommandRegistry", () => {
  it("registers the minimal built-ins and parses quoted and named arguments", async () => {
    const host = createHost();
    const registry = new SlashCommandRegistry(host);

    await expect(
      registry.execute('/send "hello world"'),
    ).resolves.toMatchObject({
      handled: true,
      value: "hello world",
    });
    await expect(
      registry.execute("/setvar name=weather value=rain"),
    ).resolves.toMatchObject({ value: "rain" });
    await expect(registry.execute("/getvar weather")).resolves.toMatchObject({
      value: "value:weather",
    });
    expect(registry.list().map((command) => command.name)).toEqual([
      "continue",
      "getvar",
      "help",
      "regenerate",
      "send",
      "setvar",
      "stop",
      "swipe",
    ]);
  });

  it("does not allow an extension to shadow a built-in command", () => {
    const registry = new SlashCommandRegistry(createHost());
    expect(() =>
      registry.register({
        name: "stop",
        owner: "fixture",
        description: "shadow",
        execute: () => undefined,
      }),
    ).toThrow(/already registered/u);
  });
});
