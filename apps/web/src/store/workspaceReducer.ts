import type { ApiBootstrap } from "../api/workspaceApi";
import { createDemoWorkspace } from "../data/demoWorkspace";
import type {
  AgentProposal,
  AgentRun,
  ConversationSpace,
  GenerationMode,
  LegacyPlugin,
  MessageSwipe,
  ModalState,
  PanelId,
  PersistedWorkspaceState,
  Persona,
  PromptPreset,
  ProviderConnection,
  RegexScope,
  WorkspaceMessage,
  WorkspaceState,
  Worldbook,
  WorldbookEntry,
} from "../domain/workspace";

const STORAGE_KEY = "sillytavern-n.workspace.v4";
const LEGACY_STORAGE_KEY = "sillytavern-n.workspace.v3";
const MAX_DRAFT_BYTES = 32 * 1024;
const MAX_PERSISTED_DRAFTS = 50;

type WorkspaceAction =
  | { type: "bootstrap/loading" }
  | { type: "bootstrap/api"; payload: ApiBootstrap }
  | { type: "bootstrap/error"; error: string }
  | { type: "bootstrap/demo" }
  | { type: "card/select"; id: string }
  | { type: "conversation/create"; conversation: ConversationSpace }
  | { type: "conversation/delete"; id: string }
  | { type: "conversation/select"; id: string }
  | { type: "conversation/persona"; conversation: ConversationSpace }
  | { type: "persona/replace"; persona: Persona }
  | { type: "personas/replace"; personas: Persona[] }
  | { type: "persona/remove"; id: string }
  | { type: "draft/change"; conversationId: string; value: string }
  | { type: "message/append"; message: WorkspaceMessage }
  | {
      type: "messages/replace";
      conversationId: string;
      messages: WorkspaceMessage[];
      nextCursor?: string | null;
    }
  | {
      type: "messages/prepend";
      conversationId: string;
      messages: WorkspaceMessage[];
      nextCursor: string | null;
    }
  | {
      type: "messages/history-loading";
      conversationId: string;
      loading: boolean;
    }
  | { type: "message/replace"; message: WorkspaceMessage }
  | { type: "message/update"; messageId: string; content: string }
  | { type: "message/delete"; messageId: string }
  | { type: "message/swipe-add"; messageId: string; swipe: MessageSwipe }
  | { type: "message/swipe-select"; messageId: string; index: number }
  | { type: "panel/toggle"; panel: PanelId }
  | { type: "nav/set"; open: boolean }
  | { type: "modal/set"; modal: ModalState }
  | { type: "preset/select"; id: string }
  | { type: "preset/replace"; preset: PromptPreset }
  | { type: "regexScope/replace"; scope: RegexScope }
  | { type: "provider/select"; id: string }
  | { type: "provider/upsert"; provider: ProviderConnection }
  | {
      type: "worldbook/entry-permission";
      worldbookId: string;
      worldbookRevision: number;
      entry: WorldbookEntry;
    }
  | { type: "worldbooks/replace"; worldbooks: Worldbook[] }
  | {
      type: "generation/start";
      conversationId: string;
      mode: GenerationMode;
      targetMessageId: string | null;
    }
  | { type: "generation/id"; id: string }
  | { type: "generation/delta"; delta: string }
  | { type: "generation/stopping" }
  | { type: "generation/reset" }
  | { type: "plugin/update"; plugin: LegacyPlugin }
  | {
      type: "agent/proposed";
      proposal: AgentProposal;
      run: AgentRun;
    }
  | { type: "agent/rejected" }
  | { type: "agent/run"; run: AgentRun | null }
  | {
      type: "agent/applied";
      payload: {
        auditId: string | null;
        revision: number | null;
        worldbooks?: Worldbook[];
        run?: AgentRun;
      };
    }
  | {
      type: "agent/undone";
      payload?: { worldbooks?: Worldbook[]; run?: AgentRun };
    }
  | {
      type: "toast/show";
      message: string;
      tone?: "success" | "info" | "warning";
    }
  | { type: "toast/clear"; id: number };

