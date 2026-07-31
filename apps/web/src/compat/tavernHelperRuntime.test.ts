import { describe, expect, it } from "vitest";

import type { WorkspaceMessage } from "../domain/workspace";
import {
  createTavernHelperMessageView,
  resolveTavernHelperMessageVariables,
} from "./tavernHelperRuntime";

const assistantMessage: WorkspaceMessage = {
  id: "message-assistant",
  conversationId: "conversation-runtime",
  role: "assistant",
  content: "Active response",
  createdLabel: "12:00",
  revision: 1,
  activeSwipeIndex: 1,
  swipes: [
    { id: "swipe-1", content: "First response" },
    { id: "swipe-2", content: "Active response" },
  ],
};

describe("Tavern Helper message compatibility", () => {
  it("exposes the assistant name and aligns variables with the active swipe", () => {
    const variables = { stat_data: { favor: 3 } };
    const view = createTavernHelperMessageView(
      assistantMessage,
      2,
      variables,
      "Fixture card",
    );

    expect(view).toMatchObject({
      message_id: 2,
      name: "Fixture card",
      role: "assistant",
      swipe_id: 1,
      swipes_data: [{}, variables],
    });
  });

  it("accepts MVU initialization written through swipes_data", () => {
    const initialized = {
      initialized_lorebooks: { "Fixture lorebook": [100] },
      stat_data: { world: { time: "day one" } },
    };

    expect(
      resolveTavernHelperMessageVariables(
        { swipes_data: [{ stale: true }, initialized] },
        1,
      ),
    ).toEqual(initialized);
  });
});
