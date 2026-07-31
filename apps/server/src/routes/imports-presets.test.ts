import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerApplication } from "../app.js";

const applications: ServerApplication[] = [];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  return Buffer.concat([
    size,
    Buffer.from(type, "latin1"),
    data,
    Buffer.alloc(4),
  ]);
}

function portablePngCard(): Buffer {
  const metadata = Buffer.from(
    JSON.stringify({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        id: "card-with-avatar",
        name: "Clean-room PNG character",
        description: "A newly authored import fixture.",
        first_mes: "Welcome.",
      },
    }),
  ).toString("base64");
  return Buffer.concat([
    pngSignature,
    pngChunk("tEXt", Buffer.from(`ccv3\u0000${metadata}`, "latin1")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const inertTavernHelper = {
  scripts: [
    {
      type: "script",
      enabled: false,
      name: "Clean-room inert fixture",
      id: "00000000-0000-4000-8000-000000000001",
      content: "/* intentionally inert clean-room fixture */",
      info: "",
      button: {
        enabled: false,
        buttons: [{ name: "Fixture button", visible: false }],
      },
      data: { fixture: "true" },
      export_with: { data: true, button: true },
    },
  ],
  variables: { fixtureVariable: "retained" },
};

function tavernHelperWithContent(content: string) {
  return {
    ...inertTavernHelper,
    scripts: inertTavernHelper.scripts.map((script) => ({
      ...script,
      content,
    })),
  };
}

function multipartConversationImport(input: {
  boundary: string;
  cardId: string;
  filename: string;
  bytes: Buffer;
}): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    input.bytes,
    Buffer.from(
      `\r\n--${input.boundary}\r\nContent-Disposition: form-data; name="cardId"\r\n\r\n${input.cardId}\r\n--${input.boundary}--\r\n`,
    ),
  ]);
}