const idleGeneration = (): WorkspaceState["generation"] => ({
  status: "idle",
  mode: null,
  conversationId: null,
  generationId: null,
  targetMessageId: null,
  preview: "",
});

const withProposalPermissionState = (
  proposal: AgentProposal | null,
  worldbooks: Worldbook[],
): AgentProposal | null => {
  if (
    !proposal ||
    !["blocked", "awaiting_confirmation"].includes(proposal.status)
  ) {
    return proposal;
  }
  const target = worldbooks.find(
    (worldbook) => worldbook.id === proposal.worldbookId,
  );
  if (proposal.toolName === "worldbook.entry.create") {
    return {
      ...proposal,
      status: "awaiting_confirmation",
      beforeRevision: target?.revision ?? proposal.beforeRevision,
    };
  }
  const targetEntry = target?.entries.find(
    (entry) => entry.id === proposal.targetEntryId,
  );
  return {
    ...proposal,
    status: targetEntry?.agentEditable ? "awaiting_confirmation" : "blocked",
    beforeRevision: target?.revision ?? proposal.beforeRevision,
    ...(targetEntry
      ? { beforeEntryRevision: targetEntry.revision }
      : proposal.beforeEntryRevision === undefined
        ? {}
        : { beforeEntryRevision: proposal.beforeEntryRevision }),
  };
};

