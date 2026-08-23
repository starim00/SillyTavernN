import type {
  PreparedPromptMessage,
  PromptTemplateDirective,
} from "../api/workspaceApi";
import type * as PromptTemplateEngine from "./promptTemplateEngine";
import type * as TavernHelperRuntime from "./tavernHelperRuntime";
import type { TavernHelperContext } from "./tavernHelperTypes";

type PromptTemplateModule = typeof PromptTemplateEngine;
type TavernHelperRuntimeModule = typeof TavernHelperRuntime;

let promptTemplateModulePromise: Promise<PromptTemplateModule> | undefined;
let tavernHelperRuntimeModulePromise:
  Promise<TavernHelperRuntimeModule> | undefined;

export function loadPromptTemplateEngine(): Promise<PromptTemplateModule> {
  promptTemplateModulePromise ??= import("./promptTemplateEngine");
  return promptTemplateModulePromise;
}

export function loadTavernHelperRuntime(): Promise<TavernHelperRuntimeModule> {
  tavernHelperRuntimeModulePromise ??= import("./tavernHelperRuntime");
  return tavernHelperRuntimeModulePromise;
}

export async function renderPromptTemplateMessages(
  messages: readonly PreparedPromptMessage[],
  input: {
    enabled: boolean;
    context: TavernHelperContext | null;
    directives?: readonly PromptTemplateDirective[];
  },
) {
  const module = await loadPromptTemplateEngine();
  return module.renderPromptTemplateMessages(messages, input);
}

export async function renderPromptTemplateDisplayMessages(
  messages: readonly PreparedPromptMessage[],
  input: {
    enabled: boolean;
    context: TavernHelperContext | null;
    formatDisplayContent: (content: string) => string;
    formatDisplayInline: (content: string) => string;
  },
) {
  const module = await loadPromptTemplateEngine();
  return module.renderPromptTemplateDisplayMessages(messages, input);
}
