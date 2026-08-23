import _ from "lodash";
import type * as z from "zod";

import type { WorkspaceMessage } from "../domain/workspace";

type JsonRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function resolveTavernHelperMessageVariables(
  update: Record<string, unknown>,
  activeSwipeIndex: number,
): JsonRecord | undefined {
  if (update.data !== undefined) return asRecord(clone(update.data));
  if (!Array.isArray(update.swipes_data)) return undefined;
  const resolvedIndex = Math.min(
    Math.max(0, activeSwipeIndex),
    Math.max(0, update.swipes_data.length - 1),
  );
  return asRecord(clone(update.swipes_data[resolvedIndex]));
}

export function validateTavernHelperVariables(
  schema: z.ZodType,
  variables: JsonRecord,
): JsonRecord {
  const result = schema.safeParse(variables);
  if (!result.success) {
    throw new Error(
      `Variable schema validation failed: ${result.error.message}`,
    );
  }
  return {
    ...clone(variables),
    ...clone(asRecord(result.data)),
  };
}

export function shouldReparseAssistantVariables(
  content: string,
  variables: JsonRecord,
  baseline: JsonRecord | undefined,
): boolean {
  return (
    baseline !== undefined &&
    _.has(baseline, "stat_data") &&
    (!_.has(variables, "schema") || _.isEmpty(variables.stat_data)) &&
    (_.isEmpty(variables.stat_data) ||
      _.isEqual(variables.stat_data, baseline.stat_data)) &&
    /<(?:update(?:variable)?|variableupdate)>/iu.test(content)
  );
}

export function shouldReconcileOpeningMessageVariables(
  variables: Record<string, unknown>,
): boolean {
  return (
    _.has(variables, "initialized_lorebooks") &&
    _.has(variables, "stat_data") &&
    _.isPlainObject(variables.stat_data) &&
    _.isEmpty(variables.stat_data)
  );
}

export function shouldEnsureAssistantStatusPlaceholder(
  messageIndex: number,
  message: Pick<WorkspaceMessage, "role" | "content">,
  variables: Record<string, unknown>,
): boolean {
  return (
    messageIndex > 0 &&
    message.role === "assistant" &&
    _.has(variables, "stat_data") &&
    _.isPlainObject(variables.stat_data) &&
    !message.content.includes("<StatusPlaceHolderImpl/>")
  );
}

export function appendAssistantStatusPlaceholder(content: string): string {
  if (content.includes("<StatusPlaceHolderImpl/>")) return content;
  return `${content.trimEnd()}\n\n<StatusPlaceHolderImpl/>`;
}

export function resolveTavernHelperFrameMessageId(
  frameName: string,
  fallback: number,
): number {
  const match = /^TH-message--(\d+)--\d+(?:_\d+)?$/u.exec(frameName);
  return match?.[1] === undefined ? fallback : Number(match[1]);
}

export function tavernHelperConfirmResult(confirmed: boolean): 0 | 1 {
  return confirmed ? 1 : 0;
}

export function createTavernHelperMessageView(
  message: WorkspaceMessage,
  messageId: number,
  variables: JsonRecord,
  assistantName: string,
) {
  const swipes = message.swipes?.map((swipe) => swipe.content) ?? [
    message.content,
  ];
  const activeSwipeIndex = Math.min(
    message.activeSwipeIndex ?? 0,
    Math.max(0, swipes.length - 1),
  );
  const activeVariables = clone(variables);
  return {
    message_id: messageId,
    name: message.role === "user" ? "User" : assistantName,
    role: message.role,
    is_user: message.role === "user",
    is_system: false,
    is_hidden: false,
    message: message.content,
    data: activeVariables,
    extra: { stn_message_id: message.id },
    swipe_id: activeSwipeIndex,
    swipes,
    swipes_data: swipes.map((_, index) =>
      index === activeSwipeIndex ? clone(activeVariables) : {},
    ),
    swipes_info: swipes.map(() => ({})),
  };
}
