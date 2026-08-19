import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserIdentifier } from "./browserIdentifier";

describe("createBrowserIdentifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when the browser exposes it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "secure-uuid" });

    expect(createBrowserIdentifier()).toBe("secure-uuid");
  });

  it("falls back when randomUUID is unavailable in an insecure context", () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createBrowserIdentifier()).toBe("loyw3v28-i");
  });
});