const mapMessages = (
  state: WorkspaceState,
  transform: (message: WorkspaceMessage) => WorkspaceMessage | null,
): WorkspaceState["messagesByConversation"] =>
  Object.fromEntries(
    Object.entries(state.messagesByConversation).map(
      ([conversationId, messages]) => [
        conversationId,
        messages.flatMap((message) => {
          const transformed = transform(message);
          return transformed ? [transformed] : [];
        }),
      ],
    ),
  );

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "bootstrap/api": {
      const {
        conversations,
        cards,
        personas = [],
        participants,
        worldbooks,
        presets,
        messagesByConversation,
      } = action.payload;
      const selectedCardId = cards.some(
        (card) => card.id === state.selectedCardId,
      )
        ? state.selectedCardId
        : "";
      const persistedConversationId = conversations.some(
        (conversation) =>
          conversation.id === state.selectedConversationId &&
          conversation.cardId === selectedCardId,
      )
        ? state.selectedConversationId
        : "";
      const selectedConversationId =
        persistedConversationId ||
        conversations.find(
          (conversation) => conversation.cardId === selectedCardId,
        )?.id ||
        "";
      const selectedPresetId = presets.some(
        (preset) => preset.id === state.selectedPresetId,
      )
        ? state.selectedPresetId
        : (presets[0]?.id ?? "");
      const selectedProviderId =
        state.selectedProviderId === "fake" ||
        action.payload.providerConnections.some(
          (provider) => provider.id === state.selectedProviderId,
        )
          ? state.selectedProviderId
          : "fake";
      return {
        ...state,
        availability: "api",
        bootstrapError: null,
        conversations,
        cards,
        personas,
        participants,
        messagesByConversation,
        conversationNextCursor: action.payload.conversationNextCursor ?? null,
        messageNextCursorByConversation:
          action.payload.messageNextCursorByConversation ?? {},
        messageHistoryLoading: {},
        worldbooks,
        presets,
        regexScopes: action.payload.regexScopes,
        providerConnections: action.payload.providerConnections,
        selectedProviderId,
        selectedPresetId,
        selectedCardId,
        selectedConversationId,
        // Server currently has no pending-proposal list route. Never surface the
        // clean-room demo proposal as if it were a live Agent run.
        agentProposal: null,
        agentRun: null,
        generation: idleGeneration(),
      };
    }
    case "bootstrap/loading":
      return { ...state, availability: "loading", bootstrapError: null };
    case "bootstrap/error":
      return { ...state, availability: "error", bootstrapError: action.error };
    case "bootstrap/demo": {
      const demo = createDemoWorkspace();
      return { ...demo, availability: "demo", bootstrapError: null };
    }
    case "card/select": {
      const selectedConversationId =
        state.conversations.find(
          (conversation) => conversation.cardId === action.id,
        )?.id ?? "";
      return {
        ...state,
        selectedCardId: action.id,
        selectedConversationId,
        navOpen: false,
        modal: { kind: "closed" },
        agentProposal: null,
        agentRun: null,
      };
    }
    case "conversation/create": {
      const card = state.cards.find(
        (candidate) => candidate.id === action.conversation.cardId,
      );
      if (!card) return state;
      const conversation = {
        ...action.conversation,
        worldbookIds: [
          ...new Set([
            ...card.worldbookIds,
            ...action.conversation.worldbookIds,
          ]),
        ],
      };
      return {
        ...state,
        conversations: [conversation, ...state.conversations],
        cards: state.cards.map((card) =>
          card.id === conversation.cardId
            ? { ...card, conversationCount: card.conversationCount + 1 }
            : card,
        ),
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversation.id]: [],
        },
        selectedCardId: conversation.cardId,
        selectedConversationId: conversation.id,
        draftByConversation: {
          ...state.draftByConversation,
          [conversation.id]: "",
        },
        modal: { kind: "closed" },
        navOpen: false,
        agentProposal: null,
        agentRun: null,
      };
    }
    case "conversation/delete": {
      const deleted = state.conversations.find(
        (conversation) => conversation.id === action.id,
      );
      if (!deleted) return state;
      const conversations = state.conversations.filter(
        (conversation) => conversation.id !== action.id,
      );
      const remainingCardConversations = conversations.filter(
        (conversation) => conversation.cardId === deleted.cardId,
      );
      const selectedConversationId =
        state.selectedConversationId === action.id
          ? (remainingCardConversations[0]?.id ?? "")
          : state.selectedConversationId;
      const messagesByConversation = Object.fromEntries(
        Object.entries(state.messagesByConversation).filter(
          ([conversationId]) => conversationId !== action.id,
        ),
      );
      const draftByConversation = Object.fromEntries(
        Object.entries(state.draftByConversation).filter(
          ([conversationId]) => conversationId !== action.id,
        ),
      );
      const agentConversationDeleted =
        state.agentRun?.conversationId === action.id;
      return {
        ...state,
        conversations,
        cards: state.cards.map((card) =>
          card.id === deleted.cardId
            ? {
                ...card,
                conversationCount: Math.max(0, card.conversationCount - 1),
              }
            : card,
        ),
        messagesByConversation,
        draftByConversation,
        selectedConversationId,
        generation:
          state.generation.conversationId === action.id
            ? idleGeneration()
            : state.generation,
        agentProposal: agentConversationDeleted ? null : state.agentProposal,
        agentRun: agentConversationDeleted ? null : state.agentRun,
      };
    }
    case "conversation/select": {
      const selected = state.conversations.find(
        (conversation) => conversation.id === action.id,
      );
      if (!selected || selected.cardId !== state.selectedCardId) return state;
      return {
        ...state,
        selectedConversationId: action.id,
        navOpen: false,
        modal: { kind: "closed" },
        agentProposal: null,
        agentRun: null,
      };
    }
    case "conversation/persona":
      return {
        ...state,
        conversations: state.conversations.map((conversation) =>
          conversation.id === action.conversation.id
            ? action.conversation
            : conversation,
        ),
      };
    case "persona/replace": {
      const exists = state.personas.some(
        (persona) => persona.id === action.persona.id,
      );
      const nextPersonas = exists
        ? state.personas.map((persona) =>
            persona.id === action.persona.id ? action.persona : persona,
          )
        : [action.persona, ...state.personas];
      return {
        ...state,
        personas: action.persona.isDefault
          ? nextPersonas.map((persona) => ({
              ...persona,
              isDefault: persona.id === action.persona.id,
            }))
          : nextPersonas,
      };
    }
    case "personas/replace":
      return { ...state, personas: action.personas };
    case "persona/remove":
      return {
        ...state,
        personas: state.personas.filter((persona) => persona.id !== action.id),
      };
    case "draft/change":
      return {
        ...state,
        draftByConversation: {
          ...state.draftByConversation,
          [action.conversationId]: action.value,
        },
      };
    case "message/append":
      return {
        ...state,
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.message.conversationId]: [
            ...(state.messagesByConversation[action.message.conversationId] ??
              []),
            action.message,
          ],
        },
        draftByConversation: {
          ...state.draftByConversation,
          [action.message.conversationId]: "",
        },
      };
    case "messages/replace":
      return {
        ...state,
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.conversationId]: action.messages,
        },
        messageNextCursorByConversation:
          action.nextCursor === undefined
            ? state.messageNextCursorByConversation
            : {
                ...state.messageNextCursorByConversation,
                [action.conversationId]: action.nextCursor,
              },
      };
    case "messages/history-loading":
      return {
        ...state,
        messageHistoryLoading: {
          ...state.messageHistoryLoading,
          [action.conversationId]: action.loading,
        },
      };
    case "messages/prepend": {
      const current = state.messagesByConversation[action.conversationId] ?? [];
      const merged = new Map(
        [...action.messages, ...current].map((message) => [
          message.id,
          message,
        ]),
      );
      return {
        ...state,
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.conversationId]: [...merged.values()],
        },
        messageNextCursorByConversation: {
          ...state.messageNextCursorByConversation,
          [action.conversationId]: action.nextCursor,
        },
        messageHistoryLoading: {
          ...state.messageHistoryLoading,
          [action.conversationId]: false,
        },
      };
    }
    case "message/replace":
      return {
        ...state,
        messagesByConversation: mapMessages(state, (message) =>
          message.id === action.message.id ? action.message : message,
        ),
      };
    case "message/update":
      return {
        ...state,
        messagesByConversation: mapMessages(state, (message) => {
          if (message.id !== action.messageId) return message;
          const activeIndex = message.activeSwipeIndex ?? 0;
          const swipes = message.swipes?.length
            ? message.swipes.map((swipe, index) =>
                index === activeIndex
                  ? { ...swipe, content: action.content }
                  : swipe,
              )
            : message.swipes;
          return {
            ...message,
            content: action.content,
            revision: message.revision + 1,
            ...(swipes ? { swipes } : {}),
          };
        }),
      };
    case "message/delete":
      return {
        ...state,
        messagesByConversation: mapMessages(state, (message) =>
          message.id === action.messageId ? null : message,
        ),
      };
    case "message/swipe-add":
      return {
        ...state,
        messagesByConversation: mapMessages(state, (message) => {
          if (message.id !== action.messageId) return message;
          const swipes = message.swipes?.length
            ? [...message.swipes, action.swipe]
            : [
                { id: `${message.id}-swipe-1`, content: message.content },
                action.swipe,
              ];
          return {
            ...message,
            content: action.swipe.content,
            swipes,
            activeSwipeIndex: swipes.length - 1,
            revision: message.revision + 1,
          };
        }),
      };
    case "message/swipe-select":
      return {
        ...state,
        messagesByConversation: mapMessages(state, (message) => {
          const swipe = message.swipes?.[action.index];
          if (message.id !== action.messageId || !swipe) return message;
          return {
            ...message,
            content: swipe.content,
            activeSwipeIndex: action.index,
          };
        }),
      };
    case "panel/toggle":
      return {
        ...state,
        expandedPanels: {
          ...state.expandedPanels,
          [action.panel]: !state.expandedPanels[action.panel],
        },
      };
    case "nav/set":
      return { ...state, navOpen: action.open };
    case "modal/set":
      return { ...state, modal: action.modal };
    case "preset/select":
      return { ...state, selectedPresetId: action.id };
    case "preset/replace":
      return {
        ...state,
        presets: state.presets.map((preset) =>
          preset.id === action.preset.id ? action.preset : preset,
        ),
      };
    case "regexScope/replace":
      return {
        ...state,
        regexScopes: state.regexScopes.some(
          (scope) =>
            scope.scope === action.scope.scope && scope.id === action.scope.id,
        )
          ? state.regexScopes.map((scope) =>
              scope.scope === action.scope.scope && scope.id === action.scope.id
                ? action.scope
                : scope,
            )
          : [...state.regexScopes, action.scope],
      };
    case "provider/select":
      return { ...state, selectedProviderId: action.id };
    case "provider/upsert":
      return {
        ...state,
        providerConnections: state.providerConnections.some(
          (provider) => provider.id === action.provider.id,
        )
          ? state.providerConnections.map((provider) =>
              provider.id === action.provider.id ? action.provider : provider,
            )
          : [...state.providerConnections, action.provider],
        selectedProviderId: action.provider.id,
      };
    case "worldbook/entry-permission": {
      const worldbooks = state.worldbooks.map((worldbook) =>
        worldbook.id === action.worldbookId
          ? {
              ...worldbook,
              revision: action.worldbookRevision,
              entries: worldbook.entries.map((entry) =>
                entry.id === action.entry.id ? action.entry : entry,
              ),
            }
          : worldbook,
      );
      return {
        ...state,
        worldbooks,
        agentProposal: withProposalPermissionState(
          state.agentProposal,
          worldbooks,
        ),
      };
    }
    case "worldbooks/replace":
      return {
        ...state,
        worldbooks: action.worldbooks,
        agentProposal: withProposalPermissionState(
          state.agentProposal,
          action.worldbooks,
        ),
      };
    case "generation/start":
      return {
        ...state,
        generation: {
          status: "streaming",
          mode: action.mode,
          conversationId: action.conversationId,
          generationId: null,
          targetMessageId: action.targetMessageId,
          preview: "",
        },
      };
    case "generation/id":
      return state.generation.status === "idle"
        ? state
        : {
            ...state,
            generation: { ...state.generation, generationId: action.id },
          };
    case "generation/delta":
      return state.generation.status === "idle"
        ? state
        : {
            ...state,
            generation: {
              ...state.generation,
              preview: state.generation.preview + action.delta,
            },
          };
    case "generation/stopping":
      return state.generation.status === "idle"
        ? state
        : {
            ...state,
            generation: { ...state.generation, status: "stopping" },
          };
    case "generation/reset":
      return { ...state, generation: idleGeneration() };
    case "plugin/update":
      return {
        ...state,
        plugins: state.plugins.map((plugin) =>
          plugin.id === action.plugin.id ? action.plugin : plugin,
        ),
      };
    case "agent/proposed":
      return {
        ...state,
        agentProposal: action.proposal,
        agentRun: action.run,
        modal: { kind: "agent_proposal" },
      };
    case "agent/rejected":
      return {
        ...state,
        agentProposal: null,
        agentRun: null,
        modal: { kind: "closed" },
      };
    case "agent/run":
      return { ...state, agentRun: action.run };
    case "agent/applied": {
      if (!state.agentProposal) return state;
      const target = state.worldbooks.find(
        (worldbook) => worldbook.id === state.agentProposal?.worldbookId,
      );
      const resolvedRevision =
        action.payload.revision ?? (target ? target.revision + 1 : null);
      return {
        ...state,
        agentProposal: {
          ...state.agentProposal,
          status: "applied",
          auditId: action.payload.auditId ?? `audit-demo-${Date.now()}`,
          afterRevision: resolvedRevision,
          ...(action.payload.run ? { runId: action.payload.run.id } : {}),
        },
        agentRun: action.payload.run ?? state.agentRun,
        worldbooks:
          action.payload.worldbooks ??
          state.worldbooks.map((worldbook) =>
            worldbook.id === state.agentProposal?.worldbookId
              ? {
                  ...worldbook,
                  revision: resolvedRevision ?? worldbook.revision,
                  hitCount: worldbook.hitCount + 1,
                }
              : worldbook,
          ),
      };
    }
    case "agent/undone":
      if (!state.agentProposal) return state;
      return {
        ...state,
        agentProposal: { ...state.agentProposal, status: "undone" },
        agentRun: action.payload?.run ?? state.agentRun,
        worldbooks:
          action.payload?.worldbooks ??
          state.worldbooks.map((worldbook) =>
            worldbook.id === state.agentProposal?.worldbookId
              ? {
                  ...worldbook,
                  revision: worldbook.revision + 1,
                  hitCount: Math.max(0, worldbook.hitCount - 1),
                }
              : worldbook,
          ),
      };
    case "toast/show":
      return {
        ...state,
        toast: {
          id: Date.now(),
          tone: action.tone ?? "info",
          message: action.message,
        },
      };
    case "toast/clear":
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
    default:
      return state;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asPersistedString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const truncateDraft = (value: string): string => {
  if (new TextEncoder().encode(value).byteLength <= MAX_DRAFT_BYTES) {
    return value;
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      new TextEncoder().encode(value.slice(0, middle)).byteLength <=
      MAX_DRAFT_BYTES
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
};

const compactDrafts = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).filter(
    ([, draft]) => typeof draft === "string",
  );
  return Object.fromEntries(
    entries
      .slice(-MAX_PERSISTED_DRAFTS)
      .map(([conversationId, draft]) => [
        conversationId,
        truncateDraft(draft as string),
      ]),
  );
};