function presetRegexScripts(replaceString: string) {
  return [
    {
      id: "clean-room-preset-regex",
      scriptName: "Replace a clean-room fixture marker",
      findRegex: "/fixture-marker/gu",
      replaceString,
      trimStrings: [],
      placement: [1, 2],
      disabled: false,
      markdownOnly: false,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
  ];
}

async function application() {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "stn-import-routes-"),
  );
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
  });
  applications.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("portable import routes", () => {
  it("persists and serves the original PNG as the imported card avatar", async () => {
    const { app, context } = await application();
    const source = portablePngCard();
    const response = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "image/png",
        "x-file-name": "clean-room-card.png",
      },
      payload: source,
    });
    expect(response.statusCode).toBe(201);

    const stored = context.store.getCard("card-with-avatar");
    const normalized = stored.legacyPayload.normalized as {
      assets?: Array<{ id: string; path: string; hash?: string }>;
      participants?: Array<{ avatarAssetId?: string }>;
    };
    expect(normalized.assets).toHaveLength(1);
    expect(normalized.assets?.[0]?.path).toMatch(
      /^\/api\/assets\/cards\/[a-f0-9]{64}\.png$/u,
    );
    expect(normalized.assets?.[0]?.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(normalized.participants?.[0]?.avatarAssetId).toBe(
      normalized.assets?.[0]?.id,
    );

    const cards = await app.inject({ method: "GET", url: "/api/cards" });
    expect(cards.statusCode).toBe(200);
    expect(cards.json()).toMatchObject({
      data: [
        {
          id: "card-with-avatar",
          imageUrl: normalized.assets?.[0]?.path,
        },
      ],
    });

    const asset = await app.inject({
      method: "GET",
      url: normalized.assets?.[0]?.path ?? "/missing",
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("image/png");
    expect(asset.rawPayload).toEqual(source);
  });

  it("generates globally unique storage ids for repeated embedded entry ids", async () => {
    const { app, context } = await application();
    const portableCard = (cardId: string) =>
      Buffer.from(
        JSON.stringify({
          spec: "chara_card_v3",
          spec_version: "3.0",
          data: {
            id: cardId,
            name: `Card ${cardId}`,
            character_book: {
              name: `Book ${cardId}`,
              entries: [
                {
                  id: 0,
                  comment: "Repeated source id",
                  keys: ["fixture"],
                  content: `Lore for ${cardId}`,
                  enabled: true,
                  agentEditable: true,
                },
              ],
            },
          },
        }),
      );

    const first = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "first-card.json",
      },
      payload: portableCard("card-entry-id-first"),
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "second-card.json",
      },
      payload: portableCard("card-entry-id-second"),
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const books = context.store.listWorldbooks();
    expect(books).toHaveLength(2);
    const entries = books.flatMap((book) =>
      context.store.listWorldbookEntries(book.id),
    );
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    entries.forEach((entry) => {
      expect(entry).toMatchObject({
        legacyUid: 0,
        agentEditable: false,
        metadata: {
          compatibility: {
            unknownFields: {
              sourceEntryId: 0,
            },
          },
        },
      });
      const book = books.find(
        (candidate) => candidate.id === entry.worldbookId,
      );
      const normalized = book?.legacyPayload.normalized as
        { entries?: Array<{ id: string }> } | undefined;
      expect(normalized?.entries?.[0]?.id).toBe(entry.id);
    });
  });

  it("requires an explicit scoped grant for imported card regexes", async () => {
    const { app, context } = await application();
    const response = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "regex-card.json",
      },
      payload: Buffer.from(
        JSON.stringify({
          spec: "chara_card_v3",
          data: {
            id: "card-regex-grant",
            name: "Regex fixture",
            first_mes: "Hello",
            extensions: {
              regex_scripts: [
                {
                  id: "script-1",
                  scriptName: "Hide marker from the prompt",
                  findRegex: "/<hidden>.*?<\\/hidden>/gs",
                  replaceString: "",
                  trimStrings: [],
                  placement: [2],
                  disabled: false,
                  markdownOnly: false,
                  promptOnly: true,
                  runOnEdit: true,
                  substituteRegex: 0,
                  minDepth: null,
                  maxDepth: null,
                },
              ],
            },
          },
        }),
      ),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: { regexScriptCount: 1 },
    });
    expect(
      context.store.getExtensionSetting("stn.regex", "card:card-regex-grant")
        .value,
    ).toBe(false);

    const grant = await app.inject({
      method: "PUT",
      url: "/api/compatibility/regex-grants",
      payload: { scope: "card", id: "card-regex-grant", granted: true },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json()).toMatchObject({
      data: { scope: "card", id: "card-regex-grant", granted: true },
    });
  });

  it("retains imported Tavern Helper card scripts and records them as disabled", async () => {
    const { app, context } = await application();
    const response = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "helper-card.json",
      },
      payload: Buffer.from(
        JSON.stringify({
          spec: "chara_card_v3",
          spec_version: "3.0",
          data: {
            id: "card-helper-import",
            name: "Helper import fixture",
            extensions: { tavern_helper: inertTavernHelper },
          },
        }),
      ),
    });

    expect(response).toMatchObject({ statusCode: 201 });
    expect(response.json()).toMatchObject({
      data: {
        tavernHelperScriptCount: 1,
        enabledTavernHelperScriptCount: 0,
      },
    });
    expect(
      (
        context.store.getCard("card-helper-import").legacyPayload
          .normalized as {
          extensions: { tavern_helper: unknown };
        }
      ).extensions.tavern_helper,
    ).toEqual(inertTavernHelper);
    expect(
      context.store.getExtensionSetting(
        "stn.tavern-helper",
        "card:card-helper-import",
      ).value,
    ).toBe(false);
  });

  it("imports worldbooks but never imports Agent edit permission", async () => {
    const { app, context } = await application();
    const response = await app.inject({
      method: "POST",
      url: "/api/worldbooks/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "portable-lore.json",
      },
      payload: Buffer.from(
        JSON.stringify({
          id: "worldbook-portable",
          name: "Portable lore",
          agentEditable: true,
          entries: {
            0: {
              uid: 0,
              key: ["moon"],
              content: "The moon gate opens at low tide.",
              agentEditable: true,
            },
          },
        }),
      ),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        worldbook: {
          id: "worldbook-portable",
          agentEditable: false,
        },
        diagnostics: [{ code: "IMPORTED_AGENT_PERMISSION_IGNORED" }],
      },
    });
    expect(context.store.listWorldbookEntries("worldbook-portable")).toEqual([
      expect.objectContaining({
        agentEditable: false,
        permissionUpdatedBy: null,
        permissionUpdatedAt: null,
      }),
    ]);
  });

  it("imports legacy group records as user and model messages", async () => {
    const { app, context } = await application();
    const card = context.store.createCard({
      id: "card-imported-history",
      kind: "ensemble",
      name: "Imported history card",
      participants: [
        {
          id: "participant-imported-history",
          name: "Current card participant",
        },
      ],
    }).card;
    const source = [
      JSON.stringify({
        user_name: "Lin",
        character_name: "Narrator",
        chat_metadata: { cleanRoomFixture: true },
      }),
      JSON.stringify({
        name: "Lin",
        is_user: true,
        mes: "Who is here?",
      }),
      JSON.stringify({
        name: "Narrator",
        is_user: false,
        mes: "Two voices answer.",
      }),
      JSON.stringify({
        name: "Guide",
        is_user: false,
        mes: "I can show the way.",
      }),
    ].join("\n");
    const missingCard = await app.inject({
      method: "POST",
      url: "/api/conversations/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "multi-speaker.jsonl",
      },
      payload: Buffer.from(source),
    });
    expect(missingCard.statusCode).toBe(400);

    const boundary = "stn-clean-room-conversation-import";
    const response = await app.inject({
      method: "POST",
      url: "/api/conversations/import",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartConversationImport({
        boundary,
        cardId: card.id,
        filename: "multi-speaker.jsonl",
        bytes: Buffer.from(source),
      }),
    });
    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
      data: { conversation: { id: string; cardId: string } };
    };
    expect(payload.data.conversation.cardId).toBe(card.id);
    expect(
      context.store.listConversationParticipants(payload.data.conversation.id),
    ).toEqual([
      expect.objectContaining({ id: "participant-imported-history" }),
    ]);
    expect(
      context.store.database.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM conversation_participants
         WHERE conversation_id = ?`,
        payload.data.conversation.id,
      )?.count,
    ).toBe(0);
    expect(
      context.store
        .listMessages(payload.data.conversation.id)
        .map(({ role, participantId, content }) => ({
          role,
          participantId,
          content,
        })),
    ).toEqual([
      { role: "user", participantId: null, content: "Who is here?" },
      {
        role: "assistant",
        participantId: null,
        content: "Narrator: Two voices answer.",
      },
      {
        role: "assistant",
        participantId: null,
        content: "Guide: I can show the way.",
      },
    ]);
  });
});

describe("prompt preset routes", () => {
  const source = {
    name: "Clean-room OpenAI preset",
    temperature: 0.35,
    top_p: 0.9,
    openai_max_tokens: 384,
    prompts: [
      {
        identifier: "main",
        name: "Main",
        role: "system",
        content: "Keep every participant in scope.",
        enabled: true,
      },
    ],
    prompt_order: [{ identifier: "main", enabled: true }],
    future_sampler: { retained: true },
  };

  it("previews, imports, conflicts, edits and exports a preset", async () => {
    const { app } = await application();
    const preview = await app.inject({
      method: "POST",
      url: "/api/presets/preview",
      payload: { source, filename: "clean-room-openai.json" },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      data: {
        detection: { format: "openai" },
        preset: {
          name: "Clean-room OpenAI preset",
          generation: { temperature: 0.35 },
        },
        unknownFields: {
          future_sampler: { retained: true },
        },
      },
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source,
        filename: "clean-room-openai.json",
        conflictStrategy: "duplicate",
      },
    });
    expect(imported.statusCode).toBe(201);
    const importedBody = imported.json() as {
      data: { preset: { id: string; revision: number; payload: unknown } };
    };

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source,
        filename: "clean-room-openai.json",
        conflictStrategy: "duplicate",
      },
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toMatchObject({
      data: { action: "duplicate" },
    });

    const normalized = importedBody.data.preset.payload as {
      id: string;
      name: string;
      prompts: unknown[];
      generation: object;
      extensions: object;
      createdAt: string;
      updatedAt: string;
    };
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedBody.data.preset.id)}`,
      payload: {
        expectedRevision: importedBody.data.preset.revision,
        preset: { ...normalized, name: "Edited clean-room preset" },
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      data: { name: "Edited clean-room preset", revision: 2 },
    });

    const exported = await app.inject({
      method: "GET",
      url: `/api/presets/${encodeURIComponent(
        importedBody.data.preset.id,
      )}/export?target=sillytavern`,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("application/json");
    expect(exported.json()).toMatchObject({
      temperature: 0.35,
      future_sampler: { retained: true },
    });
  });

  it("updates generation controls with revision checks and preserves legacy fields", async () => {
    const { app } = await application();
    const imported = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: { source, filename: "clean-room-generation.json" },
    });
    expect(imported.statusCode).toBe(201);
    const importedPreset = (
      imported.json() as {
        data: { preset: { id: string; revision: number } };
      }
    ).data.preset;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}/generation`,
      payload: {
        expectedRevision: importedPreset.revision,
        generation: {
          temperature: 1.25,
          topP: 0.72,
          frequencyPenalty: -0.2,
          presencePenalty: 0.35,
          maxOutputTokens: 2048,
          n: 3,
          stream: false,
          additional: {
            maxContextTokens: 200_000,
            maxContextUnlocked: true,
          },
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      data: {
        revision: importedPreset.revision + 1,
        payload: {
          generation: {
            temperature: 1.25,
            topP: 0.72,
            frequencyPenalty: -0.2,
            presencePenalty: 0.35,
            maxOutputTokens: 2048,
            n: 3,
            stream: false,
            additional: {
              maxContextTokens: 200_000,
              maxContextUnlocked: true,
            },
          },
        },
      },
    });

    const exported = await app.inject({
      method: "GET",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/export` +
        "?target=sillytavern&format=openai",
    });
    expect(exported.json()).toMatchObject({
      openai_max_context: 200_000,
      max_context_unlocked: true,
      openai_max_tokens: 2048,
      n: 3,
      stream_openai: false,
      temperature: 1.25,
      top_p: 0.72,
    });

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}/generation`,
      payload: {
        expectedRevision: importedPreset.revision,
        generation: { temperature: 0.1 },
      },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("keeps optional prompt definitions and supports per-prompt activation and content edits", async () => {
    const { app } = await application();
    const optionalSource = {
      name: "Clean-room selectable prompts",
      prompts: [
        {
          identifier: "active-rule",
          name: "Active rule",
          role: "system",
          content: "ACTIVE_CONTENT",
          enabled: true,
        },
        {
          identifier: "optional-rule",
          name: "Optional rule",
          role: "system",
          content: "ORIGINAL_OPTIONAL_CONTENT",
          enabled: true,
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [{ identifier: "active-rule", enabled: true }],
        },
      ],
    };
    const imported = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source: optionalSource,
        filename: "clean-room-selectable-prompts.json",
      },
    });
    expect(imported.statusCode).toBe(201);
    const importedPreset = (
      imported.json() as {
        data: {
          preset: {
            id: string;
            revision: number;
            payload: {
              prompts: Array<{
                id: string;
                content: string;
                enabled: boolean;
                order: number;
                metadata: { promptOrderMember?: boolean };
              }>;
            };
          };
        };
      }
    ).data.preset;
    expect(importedPreset.payload.prompts).toHaveLength(2);
    expect(
      importedPreset.payload.prompts.find(
        (prompt) => prompt.id === "optional-rule",
      ),
    ).toMatchObject({
      content: "ORIGINAL_OPTIONAL_CONTENT",
      enabled: false,
      metadata: { promptOrderMember: false },
    });

    const inserted = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("optional-rule"),
      payload: {
        expectedRevision: importedPreset.revision,
        inserted: true,
      },
    });
    expect(inserted.statusCode).toBe(200);
    const insertedPreset = (
      inserted.json() as {
        data: {
          revision: number;
          payload: {
            prompts: Array<{
              id: string;
              content: string;
              enabled: boolean;
              order: number;
              metadata: {
                promptOrderIndex?: number;
                promptOrderMember?: boolean;
              };
            }>;
          };
        };
      }
    ).data;
    expect(insertedPreset.revision).toBe(2);
    expect(
      insertedPreset.payload.prompts.find(
        (prompt) => prompt.id === "optional-rule",
      ),
    ).toMatchObject({
      content: "ORIGINAL_OPTIONAL_CONTENT",
      enabled: false,
      order: 1,
      metadata: { promptOrderIndex: 1, promptOrderMember: true },
    });

    const enabled = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("optional-rule"),
      payload: {
        expectedRevision: insertedPreset.revision,
        enabled: true,
      },
    });
    expect(enabled.statusCode).toBe(200);
    const enabledPreset = (
      enabled.json() as {
        data: {
          revision: number;
          payload: {
            prompts: Array<{
              id: string;
              content: string;
              enabled: boolean;
              order: number;
              metadata: {
                promptOrderIndex?: number;
                promptOrderMember?: boolean;
              };
            }>;
          };
        };
      }
    ).data;
    expect(enabledPreset.revision).toBe(3);
    expect(
      enabledPreset.payload.prompts.find(
        (prompt) => prompt.id === "optional-rule",
      ),
    ).toMatchObject({
      content: "ORIGINAL_OPTIONAL_CONTENT",
      enabled: true,
      order: 1,
      metadata: { promptOrderIndex: 1, promptOrderMember: true },
    });

    const edited = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("optional-rule"),
      payload: {
        expectedRevision: enabledPreset.revision,
        content: "EDITED_OPTIONAL_CONTENT",
      },
    });
    expect(edited.statusCode).toBe(200);
    const editedPreset = (
      edited.json() as {
        data: {
          revision: number;
          payload: {
            prompts: Array<{
              id: string;
              content: string;
              enabled: boolean;
            }>;
          };
        };
      }
    ).data;
    expect(editedPreset.revision).toBe(4);
    expect(
      editedPreset.payload.prompts.find(
        (prompt) => prompt.id === "active-rule",
      ),
    ).toMatchObject({
      content: "ACTIVE_CONTENT",
      enabled: true,
    });
    expect(
      editedPreset.payload.prompts.find(
        (prompt) => prompt.id === "optional-rule",
      ),
    ).toMatchObject({
      content: "EDITED_OPTIONAL_CONTENT",
      enabled: true,
    });

    const exported = await app.inject({
      method: "GET",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/export` +
        "?target=sillytavern&format=openai",
    });
    expect(exported.statusCode).toBe(200);
    const exportedPreset = exported.json() as {
      prompts: Array<{ identifier: string; content: string }>;
      prompt_order: Array<{
        character_id: number;
        order: Array<{ identifier: string; enabled: boolean }>;
      }>;
    };
    expect(
      exportedPreset.prompts.find(
        (prompt) => prompt.identifier === "optional-rule",
      ),
    ).toMatchObject({
      content: "EDITED_OPTIONAL_CONTENT",
    });
    expect(exportedPreset.prompt_order).toEqual([
      {
        character_id: 100001,
        order: [
          { identifier: "active-rule", enabled: true },
          { identifier: "optional-rule", enabled: true },
        ],
      },
    ]);

    const stale = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("optional-rule"),
      payload: {
        expectedRevision: 1,
        enabled: false,
      },
    });
    expect(stale.statusCode).toBe(409);

    const missing = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("missing-rule"),
      payload: {
        expectedRevision: 4,
        content: "No target.",
      },
    });
    expect(missing.statusCode).toBe(404);

    const emptyPatch = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("optional-rule"),
      payload: { expectedRevision: 4 },
    });
    expect(emptyPatch.statusCode).toBe(400);

    const detached = await app.inject({
      method: "PATCH",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/prompts/` +
        encodeURIComponent("optional-rule"),
      payload: {
        expectedRevision: 4,
        inserted: false,
      },
    });
    expect(detached.statusCode).toBe(200);
    const detachedPreset = (
      detached.json() as {
        data: {
          revision: number;
          payload: {
            prompts: Array<{
              id: string;
              enabled: boolean;
              metadata: { promptOrderMember?: boolean };
            }>;
          };
        };
      }
    ).data;
    expect(detachedPreset.revision).toBe(5);
    expect(
      detachedPreset.payload.prompts.find(
        (prompt) => prompt.id === "optional-rule",
      ),
    ).toMatchObject({
      enabled: false,
      metadata: { promptOrderMember: false },
    });

    const detachedExport = await app.inject({
      method: "GET",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/export` +
        "?target=sillytavern&format=openai",
    });
    expect(detachedExport.statusCode).toBe(200);
    expect(detachedExport.json()).toMatchObject({
      prompt_order: [
        {
          character_id: 100001,
          order: [{ identifier: "active-rule", enabled: true }],
        },
      ],
    });
  });

  it("reorders every inserted prompt atomically and exports the new order", async () => {
    const { app } = await application();
    const imported = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        filename: "clean-room-reorder-prompts.json",
        source: {
          name: "Clean-room reorder prompts",
          prompts: [
            {
              identifier: "first",
              name: "First",
              role: "system",
              content: "FIRST",
              enabled: true,
            },
            {
              identifier: "second",
              name: "Second",
              role: "system",
              content: "SECOND",
              enabled: false,
            },
            {
              identifier: "spare",
              name: "Spare",
              role: "system",
              content: "SPARE",
              enabled: true,
            },
          ],
          prompt_order: [
            {
              character_id: 100001,
              order: [
                { identifier: "first", enabled: true },
                { identifier: "second", enabled: false },
              ],
            },
          ],
        },
      },
    });
    expect(imported.statusCode).toBe(201);
    const importedPreset = (
      imported.json() as {
        data: {
          preset: {
            id: string;
            revision: number;
          };
        };
      }
    ).data.preset;

    const reordered = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}/prompt-order`,
      payload: {
        expectedRevision: importedPreset.revision,
        promptIds: ["second", "first"],
      },
    });
    expect(reordered.statusCode).toBe(200);
    const reorderedPreset = (
      reordered.json() as {
        data: {
          revision: number;
          payload: {
            prompts: Array<{
              id: string;
              order: number;
              metadata: { promptOrderIndex?: number };
            }>;
          };
        };
      }
    ).data;
    expect(reorderedPreset.revision).toBe(2);
    expect(
      reorderedPreset.payload.prompts
        .filter((prompt) => prompt.id !== "spare")
        .sort((left, right) => left.order - right.order)
        .map((prompt) => ({
          id: prompt.id,
          order: prompt.order,
          promptOrderIndex: prompt.metadata.promptOrderIndex,
        })),
    ).toEqual([
      { id: "second", order: 0, promptOrderIndex: 0 },
      { id: "first", order: 1, promptOrderIndex: 1 },
    ]);

    const exported = await app.inject({
      method: "GET",
      url:
        `/api/presets/${encodeURIComponent(importedPreset.id)}/export` +
        "?target=sillytavern&format=openai",
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: "second", enabled: false },
            { identifier: "first", enabled: true },
          ],
        },
      ],
    });

    const incomplete = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}/prompt-order`,
      payload: {
        expectedRevision: reorderedPreset.revision,
        promptIds: ["first", "spare"],
      },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json()).toMatchObject({
      error: { code: "invalid_prompt_order" },
    });

    const duplicate = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}/prompt-order`,
      payload: {
        expectedRevision: reorderedPreset.revision,
        promptIds: ["first", "first"],
      },
    });
    expect(duplicate.statusCode).toBe(400);

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}/prompt-order`,
      payload: {
        expectedRevision: importedPreset.revision,
        promptIds: ["first", "second"],
      },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("round-trips Tavern Helper preset scripts and preserves them across ordinary edits", async () => {
    const { app, context } = await application();
    const helperSource = {
      ...source,
      name: "Clean-room helper preset",
      extensions: { tavern_helper: inertTavernHelper },
    };
    const imported = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source: helperSource,
        filename: "clean-room-helper-preset.json",
        conflictStrategy: "duplicate",
      },
    });
    expect(imported).toMatchObject({ statusCode: 201 });
    expect(imported.json()).toMatchObject({
      data: {
        tavernHelperScriptCount: 1,
        enabledTavernHelperScriptCount: 0,
      },
    });
    const importedPreset = (
      imported.json() as {
        data: {
          preset: {
            id: string;
            revision: number;
            payload: Record<string, unknown>;
          };
        };
      }
    ).data.preset;
    expect(
      context.store.getExtensionSetting(
        "stn.tavern-helper",
        `preset:${importedPreset.id}`,
      ).value,
    ).toBe(false);

    const normalized = importedPreset.payload as {
      extensions: Record<string, unknown>;
      [key: string]: unknown;
    };
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/presets/${encodeURIComponent(importedPreset.id)}`,
      payload: {
        expectedRevision: importedPreset.revision,
        preset: {
          ...normalized,
          name: "Edited helper preset",
          extensions: {},
        },
      },
    });
    expect(patched).toMatchObject({ statusCode: 200 });

    const exported = await app.inject({
      method: "GET",
      url: `/api/presets/${encodeURIComponent(
        importedPreset.id,
      )}/export?target=sillytavern`,
    });
    expect(exported).toMatchObject({ statusCode: 200 });
    expect(exported.json()).toMatchObject({
      name: "Edited helper preset",
      extensions: { tavern_helper: inertTavernHelper },
    });
  });

  it("resets executable grants when replace or merge changes imported bundles", async () => {
    const { app, context } = await application();
    const presetName = "Executable grant conflict fixture";
    const imported = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source: {
          ...source,
          name: presetName,
          extensions: {
            regex_scripts: presetRegexScripts("initial"),
            tavern_helper: tavernHelperWithContent("/* initial */"),
          },
        },
        filename: "executable-grant-conflict.json",
        conflictStrategy: "duplicate",
      },
    });
    expect(imported).toMatchObject({ statusCode: 201 });
    const presetId = (imported.json() as { data: { preset: { id: string } } })
      .data.preset.id;
    const settingKey = `preset:${presetId}`;
    const grantBoth = () => {
      context.store.setExtensionSetting("stn.regex", settingKey, true);
      context.store.setExtensionSetting("stn.tavern-helper", settingKey, true);
    };
    const expectBothRevoked = () => {
      expect(
        context.store.getExtensionSetting("stn.regex", settingKey).value,
      ).toBe(false);
      expect(
        context.store.getExtensionSetting("stn.tavern-helper", settingKey)
          .value,
      ).toBe(false);
    };

    grantBoth();
    const replaced = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source: {
          ...source,
          name: presetName,
          extensions: {
            regex_scripts: presetRegexScripts("replaced"),
            tavern_helper: tavernHelperWithContent("/* replaced */"),
          },
        },
        filename: "executable-grant-replace.json",
        conflictStrategy: "replace",
      },
    });
    expect(replaced).toMatchObject({ statusCode: 200 });
    expect(replaced.json()).toMatchObject({
      data: { action: "replace", preset: { id: presetId } },
    });
    expectBothRevoked();

    grantBoth();
    const merged = await app.inject({
      method: "POST",
      url: "/api/presets/import",
      payload: {
        source: {
          ...source,
          name: presetName,
          extensions: {
            regex_scripts: presetRegexScripts("merged"),
            tavern_helper: tavernHelperWithContent("/* merged */"),
          },
        },
        filename: "executable-grant-merge.json",
        conflictStrategy: "merge",
      },
    });
    expect(merged).toMatchObject({ statusCode: 200 });
    expect(merged.json()).toMatchObject({
      data: { action: "merge", preset: { id: presetId } },
    });
    expectBothRevoked();
  });

  it("preserves unchanged PATCH grants and revokes only the changed bundle", async () => {
    const { app, context } = await application();
    const presetId = "preset-patch-grant-fixture";
    const timestamp = "2026-07-29T00:00:00.000Z";
    const initialPayload = {
      id: presetId,
      name: "PATCH grant fixture",
      mode: "native" as const,
      prompts: [],
      generation: { stop: [], samplerOrder: [], additional: {} },
      extensions: {
        regex_scripts: presetRegexScripts("initial"),
        tavern_helper: tavernHelperWithContent("/* initial */"),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const stored = context.store.createPreset({
      id: presetId,
      name: initialPayload.name,
      kind: initialPayload.mode,
      payload: initialPayload,
    });
    const settingKey = `preset:${presetId}`;
    context.store.setExtensionSetting("stn.regex", settingKey, true);
    context.store.setExtensionSetting("stn.tavern-helper", settingKey, true);

    const ordinaryEdit = await app.inject({
      method: "PATCH",
      url: `/api/presets/${presetId}`,
      payload: {
        expectedRevision: stored.revision,
        preset: { ...initialPayload, name: "Ordinary PATCH edit" },
      },
    });
    expect(ordinaryEdit).toMatchObject({ statusCode: 200 });
    expect(
      context.store.getExtensionSetting("stn.regex", settingKey).value,
    ).toBe(true);
    expect(
      context.store.getExtensionSetting("stn.tavern-helper", settingKey).value,
    ).toBe(true);

    const afterOrdinary = (
      ordinaryEdit.json() as {
        data: {
          revision: number;
          payload: typeof initialPayload;
        };
      }
    ).data;
    const regexEdit = await app.inject({
      method: "PATCH",
      url: `/api/presets/${presetId}`,
      payload: {
        expectedRevision: afterOrdinary.revision,
        preset: {
          ...afterOrdinary.payload,
          extensions: {
            ...afterOrdinary.payload.extensions,
            regex_scripts: presetRegexScripts("changed by PATCH"),
          },
        },
      },
    });
    expect(regexEdit).toMatchObject({ statusCode: 200 });
    expect(
      context.store.getExtensionSetting("stn.regex", settingKey).value,
    ).toBe(false);
    expect(
      context.store.getExtensionSetting("stn.tavern-helper", settingKey).value,
    ).toBe(true);

    context.store.setExtensionSetting("stn.regex", settingKey, true);
    const afterRegex = (
      regexEdit.json() as {
        data: {
          revision: number;
          payload: typeof initialPayload;
        };
      }
    ).data;
    const helperEdit = await app.inject({
      method: "PATCH",
      url: `/api/presets/${presetId}`,
      payload: {
        expectedRevision: afterRegex.revision,
        preset: {
          ...afterRegex.payload,
          extensions: {
            ...afterRegex.payload.extensions,
            tavern_helper: tavernHelperWithContent("/* changed by PATCH */"),
          },
        },
      },
    });
    expect(helperEdit).toMatchObject({ statusCode: 200 });
    expect(
      context.store.getExtensionSetting("stn.regex", settingKey).value,
    ).toBe(true);
    expect(
      context.store.getExtensionSetting("stn.tavern-helper", settingKey).value,
    ).toBe(false);
  });
});
