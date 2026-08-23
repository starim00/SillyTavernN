import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { isJsonObject, sanitizeJsonValue } from "@stn/core";
import type { JsonObject, JsonValue } from "@stn/contracts";
import {
  deniedLegacyCapability,
  getLegacyPluginLock,
  legacyActorSchema,
  legacyRpcCapability,
  legacyRpcSuccess,
  legacyRpcRequestSchema,
} from "@stn/legacy-compat";

import { envelope, type ServerContext } from "../context.js";
import {
  normalizedCardPayload,
  normalizedPreset,
} from "../normalized-content.js";

const rootSettingsKey = "__root__";

const legacyPluginOnlyMethods = new Set([
  "character.current.read",
  "preset.current.read",
]);
const embeddedScriptOnlyMethods = new Set([
  "character.scripts.read",
  "preset.scripts.read",
]);

const tavernHelperExtensionKeys = new Set([
  "tavern_helper",
  "TavernHelper_scripts",
  "TavernHelper_characterScriptVariables",
]);

function projectLegacyPluginValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(projectLegacyPluginValue);
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const projected: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (!tavernHelperExtensionKeys.has(key)) {
      projected[key] = projectLegacyPluginValue(nested);
    }
  }
  return projected;
}

function projectLegacyPluginExtensions(extensions: JsonObject): JsonObject {
  return projectLegacyPluginValue(extensions) as JsonObject;
}

function projectEmbeddedScriptExtensions(extensions: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(extensions).filter(([key]) =>
      tavernHelperExtensionKeys.has(key),
    ),
  );
}

