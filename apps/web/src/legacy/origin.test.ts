import { describe, expect, it } from "vitest";

import { legacyHostOrigin } from "./origin";

describe("legacy host loopback origin", () => {
  it("keeps the active loopback hostname when selecting the isolated host", () => {
    expect(legacyHostOrigin("http://localhost:4173")).toBe(
      "http://localhost:4711",
    );
    expect(legacyHostOrigin("http://127.0.0.1:4173")).toBe(
      "http://localhost:4711",
    );
    expect(legacyHostOrigin("http://[::1]:4173")).toBe("http://localhost:4711");
  });

  it("does not derive an arbitrary remote legacy origin", () => {
    expect(legacyHostOrigin("https://workspace.example")).toBe(
      "http://localhost:4711",
    );
  });
});
