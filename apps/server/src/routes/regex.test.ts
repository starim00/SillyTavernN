import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerApplication } from "../app.js";

const applications: ServerApplication[] = [];

function regexScript(id: string, findRegex: string, replaceString: string) {
  return {
    id,
    scriptName: id,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
}

async function application(): Promise<ServerApplication> {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "stn-regex-routes-"));
  const created = await createServer({
    authentication: false,
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
  });
  applications.push(created);
  return created;
}

async function seedRegexWorkspace(created: ServerApplication) {
  const cardScript = regexScript("card-chain", "preset", "card");
  const imported = await created.app.inject({
    method: "POST",
    url: "/api/cards/import",
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": "regex-scope-card.json",
    },
    payload: Buffer.from(
      JSON.stringify({
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
          id: "card-regex-scopes",
          name: "Regex scope fixture",
          first_mes: "seed",
          extensions: { regex_scripts: [cardScript] },
        },
      }),
    ),
  });
  expect(imported.statusCode).toBe(201);
  const cardId = (imported.json() as { data: { card: { id: string } } }).data
    .card.id;

  const now = "2026-07-30T00:00:00.000Z";
  const presetId = "preset-regex-scopes";
  created.context.store.createPreset({
    id: presetId,
    name: "Regex preset fixture",
    kind: "native",
    payload: {
      id: presetId,
      name: "Regex preset fixture",
      mode: "native",
      prompts: [],
      generation: { stop: [], samplerOrder: [], additional: {} },
      extensions: {
        regex_scripts: [regexScript("preset-chain", "global", "preset")],
      },
      createdAt: now,
      updatedAt: now,
    },
  });

  const conversation = await created.app.inject({
    method: "POST",
    url: "/api/conversations",
    payload: { title: "Regex scope conversation", cardId },
  });
  expect(conversation.statusCode).toBe(201);
  const conversationId = (conversation.json() as { data: { id: string } }).data
    .id;

  return { cardId, cardScript, conversationId, presetId };
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("regex scope routes", () => {
  it("lists global, preset, and card scopes without hiding disabled imported scripts", async () => {
    const created = await application();
    const { cardId, cardScript, presetId } = await seedRegexWorkspace(created);

    const response = await created.app.inject({
      method: "GET",
      url: "/api/regex/scopes",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: [
        {
          scope: "global",
          id: "global",
          enabled: true,
          revision: 0,
          scripts: [],
        },
        {
          scope: "preset",
          id: presetId,
          enabled: false,
          revision: 0,
          scripts: [
            {
              id: "preset-chain",
              findRegex: "global",
              replaceString: "preset",
            },
          ],
        },
        {
          scope: "card",
          id: cardId,
          enabled: false,
          revision: 0,
          scripts: [cardScript],
        },
      ],
    });
  });

  it("patches each source and applies display regexes in global, preset, card order without changing raw content", async () => {
    const created = await application();
    const { cardId, conversationId, presetId } =
      await seedRegexWorkspace(created);
    const messagesUrl =
      `/api/conversations/${conversationId}/messages` + `?presetId=${presetId}`;

    const initial = await created.app.inject({
      method: "GET",
      url: messagesUrl,
    });
    expect(initial.json()).toMatchObject({
      data: {
        items: [
          {
            content: "seed",
            displayContent: "seed",
            appliedRegexScriptIds: [],
          },
        ],
      },
    });

    const globalPatch = await created.app.inject({
      method: "PATCH",
      url: "/api/regex/scopes/global/global",
      payload: {
        expectedRevision: 0,
        enabled: true,
        scripts: [regexScript("global-chain", "seed", "global")],
      },
    });
    expect(globalPatch.statusCode).toBe(200);
    expect(globalPatch.json()).toMatchObject({
      data: {
        scope: "global",
        id: "global",
        enabled: true,
        revision: 1,
        scripts: [{ id: "global-chain" }],
      },
    });

    const globalOnly = await created.app.inject({
      method: "GET",
      url: messagesUrl,
    });
    expect(globalOnly.json()).toMatchObject({
      data: {
        items: [
          {
            content: "seed",
            displayContent: "global",
            appliedRegexScriptIds: ["global-chain"],
          },
        ],
      },
    });

    const presetPatch = await created.app.inject({
      method: "PATCH",
      url: `/api/regex/scopes/preset/${presetId}`,
      payload: { expectedRevision: 0, enabled: true },
    });
    expect(presetPatch.statusCode).toBe(200);
    expect(presetPatch.json()).toMatchObject({
      data: {
        scope: "preset",
        id: presetId,
        enabled: true,
        revision: 1,
        scripts: [{ id: "preset-chain" }],
      },
    });

    const globalAndPreset = await created.app.inject({
      method: "GET",
      url: messagesUrl,
    });
    expect(globalAndPreset.json()).toMatchObject({
      data: {
        items: [
          {
            content: "seed",
            displayContent: "preset",
            appliedRegexScriptIds: ["global-chain", "preset-chain"],
          },
        ],
      },
    });

    const cardPatch = await created.app.inject({
      method: "PATCH",
      url: `/api/regex/scopes/card/${cardId}`,
      payload: { expectedRevision: 0, enabled: true },
    });
    expect(cardPatch.statusCode).toBe(200);
    expect(cardPatch.json()).toMatchObject({
      data: {
        scope: "card",
        id: cardId,
        enabled: true,
        revision: 1,
        scripts: [{ id: "card-chain" }],
      },
    });

    const allSources = await created.app.inject({
      method: "GET",
      url: messagesUrl,
    });
    const allSourcesBody = allSources.json() as {
      data: {
        items: Array<{
          id: string;
          content: string;
          displayContent: string;
          appliedRegexScriptIds: string[];
        }>;
      };
    };
    expect(allSourcesBody.data.items[0]).toMatchObject({
      content: "seed",
      displayContent: "card",
      appliedRegexScriptIds: ["global-chain", "preset-chain", "card-chain"],
    });
    expect(
      created.context.store.getMessage(allSourcesBody.data.items[0]?.id ?? ""),
    ).toMatchObject({ content: "seed" });
  });

  it("rejects stale revisions and duplicate script ids without changing the stored scope", async () => {
    const created = await application();
    const firstScript = regexScript("only-id", "seed", "global");

    const saved = await created.app.inject({
      method: "PATCH",
      url: "/api/regex/scopes/global/global",
      payload: {
        expectedRevision: 0,
        enabled: true,
        scripts: [firstScript],
      },
    });
    expect(saved.statusCode).toBe(200);

    const stale = await created.app.inject({
      method: "PATCH",
      url: "/api/regex/scopes/global/global",
      payload: { expectedRevision: 0, enabled: false },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: "revision_conflict",
        details: { expectedRevision: 0, actualRevision: 1 },
      },
    });

    const duplicate = await created.app.inject({
      method: "PATCH",
      url: "/api/regex/scopes/global/global",
      payload: {
        expectedRevision: 1,
        scripts: [firstScript, { ...firstScript, replaceString: "duplicate" }],
      },
    });
    expect(duplicate.statusCode).toBe(409);
    const duplicateBody = duplicate.json() as {
      error: { code: string; message: string };
    };
    expect(duplicateBody.error.code).toBe("revision_conflict");
    expect(duplicateBody.error.message).toContain("duplicate script ids");

    const afterConflicts = await created.app.inject({
      method: "GET",
      url: "/api/regex/scopes",
    });
    expect(afterConflicts.json()).toMatchObject({
      data: [
        {
          scope: "global",
          id: "global",
          enabled: true,
          revision: 1,
          scripts: [firstScript],
        },
      ],
    });
  });
});
