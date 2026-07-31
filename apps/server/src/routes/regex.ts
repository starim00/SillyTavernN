import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { envelope, type ServerContext } from "../context.js";
import { listRegexScopes, updateRegexScope } from "../regex-service.js";

const placementSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(6),
]);

const regexScriptSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    scriptName: z.string().trim().min(1).max(1024),
    findRegex: z.string().max(2_000_000),
    replaceString: z.string().max(4_000_000),
    trimStrings: z.array(z.string().max(100_000)).max(1_000),
    placement: z.array(placementSchema).max(5),
    disabled: z.boolean(),
    markdownOnly: z.boolean(),
    promptOnly: z.boolean(),
    runOnEdit: z.boolean(),
    substituteRegex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    minDepth: z.number().int().nonnegative().max(100_000).nullable(),
    maxDepth: z.number().int().nonnegative().max(100_000).nullable(),
  })
  .strict()
  .superRefine((script, context) => {
    if (new Set(script.placement).size !== script.placement.length) {
      context.addIssue({
        code: "custom",
        message: "Regex placements must not contain duplicates.",
        path: ["placement"],
      });
    }
  });

const regexScopePatchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean().optional(),
    scripts: z.array(regexScriptSchema).max(10_000).optional(),
  })
  .strict()
  .refine(
    (value) => value.enabled !== undefined || value.scripts !== undefined,
    { message: "At least one of enabled or scripts must be provided." },
  );

const regexScopeParamsSchema = z
  .object({
    scope: z.enum(["global", "card", "preset"]),
    id: z.string().trim().min(1).max(512),
  })
  .strict();

export async function registerRegexRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/regex/scopes", () => envelope(listRegexScopes(context.store)));

  app.patch<{ Params: { scope: string; id: string } }>(
    "/api/regex/scopes/:scope/:id",
    (request) => {
      const params = regexScopeParamsSchema.parse(request.params);
      const input = regexScopePatchSchema.parse(request.body);
      return envelope(
        updateRegexScope(context.store, {
          scope: params.scope,
          id: params.id,
          expectedRevision: input.expectedRevision,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.scripts === undefined
            ? {}
            : {
                scripts: input.scripts,
              }),
        }),
      );
    },
  );
}
