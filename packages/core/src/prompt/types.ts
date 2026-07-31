import type {
  Card,
  Conversation,
  JsonObject,
  Message,
  Participant,
  PromptPreset,
  PromptSegment,
  Worldbook,
  WorldbookEntry,
} from "@stn/contracts";

import type { RegexScript } from "../regex/types.js";

export interface PromptMacroContext {
  readonly userName?: string;
  readonly characterName?: string;
  readonly participantNames?: readonly string[];
  readonly narratorName?: string;
  readonly cardName?: string;
  readonly description?: string;
  readonly personality?: string;
  readonly scenario?: string;
  readonly worldDescription?: string;
  readonly persona?: string;
  readonly lastUserMessage?: string;
  readonly custom?: Readonly<Record<string, string>>;
}

export interface PromptMacroRuntime {
  readonly variables: Map<string, string>;
  readonly random: () => number;
  readonly roll?: (formula: string) => string | number | undefined;
}

export interface MacroExpansionOptions {
  readonly unknown?: "preserve" | "empty";
  readonly maxPasses?: number;
  readonly runtime?: PromptMacroRuntime;
}

export interface MatchedWorldbookEntry {
  readonly worldbookId: string;
  readonly worldbookName: string;
  readonly entry: WorldbookEntry;
  readonly depth: number;
  readonly reason: "constant" | "keyword";
  readonly matchedKeys: readonly string[];
}

export interface WorldbookMatchOptions {
  readonly maxRecursion?: number;
}

export interface PromptTokenBudget {
  readonly maxContextTokens: number;
  readonly reservedOutputTokens?: number;
}

export type TokenEstimator = (content: string) => number;

export interface PromptBudgetResult {
  readonly segments: readonly PromptSegment[];
  readonly dropped: readonly PromptSegment[];
  readonly totalTokenEstimate: number;
  readonly availableTokens: number;
  readonly overBudget: boolean;
}

export interface PromptAssemblyInput {
  readonly conversation?: Conversation;
  readonly card?: Card;
  readonly participants?: readonly Participant[];
  readonly messages?: readonly Message[];
  readonly worldbooks?: readonly Worldbook[];
  readonly preset?: PromptPreset;
  readonly persona?: string;
  readonly personaId?: string;
  readonly userName?: string;
  readonly currentInput?: string;
  readonly systemInstruction?: string;
  readonly macros?: Readonly<Record<string, string>>;
  readonly macroRuntime?: PromptMacroRuntime;
  readonly regexScripts?: readonly RegexScript[];
  readonly extensionSegments?: readonly PromptSegment[];
  readonly tokenBudget?: PromptTokenBudget;
  readonly estimateTokens?: TokenEstimator;
}

export interface PromptAssemblyTrace {
  readonly assembled: readonly PromptSegment[];
  readonly included: readonly PromptSegment[];
  readonly dropped: readonly PromptSegment[];
  readonly matchedWorldbookEntries: readonly MatchedWorldbookEntry[];
  readonly totalTokenEstimate: number;
  readonly availableTokens?: number;
  readonly overBudget: boolean;
}

export interface PromptAssemblyResult {
  readonly segments: readonly PromptSegment[];
  readonly trace: PromptAssemblyTrace;
}

export interface ChatPromptMessage {
  readonly role: PromptSegment["role"];
  readonly content: string;
  readonly name?: string;
  readonly sourceSegmentIds: readonly string[];
  readonly metadata: JsonObject;
}

export interface ChatRenderOptions {
  readonly mergeAdjacent?: boolean;
}

export interface TextRenderOptions {
  readonly separator?: string;
  readonly systemPrefix?: string;
  readonly userPrefix?: string;
  readonly assistantPrefix?: string;
  readonly toolPrefix?: string;
  readonly includeRolePrefixes?: boolean;
  readonly assistantCue?: string;
}