export async function registerLegacyBrokerRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/legacy/grants", async () =>
    envelope(
      context.store.database.all<{
        plugin_id: string;
        actor: string;
        capability: string;
        granted: number;
        granted_by: string;
        updated_at: string;
      }>(
        `SELECT * FROM legacy_capability_grants
         ORDER BY plugin_id, actor, capability`,
      ),
    ),
  );

  app.put("/api/legacy/grants", async (request) => {
    const input = z
      .object({
        pluginId: z.string().trim().min(1).max(256),
        actor: legacyActorSchema.default("legacy-plugin"),
        capability: z.string().trim().min(1).max(512),
        granted: z.boolean(),
      })
      .strict()
      .parse(request.body);
    if (!getLegacyPluginLock(input.pluginId)) {
      throw new Error(`Unknown pinned legacy plugin '${input.pluginId}'.`);
    }
    const now = new Date().toISOString();
    context.store.database.run(
      `INSERT INTO legacy_capability_grants(
         plugin_id, actor, capability, granted, granted_by, updated_at
       ) VALUES (?, ?, ?, ?, 'local-user', ?)
       ON CONFLICT(plugin_id, actor, capability)
       DO UPDATE SET
         granted = excluded.granted,
         granted_by = excluded.granted_by,
         updated_at = excluded.updated_at`,
      input.pluginId,
      input.actor,
      input.capability,
      input.granted ? 1 : 0,
      now,
    );
    return envelope({ ...input, grantedBy: "local-user", updatedAt: now });
  });

  app.post("/api/legacy/rpc", async (request, reply) => {
    const rpc = legacyRpcRequestSchema.parse(request.body);
    if (!getLegacyPluginLock(rpc.pluginId)) {
      return reply
        .code(404)
        .send(
          deniedLegacyCapability(
            rpc,
            "The plugin is not a pinned compatibility target.",
          ),
        );
    }
    const requiredCapability = legacyRpcCapability(rpc.method);
    if (
      !requiredCapability ||
      rpc.capability !== requiredCapability ||
      (legacyPluginOnlyMethods.has(rpc.method) &&
        rpc.actor !== "legacy-plugin") ||
      (embeddedScriptOnlyMethods.has(rpc.method) &&
        rpc.actor !== "embedded-script")
    ) {
      return reply
        .code(403)
        .send(
          deniedLegacyCapability(
            rpc,
            `Legacy RPC method '${rpc.method}' is not exposed for capability '${rpc.capability}'.`,
          ),
        );
    }
    const grant = context.store.database.get<{ granted: number }>(
      `SELECT granted FROM legacy_capability_grants
       WHERE plugin_id = ? AND actor = ? AND capability = ?`,
      rpc.pluginId,
      rpc.actor,
      rpc.capability,
    );
    if (grant?.granted !== 1) {
      return reply.code(403).send(deniedLegacyCapability(rpc));
    }

    if (rpc.method === "settings.load") {
      try {
        return legacyRpcSuccess(
          rpc.id,
          context.store.getExtensionSetting(rpc.pluginId, rootSettingsKey)
            .value,
        );
      } catch {
        return legacyRpcSuccess(rpc.id, {});
      }
    }
    if (rpc.method === "settings.save") {
      const params = z
        .object({ value: z.unknown() })
        .strict()
        .parse(rpc.params);
      const value = sanitizeJsonValue(params.value);
      return legacyRpcSuccess(
        rpc.id,
        context.store.setExtensionSetting(rpc.pluginId, rootSettingsKey, value),
      );
    }
    if (rpc.method === "settings.get") {
      const params = z
        .object({ key: z.string().trim().min(1).max(512) })
        .strict()
        .parse(rpc.params);
      try {
        return legacyRpcSuccess(
          rpc.id,
          context.store.getExtensionSetting(rpc.pluginId, params.key).value,
        );
      } catch {
        return legacyRpcSuccess(rpc.id, null);
      }
    }
    if (rpc.method === "settings.set") {
      const params = z
        .object({
          key: z.string().trim().min(1).max(512),
          value: z.unknown(),
        })
        .strict()
        .parse(rpc.params);
      const value = sanitizeJsonValue(params.value);
      return legacyRpcSuccess(
        rpc.id,
        context.store.setExtensionSetting(rpc.pluginId, params.key, value),
      );
    }
    if (rpc.method === "character.current.read") {
      const params = z
        .object({ conversationId: z.string().trim().min(1).max(256) })
        .strict()
        .parse(rpc.params);
      const conversation = context.store.getConversation(params.conversationId);
      if (!conversation.cardId) {
        return legacyRpcSuccess(rpc.id, {
          conversationId: conversation.id,
          card: null,
        });
      }
      const card = context.store.getCard(conversation.cardId);
      const normalized = normalizedCardPayload(card);
      const extensions = projectLegacyPluginExtensions(
        isJsonObject(normalized.extensions) ? normalized.extensions : {},
      );
      return legacyRpcSuccess(rpc.id, {
        conversationId: conversation.id,
        id: card.id,
        revision: card.revision,
        chid: 0,
        character: {
          name: card.name,
          avatar: `${card.id}.png`,
          data: {
            name: card.name,
            extensions,
          },
        },
      });
    }
    if (rpc.method === "character.scripts.read") {
      const params = z
        .object({ conversationId: z.string().trim().min(1).max(256) })
        .strict()
        .parse(rpc.params);
      const conversation = context.store.getConversation(params.conversationId);
      if (!conversation.cardId) {
        return legacyRpcSuccess(rpc.id, {
          conversationId: conversation.id,
          extensions: {},
        });
      }
      const card = context.store.getCard(conversation.cardId);
      const normalized = normalizedCardPayload(card);
      return legacyRpcSuccess(rpc.id, {
        conversationId: conversation.id,
        id: card.id,
        revision: card.revision,
        extensions: projectEmbeddedScriptExtensions(
          isJsonObject(normalized.extensions) ? normalized.extensions : {},
        ),
      });
    }
    if (rpc.method === "preset.current.read") {
      const params = z
        .object({ presetId: z.string().trim().min(1).max(256) })
        .strict()
        .parse(rpc.params);
      const preset = context.store.getPreset(params.presetId);
      const normalizedExtensions =
        normalizedPreset(preset)?.extensions ??
        (isJsonObject(preset.payload.extensions)
          ? preset.payload.extensions
          : {});
      const legacySource = isJsonObject(normalizedExtensions.legacySource)
        ? normalizedExtensions.legacySource
        : undefined;
      const extensions = projectLegacyPluginExtensions(
        legacySource && isJsonObject(legacySource.extensions)
          ? legacySource.extensions
          : normalizedExtensions,
      );
      return legacyRpcSuccess(rpc.id, {
        id: preset.id,
        revision: preset.revision,
        preset: {
          name: preset.name,
          extensions,
        },
      });
    }
    if (rpc.method === "preset.scripts.read") {
      const params = z
        .object({ presetId: z.string().trim().min(1).max(256) })
        .strict()
        .parse(rpc.params);
      const preset = context.store.getPreset(params.presetId);
      const normalizedExtensions =
        normalizedPreset(preset)?.extensions ??
        (isJsonObject(preset.payload.extensions)
          ? preset.payload.extensions
          : {});
      const legacySource = isJsonObject(normalizedExtensions.legacySource)
        ? normalizedExtensions.legacySource
        : undefined;
      return legacyRpcSuccess(rpc.id, {
        id: preset.id,
        revision: preset.revision,
        extensions: projectEmbeddedScriptExtensions(
          legacySource && isJsonObject(legacySource.extensions)
            ? legacySource.extensions
            : normalizedExtensions,
        ),
      });
    }
    if (rpc.method === "chat.snapshot") {
      const params = z
        .object({ conversationId: z.string().trim().min(1).max(256) })
        .strict()
        .parse(rpc.params);
      return legacyRpcSuccess(rpc.id, {
        conversation: context.store.getConversation(params.conversationId),
        messages: context.store.listChatMessages(params.conversationId),
        // Provider connections and secrets are deliberately absent.
      });
    }
    if (rpc.method === "chat.message.send") {
      const params = z
        .object({
          conversationId: z.string().trim().min(1).max(256),
          content: z.string().max(2_000_000),
        })
        .strict()
        .parse(rpc.params);
      return legacyRpcSuccess(
        rpc.id,
        context.store.addUserMessage({
          conversationId: params.conversationId,
          content: params.content,
        }),
      );
    }
    return reply
      .code(403)
      .send(
        deniedLegacyCapability(
          rpc,
          `Legacy RPC method '${rpc.method}' is not exposed by the capability broker.`,
        ),
      );
  });
}
