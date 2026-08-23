import { describe, expect, it } from "vitest";

import {
  LEGACY_PLUGIN_PROFILES,
  getLegacyPluginProfileByUiId,
} from "./profiles.js";

describe("legacy plugin execution profiles", () => {
  it("pins one native execution owner and disables duplicate legacy realms", () => {
    expect(Object.values(LEGACY_PLUGIN_PROFILES)).toHaveLength(2);
    for (const profile of Object.values(LEGACY_PLUGIN_PROFILES)) {
      expect(profile.executionOwner).toBe("native");
      expect(profile.legacyRealmRole).toBe("none");
      expect(getLegacyPluginProfileByUiId(profile.uiId)?.id).toBe(profile.id);
    }
  });
});