export function loadWorkspaceState(): WorkspaceState {
  const base: WorkspaceState = {
    ...createDemoWorkspace(),
    availability: "loading",
    bootstrapError: null,
  };
  if (typeof window === "undefined") return base;

  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return {
        ...base,
        selectedCardId: "",
        selectedConversationId: "",
        agentProposal: null,
      };
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      ![3, 4].includes(parsed.version as number) ||
      !isRecord(parsed.data)
    ) {
      return {
        ...base,
        selectedCardId: "",
        selectedConversationId: "",
        agentProposal: null,
      };
    }
    const persisted = parsed.data as Partial<PersistedWorkspaceState>;

    return {
      ...base,
      // v3 is intentionally a light migration only. Entity caches such as
      // messages, cards, worldbooks, and plugins are discarded.
      selectedCardId: asPersistedString(persisted.selectedCardId, ""),
      selectedConversationId: asPersistedString(
        persisted.selectedConversationId,
        "",
      ),
      selectedPresetId: asPersistedString(
        persisted.selectedPresetId,
        base.selectedPresetId,
      ),
      selectedProviderId: asPersistedString(
        persisted.selectedProviderId,
        base.selectedProviderId,
      ),
      draftByConversation: compactDrafts(persisted.draftByConversation),
    };
  } catch {
    return {
      ...base,
      selectedCardId: "",
      selectedConversationId: "",
      agentProposal: null,
    };
  }
}

export function persistWorkspaceState(state: WorkspaceState): boolean {
  if (typeof window === "undefined") return true;
  const persisted: PersistedWorkspaceState = {
    selectedCardId: state.selectedCardId,
    selectedConversationId: state.selectedConversationId,
    selectedPresetId: state.selectedPresetId,
    selectedProviderId: state.selectedProviderId,
    draftByConversation: compactDrafts(state.draftByConversation),
  };

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 4, data: persisted }),
    );
    return true;
  } catch {
    return false;
  }
}

export type { WorkspaceAction };
