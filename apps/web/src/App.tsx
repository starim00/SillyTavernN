import {
  BracketsCurly,
  BookOpenText,
  Books,
  ChatCircleDots,
  CloudCheck,
  CloudSlash,
  PlugsConnected,
  PuzzlePiece,
  SlidersHorizontal,
  UploadSimple,
  UserCircle,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useReducer,
  useRef,
  useState,
  Suspense,
} from "react";

import {
  abortGeneration,
  callLegacyRpc,
  cancelAgentRun,
  confirmAgentProposal,
  createConversationSpace as createConversationSpaceOnServer,
  createPersona,
  createMessage,
  createTavernHelperMessage,
  deleteConversationSpace,
  deletePromptPreset,
  deleteRoleCard,
  deletePersona,
  deleteWorkspaceMessage,
  generateConversation,
  generateWithTavernHelper,
  GenerationInterruptedError,
  importPortableFile,
  installLegacyPlugin,
  loadConversationMessagePage,
  loadLegacyGrants,
  loadLegacyHostHealth,
  loadPendingAgentToolProposal,
  loadProviderModels,
  loadTavernHelperContext,
  loadWorkspaceFromApi,
  preparePromptTemplate,
  proposalFromGenerationToolEvent,
  reorderPresetPrompts as reorderPresetPromptsOnServer,
  saveProviderConnection,
  saveTavernHelperScripts,
  saveTavernHelperSettings,
  saveRegexScope as saveRegexScopeOnServer,
  selectMessageSwipe,
  setConversationPersona,
  setLegacyPluginEnabled,
  undoAgentProposal,
  updateLegacyGrant,
  updatePresetPrompt,
  updatePresetGeneration,
  updateRegexGrant,
  updateTavernHelperGrant,
  updateWorldbookEntry,
  updateWorkspaceMessage,
  updateWorldbookEntryPermission,
  updatePersona,
  saveTavernHelperState,
  type LegacyHostPluginStatus,
  WorkspaceApiError,
  type PersonaInput,
} from "./api/workspaceApi";
import {
  loadTavernHelperRuntime,
  renderPromptTemplateMessages,
} from "./compat/loaders";
import type {
  TavernHelperRuntime,
  TavernHelperRuntimeAdapter,
} from "./compat/tavernHelperRuntime";
import { canonicalLegacyPluginId } from "./compat/legacyPluginIds";
import type {
  TavernHelperContext,
  TavernHelperRuntimeButton,
  TavernHelperRuntimeStatus,
  TavernHelperSource,
} from "./compat/tavernHelperTypes";
import { CardConversationEntry } from "./components/CardConversationEntry";
import { ConversationComposer } from "./components/ConversationComposer";
import type { LegacyRealmStatus } from "./components/LegacyRealmBridge";
import {
  clearMessageFrameStorage,
  MessageStream,
} from "./components/MessageStream";
import { NavigationRail } from "./components/NavigationRail";
import { PresetSettingsRail } from "./components/PresetSettingsRail";
import type { PresetGenerationPatch } from "./components/PresetGenerationControls";
import type { TavernHelperTool } from "./components/TavernHelperWorkbench";
import { WorkspaceConnectionBanner } from "./components/WorkspaceConnectionBanner";
import { SurfaceStatus } from "./components/WorkspacePrimitives";
import { WorkspaceModals } from "./components/WorkspaceModals";
import type {
  ConversationSpace,
  GenerationMode,
  LegacyPlugin,
  PromptPreset,
  PromptPresetEntry,
  ProviderConnection,
  ProviderConnectionInput,
  Persona,
  RegexScope,
  RegexScriptDefinition,
  RoleCard,
  WorkspaceMessage,
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "./domain/workspace";
import {
  loadWorkspaceState,
  persistWorkspaceState,
  workspaceReducer,
} from "./store/workspaceReducer";

const LazyTavernHelperWorkbench = lazy(() =>
  import("./components/TavernHelperWorkbench").then((module) => ({
    default: module.TavernHelperWorkbench,
  })),
);
const LazyLegacyRealmBridge = lazy(() =>
  import("./components/LegacyRealmBridge").then((module) => ({
    default: module.LegacyRealmBridge,
  })),
);

const identifier = (prefix: string): string => {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
};

const legacyPluginCapabilities = [
  "settings.read",
  "settings.write",
  "character.read",
  "preset.read",
] as const;

async function updateLegacyPluginGrants(
  pluginId: string,
  granted: boolean,
): Promise<void> {
  const updated: string[] = [];
  try {
    for (const capability of legacyPluginCapabilities) {
      await updateLegacyGrant({ pluginId, capability, granted });
      updated.push(capability);
    }
  } catch (error) {
    await Promise.all(
      updated.map((capability) =>
        updateLegacyGrant({
          pluginId,
          capability,
          granted: !granted,
        }).catch(() => undefined),
      ),
    );
    throw error;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    loadWorkspaceState,
  );
  const apiOnline = state.availability === "api";
  const loading = state.availability === "loading";
  const generationControllerRef = useRef<AbortController | null>(null);
  const swipeSelectionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceStateRef = useRef(state);
  workspaceStateRef.current = state;
  const bootstrapRequestRef = useRef(0);
  const persistTimerRef = useRef<number | null>(null);
  const persistWarningShownRef = useRef(false);
  const proposalRefreshKey = (
    state.messagesByConversation[state.selectedConversationId] ?? []
  )
    .map((message) => `${message.id}:${String(message.revision)}`)
    .join("|");
  const [legacyAvailability, setLegacyAvailability] = useState<
    Record<string, boolean>
  >({});
  const [presetSettingsOpen, setPresetSettingsOpen] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia("(min-width: 1181px)").matches,
  );
  const [tavernHelperWorkbenchOpen, setTavernHelperWorkbenchOpen] =
    useState(false);
  const [tavernHelperInitialTool, setTavernHelperInitialTool] =
    useState<TavernHelperTool>("workbench");
  const [legacyHostPlugins, setLegacyHostPlugins] = useState<
    Record<string, LegacyHostPluginStatus>
  >({});
  const tavernHelperRuntimeRef = useRef<TavernHelperRuntime | null>(null);
  const tavernHelperContextRef = useRef<TavernHelperContext | null>(null);
  const tavernHelperLoadPromiseRef =
    useRef<Promise<TavernHelperRuntime | null> | null>(null);
  const tavernHelperEpochRef = useRef(0);
  const [tavernHelperContext, setTavernHelperContext] =
    useState<TavernHelperContext | null>(null);
  const [tavernHelperButtons, setTavernHelperButtons] = useState<
    TavernHelperRuntimeButton[]
  >([]);
  const [tavernHelperStatus, setTavernHelperStatus] =
    useState<TavernHelperRuntimeStatus>({
      loading: false,
      loadedScriptIds: [],
      errors: [],
    });
  const [tavernHelperRevision, setTavernHelperRevision] = useState(0);
  const legacyManagementLoadRef = useRef<Promise<void> | null>(null);
  const applyLegacyHealth = useCallback(
    (health: Awaited<ReturnType<typeof loadLegacyHostHealth>>) => {
      setLegacyHostPlugins(
        Object.fromEntries(health.plugins.map((plugin) => [plugin.id, plugin])),
      );
      setLegacyAvailability(
        Object.fromEntries(
          health.plugins.map((plugin) => [
            plugin.id,
            !health.safeMode && plugin.installed && plugin.verified,
          ]),
        ),
      );
    },
    [],
  );

  const loadLegacyManagement = useCallback(async () => {
    if (!apiOnline) return;
    if (legacyManagementLoadRef.current) {
      await legacyManagementLoadRef.current;
      return;
    }
    const load = Promise.all([loadLegacyHostHealth(), loadLegacyGrants()])
      .then(([health, grants]) => {
        applyLegacyHealth(health);
        const trustedPluginIds = new Set(
          health.plugins
            .filter((hostPlugin) =>
              legacyPluginCapabilities.every((capability) =>
                grants.some(
                  (grant) =>
                    grant.pluginId === hostPlugin.id &&
                    grant.actor === "legacy-plugin" &&
                    grant.capability === capability &&
                    grant.granted,
                ),
              ),
            )
            .map((hostPlugin) => hostPlugin.id),
        );
        for (const plugin of workspaceStateRef.current.plugins) {
          const canonicalId = canonicalLegacyPluginId(plugin.id);
          if (!canonicalId) continue;
          const hostPlugin = health.plugins.find(
            (candidate) => candidate.id === canonicalId,
          );
          const trusted = trustedPluginIds.has(canonicalId);
          dispatch({
            type: "plugin/update",
            plugin: {
              ...plugin,
              trust: trusted ? "trusted" : "untrusted",
              status:
                hostPlugin?.enabled === true
                  ? trusted
                    ? "enabled"
                    : "attention"
                  : "disabled",
            },
          });
        }
      })
      .catch(() => {
        setLegacyAvailability({});
      });
    legacyManagementLoadRef.current = load;
    try {
      await load;
    } finally {
      if (legacyManagementLoadRef.current === load) {
        legacyManagementLoadRef.current = null;
      }
    }
  }, [apiOnline, applyLegacyHealth]);

  useEffect(() => {
    const awaitingDecision =
      state.agentProposal &&
      ["blocked", "awaiting_confirmation"].includes(state.agentProposal.status);
    if (
      !apiOnline ||
      loading ||
      awaitingDecision ||
      !state.selectedConversationId
    ) {
      return;
    }
    let active = true;
    void loadPendingAgentToolProposal(workspaceStateRef.current)
      .then((pending) => {
        if (active && pending?.proposal) {
          dispatch({
            type: "agent/proposed",
            proposal: pending.proposal,
            run: pending.run,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    state.agentProposal,
    apiOnline,
    loading,
    state.selectedConversationId,
    proposalRefreshKey,
  ]);

  const bootstrapWorkspace = useCallback(() => {
    const requestId = ++bootstrapRequestRef.current;
    dispatch({ type: "bootstrap/loading" });
    void loadWorkspaceFromApi(
      workspaceStateRef.current.selectedPresetId,
      workspaceStateRef.current.selectedConversationId,
    )
      .then((payload) => {
        if (requestId === bootstrapRequestRef.current) {
          dispatch({ type: "bootstrap/api", payload });
        }
      })
      .catch((error: unknown) => {
        if (requestId !== bootstrapRequestRef.current) return;
        dispatch({
          type: "bootstrap/error",
          error:
            error instanceof WorkspaceApiError
              ? error.message
              : "无法连接本地服务。",
        });
      });
  }, []);

  const enterDemoWorkspace = useCallback(() => {
    bootstrapRequestRef.current += 1;
    dispatch({ type: "bootstrap/demo" });
  }, []);

  useEffect(() => {
    bootstrapWorkspace();
  }, [bootstrapWorkspace]);

  useEffect(() => {
    if (state.modal.kind !== "plugins" && state.modal.kind !== "extensions") {
      return;
    }
    void loadLegacyManagement();
  }, [loadLegacyManagement, state.modal.kind]);

  const flushLocalPreferences = useCallback(() => {
    persistTimerRef.current = null;
    const saved = persistWorkspaceState(workspaceStateRef.current);
    if (saved) return;
    if (persistWarningShownRef.current) return;
    persistWarningShownRef.current = true;
    dispatch({
      type: "toast/show",
      tone: "warning",
      message: "本地偏好未保存。当前工作区仍可继续使用。",
    });
  }, []);

  useEffect(() => {
    if (loading) return;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(flushLocalPreferences, 250);
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [
    flushLocalPreferences,
    loading,
    state.draftByConversation,
    state.selectedCardId,
    state.selectedConversationId,
    state.selectedPresetId,
    state.selectedProviderId,
  ]);

  useEffect(() => {
    const flushOnPageHide = () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      flushLocalPreferences();
    };
    window.addEventListener("pagehide", flushOnPageHide);
    return () => window.removeEventListener("pagehide", flushOnPageHide);
  }, [flushLocalPreferences]);

  useEffect(
    () => () => {
      generationControllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const compactLayout = window.matchMedia("(max-width: 1180px)");
    const closeSupportingDrawers = (matches: boolean) => {
      if (!matches) return;
      dispatch({ type: "nav/set", open: false });
      dispatch({ type: "modal/set", modal: { kind: "closed" } });
      setPresetSettingsOpen(false);
    };
    closeSupportingDrawers(compactLayout.matches);
    const onChange = (event: MediaQueryListEvent) =>
      closeSupportingDrawers(event.matches);
    compactLayout.addEventListener("change", onChange);
    return () => compactLayout.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "toast/clear", id: state.toast!.id }),
      3200,
    );
    return () => window.clearTimeout(timeout);
  }, [state.toast]);

  useEffect(() => {
    if (state.modal.kind === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        dispatch({ type: "modal/set", modal: { kind: "closed" } });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.modal.kind]);

  const selectedCard =
    state.cards.find((candidate) => candidate.id === state.selectedCardId) ??
    null;
  const conversation = state.conversations.find(
    (candidate) =>
      candidate.id === state.selectedConversationId &&
      candidate.cardId === selectedCard?.id,
  );
  const messages = conversation
    ? (state.messagesByConversation[conversation.id] ?? [])
    : [];
  const boundWorldbooks = state.worldbooks.filter((worldbook) =>
    conversation?.worldbookIds.includes(worldbook.id),
  );
  const preset = state.presets.find(
    (candidate) => candidate.id === state.selectedPresetId,
  );
  const draft = conversation
    ? (state.draftByConversation[conversation.id] ?? "")
    : "";
  const selectedProvider =
    state.providerConnections.find(
      (provider) => provider.id === state.selectedProviderId,
    ) ?? null;
  const activePersona =
    state.personas.find((persona) => persona.id === conversation?.personaId) ??
    state.personas.find((persona) => persona.isDefault) ??
    null;

  const showToast = useCallback(
    (message: string, tone: "success" | "info" | "warning" = "info") => {
      dispatch({ type: "toast/show", message, tone });
    },
    [],
  );

  const selectConversation = useCallback(
    async (id: string) => {
      if (id === state.selectedConversationId) return;
      await tavernHelperRuntimeRef.current?.flushPersistence();
      dispatch({ type: "conversation/select", id });
    },
    [state.selectedConversationId],
  );

  const selectPersona = useCallback(
    async (persona: Persona) => {
      if (!conversation) return;
      if (conversation.personaId === persona.id) {
        dispatch({ type: "modal/set", modal: { kind: "closed" } });
        return;
      }
      if (apiOnline) {
        try {
          const updated = await setConversationPersona(
            conversation,
            persona.id,
          );
          dispatch({ type: "conversation/persona", conversation: updated });
          dispatch({ type: "modal/set", modal: { kind: "closed" } });
          showToast(`当前对话已切换为“${persona.name}”。`, "success");
        } catch {
          showToast("人设切换失败；当前对话没有改变。", "warning");
        }
        return;
      }
      dispatch({
        type: "conversation/persona",
        conversation: {
          ...conversation,
          personaId: persona.id,
          revision: (conversation.revision ?? 1) + 1,
        },
      });
      dispatch({ type: "modal/set", modal: { kind: "closed" } });
      showToast(`当前对话已切换为“${persona.name}”。`, "success");
    },
    [conversation, showToast, apiOnline],
  );

  const savePersona = useCallback(
    async (input: PersonaInput, current?: Persona) => {
      if (!apiOnline) {
        showToast("连接本地服务后才能保存用户人设。", "warning");
        throw new Error("Persona storage is offline");
      }
      try {
        const saved = current
          ? await updatePersona(current, input)
          : await createPersona(input);
        dispatch({ type: "persona/replace", persona: saved });
        showToast(
          current
            ? `人设“${saved.name}”已保存。`
            : `人设“${saved.name}”已创建。`,
          "success",
        );
      } catch (error) {
        showToast("人设保存失败；服务器内容没有改变。", "warning");
        throw error;
      }
    },
    [showToast, apiOnline],
  );

  const removePersona = useCallback(
    async (persona: Persona) => {
      if (!apiOnline) {
        showToast("离线工作区不能删除服务器人设。", "warning");
        return;
      }
      if (
        !window.confirm(
          `永久删除人设“${persona.name}”？当前使用它的对话会回退到默认人设。`,
        )
      ) {
        return;
      }
      try {
        await deletePersona({
          personaId: persona.id,
          expectedRevision: persona.revision,
        });
        const payload = await loadWorkspaceFromApi(
          state.selectedPresetId,
          state.selectedConversationId,
        );
        dispatch({ type: "bootstrap/api", payload });
        showToast(`人设“${persona.name}”已删除。`, "success");
      } catch {
        showToast("人设删除失败；服务器内容没有改变。", "warning");
      }
    },
    [showToast, apiOnline, state.selectedPresetId],
  );

  const refreshMessages = useCallback(
    async (conversationId: string) => {
      const page = await loadConversationMessagePage(
        conversationId,
        state.selectedPresetId,
      );
      const refreshed = page.items;
      workspaceStateRef.current = {
        ...workspaceStateRef.current,
        messagesByConversation: {
          ...workspaceStateRef.current.messagesByConversation,
          [conversationId]: refreshed,
        },
      };
      dispatch({
        type: "messages/replace",
        conversationId,
        messages: refreshed,
        nextCursor: page.nextCursor,
      });
      return refreshed;
    },
    [state.selectedPresetId],
  );

  const renderPreparedPrompt = useCallback(
    async (
      prepared: Awaited<ReturnType<typeof preparePromptTemplate>>,
      context: TavernHelperContext | null,
    ) => {
      try {
        return await renderPromptTemplateMessages(prepared.messages, {
          enabled: prepared.enabled,
          context,
          directives: prepared.directives,
        });
      } catch (error) {
        showToast(
          `兼容层提示词处理失败，已使用原生提示词路径：${
            error instanceof Error ? error.message : String(error)
          }`,
          "warning",
        );
        return {
          messages: prepared.messages,
          diagnostics: [],
          renderedCount: 0,
          sourceTemplateCount: 0,
        };
      }
    },
    [showToast],
  );

  useEffect(() => {
    tavernHelperEpochRef.current += 1;
    tavernHelperRuntimeRef.current?.dispose();
    tavernHelperRuntimeRef.current = null;
    tavernHelperContextRef.current = null;
    tavernHelperLoadPromiseRef.current = null;
    setTavernHelperButtons([]);
    setTavernHelperContext(null);
    setTavernHelperStatus({
      loading: false,
      loadedScriptIds: [],
      errors: [],
    });
  }, [
    conversation?.id,
    apiOnline,
    state.selectedPresetId,
    state.selectedProviderId,
    tavernHelperRevision,
  ]);

  const ensureTavernHelperRuntime = useCallback(
    async (
      conversationId = conversation?.id,
    ): Promise<TavernHelperRuntime | null> => {
      if (!apiOnline || !conversationId) return null;
      const existing = tavernHelperRuntimeRef.current;
      if (
        existing &&
        tavernHelperContextRef.current?.conversation.id === conversationId
      ) {
        return existing;
      }
      if (tavernHelperLoadPromiseRef.current) {
        return tavernHelperLoadPromiseRef.current;
      }

      const epoch = tavernHelperEpochRef.current;
      const selectedPresetId = workspaceStateRef.current.selectedPresetId;
      const selectedProviderId = workspaceStateRef.current.selectedProviderId;
      const loadPromise = (async () => {
        setTavernHelperStatus((current) => ({
          ...current,
          loading: true,
          errors: [],
        }));
        try {
          const [context, runtimeModule] = await Promise.all([
            loadTavernHelperContext({
              conversationId,
              presetId: selectedPresetId,
            }),
            loadTavernHelperRuntime(),
          ]);
          if (epoch !== tavernHelperEpochRef.current) return null;
          tavernHelperContextRef.current = context;
          setTavernHelperContext(context);
          await new Promise<void>((resolve) =>
            window.requestAnimationFrame(() => resolve()),
          );
          if (epoch !== tavernHelperEpochRef.current) return null;
          const active = () => epoch === tavernHelperEpochRef.current;
          const adapter: TavernHelperRuntimeAdapter = {
            connectionId: selectedProviderId,
            getMessages: () =>
              workspaceStateRef.current.messagesByConversation[
                context.conversation.id
              ] ?? [],
            createMessage: async (input) => {
              const created = await createTavernHelperMessage(
                context.conversation.id,
                input,
              );
              await refreshMessages(context.conversation.id);
              return created;
            },
            deleteMessage: async (message) => {
              await deleteWorkspaceMessage(message.id, message.revision);
              await refreshMessages(context.conversation.id);
            },
            updateMessage: async (message, content) => {
              const updated = await updateWorkspaceMessage(message, content);
              if (active())
                dispatch({ type: "message/replace", message: updated });
              return updated;
            },
            refreshMessages: () => refreshMessages(context.conversation.id),
            generate: async (input) => {
              const prepared = await preparePromptTemplate({
                conversationId: context.conversation.id,
                connectionId: selectedProviderId,
                ...(context.conversation.presetId
                  ? { presetId: context.conversation.presetId }
                  : {}),
              });
              const rendered = await renderPreparedPrompt(prepared, context);
              if (rendered.diagnostics.length > 0) {
                showToast(
                  `提示词模板有 ${String(rendered.diagnostics.length)} 处执行失败；失败代码已从脚本请求中移除。`,
                  "warning",
                );
              }
              return generateWithTavernHelper({
                conversationId: context.conversation.id,
                connectionId: selectedProviderId,
                ...(context.conversation.presetId
                  ? { presetId: context.conversation.presetId }
                  : {}),
                ...input,
                messagesOverride: rendered.messages,
              });
            },
            saveState: (input) =>
              saveTavernHelperState({
                conversationId: context.conversation.id,
                ...(context.conversation.presetId
                  ? { presetId: context.conversation.presetId }
                  : {}),
                ...input,
              }),
            onButtonsChanged: (buttons) => {
              if (active()) setTavernHelperButtons(buttons);
            },
            onStatusChanged: (status) => {
              if (active()) setTavernHelperStatus(status);
            },
            notify: showToast,
          };
          const runtime = new runtimeModule.TavernHelperRuntime(
            context,
            adapter,
          );
          tavernHelperRuntimeRef.current = runtime;
          await runtime.start();
          if (!active()) {
            runtime.dispose();
            return null;
          }
          return runtime;
        } catch (error) {
          if (epoch === tavernHelperEpochRef.current) {
            setTavernHelperStatus({
              loading: false,
              loadedScriptIds: [],
              errors: [
                {
                  sourceScope: "card",
                  sourceId: conversation?.cardId ?? "unknown",
                  scriptId: "runtime",
                  scriptName: "酒馆助手兼容层",
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              ],
            });
            showToast(
              "酒馆助手兼容层加载失败，已保留原生提示词路径。",
              "warning",
            );
          }
          return null;
        }
      })();
      tavernHelperLoadPromiseRef.current = loadPromise;
      try {
        return await loadPromise;
      } finally {
        if (tavernHelperLoadPromiseRef.current === loadPromise) {
          tavernHelperLoadPromiseRef.current = null;
        }
      }
    },
    [
      apiOnline,
      conversation?.cardId,
      conversation?.id,
      refreshMessages,
      renderPreparedPrompt,
      showToast,
    ],
  );

  useEffect(() => {
    if (!apiOnline || !conversation?.id) return;
    // Card and conversation entry must initialize compatibility scripts on
    // arrival. Workbench and generation actions may reuse this runtime, but
    // they must not be the events that create it.
    void ensureTavernHelperRuntime(conversation.id);
  }, [
    apiOnline,
    conversation?.id,
    ensureTavernHelperRuntime,
    state.selectedPresetId,
    state.selectedProviderId,
    tavernHelperRevision,
  ]);

  useEffect(() => {
    if (!apiOnline || !conversation) return;
    let active = true;
    void loadConversationMessagePage(conversation.id, state.selectedPresetId)
      .then((page) => {
        if (!active) return;
        dispatch({
          type: "messages/replace",
          conversationId: conversation.id,
          messages: page.items,
          nextCursor: page.nextCursor,
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [conversation, apiOnline, state.selectedPresetId]);

  const runGeneration = useCallback(
    async (input: {
      conversationId: string;
      mode: GenerationMode;
      targetMessage?: WorkspaceMessage;
    }) => {
      if (!apiOnline || generationControllerRef.current) return;
      const controller = new AbortController();
      generationControllerRef.current = controller;
      dispatch({
        type: "generation/start",
        conversationId: input.conversationId,
        mode: input.mode,
        targetMessageId: input.targetMessage?.id ?? null,
      });

      try {
        let surfacedToolProposal = false;
        const runtime = await ensureTavernHelperRuntime(input.conversationId);
        const helperContext = tavernHelperContextRef.current;
        await runtime?.emit("GENERATION_AFTER_COMMANDS");
        await runtime?.emit("generation_started");
        await runtime?.emit("js_generation_started");
        const scriptInjections =
          (await runtime?.activePromptInjections()) ?? [];
        const preparedTemplate = await preparePromptTemplate({
          conversationId: input.conversationId,
          connectionId: state.selectedProviderId,
          presetId: state.selectedPresetId,
        });
        const renderedTemplate = await renderPreparedPrompt(
          preparedTemplate,
          helperContext,
        );
        if (renderedTemplate.diagnostics.length > 0) {
          showToast(
            `提示词模板有 ${String(renderedTemplate.diagnostics.length)} 处执行失败；失败代码已从本次请求中移除。`,
            "warning",
          );
        }
        const receipt = await generateConversation(
          {
            conversationId: input.conversationId,
            connectionId: state.selectedProviderId,
            presetId: state.selectedPresetId,
            messagesOverride: renderedTemplate.messages,
            injects: scriptInjections,
            ...(input.mode === "regenerate" && input.targetMessage
              ? {
                  targetMessage: {
                    id: input.targetMessage.id,
                    revision: input.targetMessage.revision,
                  },
                }
              : {}),
            signal: controller.signal,
          },
          {
            onGenerationId: (id) => dispatch({ type: "generation/id", id }),
            onTextDelta: (delta) => {
              dispatch({ type: "generation/delta", delta });
              void runtime?.emit(
                "js_stream_token_received_incrementally",
                delta,
              );
            },
            onReasoningDelta: (delta) => {
              dispatch({ type: "generation/reasoning-delta", delta });
            },
            onToolProposal: (event) => {
              try {
                const proposal = proposalFromGenerationToolEvent(
                  workspaceStateRef.current,
                  event,
                );
                if (!proposal) return;
                surfacedToolProposal = true;
                dispatch({
                  type: "agent/proposed",
                  proposal,
                  run: event.run,
                });
              } catch {
                showToast(
                  "模型返回了无法识别的工具提案；没有执行任何写入。",
                  "warning",
                );
              }
            },
          },
        );

        if ("toolProposalOnly" in receipt) {
          showToast(
            surfacedToolProposal
              ? "模型工具提案已打开确认弹窗，等待你的确认。"
              : "模型返回了当前客户端无法处理的工具提案。",
            surfacedToolProposal ? "success" : "warning",
          );
          await runtime?.emit("generation_ended");
          await runtime?.emit("js_generation_ended");
          return;
        }

        const refreshedMessages = await refreshMessages(input.conversationId);
        const responseIndex =
          input.mode === "regenerate" && input.targetMessage
            ? refreshedMessages.findIndex(
                (message) => message.id === input.targetMessage?.id,
              )
            : refreshedMessages.length - 1;
        if (responseIndex >= 0) {
          if (input.mode === "regenerate") {
            const response = refreshedMessages[responseIndex];
            const activeSwipe =
              response?.swipes?.[response.activeSwipeIndex ?? 0];
            try {
              await runtime?.processAssistantSwipe(
                responseIndex,
                activeSwipe?.id,
              );
            } catch (error) {
              showToast(
                `新的 Swipe 已保存，但变量回退或解析失败：${
                  error instanceof Error ? error.message : String(error)
                }`,
                "warning",
              );
            }
          } else {
            await runtime?.emit("message_received", responseIndex, "assistant");
            await runtime?.emit(
              "character_message_rendered",
              responseIndex,
              "assistant",
            );
          }
        }
        await runtime?.emit("generation_ended", receipt.content);
        await runtime?.emit("js_stream_token_received_fully", receipt.content);
        await runtime?.emit("js_generation_ended", receipt.content);
        if (receipt.incomplete) {
          const reason =
            receipt.reason === "length"
              ? "模型达到最大输出长度"
              : receipt.reason === "cancelled"
                ? "生成已停止"
                : receipt.errorMessage || "Provider 连接中断";
          showToast(
            `回复未完整结束（${reason}），已生成的内容已经保留。`,
            "warning",
          );
        } else {
          showToast(
            input.mode === "regenerate"
              ? "新的 Swipe 已完整生成并保存。"
              : "Provider 回复已完整生成并保存。",
            "success",
          );
        }
      } catch (error) {
        await tavernHelperRuntimeRef.current?.emit("generation_stopped");
        await tavernHelperRuntimeRef.current?.emit(
          "js_generation_ended",
          undefined,
          error,
        );
        await refreshMessages(input.conversationId).catch(() => undefined);
        if (
          error instanceof GenerationInterruptedError ||
          controller.signal.aborted
        ) {
          showToast("生成已停止；已接收的内容会保留在消息记录中。");
        } else {
          const detail =
            error instanceof Error
              ? error.message.trim().slice(0, 240)
              : "未知错误";
          showToast(
            `生成失败：${detail || "未知错误"}。已接收的内容会保留在消息记录中。`,
            "warning",
          );
        }
      } finally {
        if (generationControllerRef.current === controller) {
          generationControllerRef.current = null;
          dispatch({ type: "generation/reset" });
        }
      }
    },
    [
      refreshMessages,
      showToast,
      apiOnline,
      state.selectedPresetId,
      state.selectedProviderId,
      ensureTavernHelperRuntime,
      renderPreparedPrompt,
    ],
  );

  const stopGeneration = useCallback(async () => {
    const controller = generationControllerRef.current;
    if (!controller) return;
    dispatch({ type: "generation/stopping" });
    if (!state.generation.generationId) {
      controller.abort();
      return;
    }
    try {
      await abortGeneration(state.generation.generationId);
    } catch {
      controller.abort();
      showToast("停止请求未得到确认，正在断开本次生成。", "warning");
    }
  }, [showToast, state.generation.generationId]);

  const sendMessageContent = useCallback(
    async (rawContent: string) => {
      if (!conversation) return;
      const content = rawContent.trim();
      if (!content) return;
      if (generationControllerRef.current) {
        showToast("当前回复仍在生成，请停止或等待完成后再发送。", "warning");
        return;
      }

      if (apiOnline) {
        try {
          const persisted = await createMessage(conversation.id, { content });
          const currentMessages =
            workspaceStateRef.current.messagesByConversation[conversation.id] ??
            [];
          const nextMessages = [...currentMessages, persisted];
          workspaceStateRef.current = {
            ...workspaceStateRef.current,
            messagesByConversation: {
              ...workspaceStateRef.current.messagesByConversation,
              [conversation.id]: nextMessages,
            },
          };
          dispatch({ type: "message/append", message: persisted });
          await tavernHelperRuntimeRef.current?.emit(
            "message_sent",
            nextMessages.length - 1,
          );
          await tavernHelperRuntimeRef.current?.emit(
            "user_message_rendered",
            nextMessages.length - 1,
            "user",
          );
          await runGeneration({
            conversationId: conversation.id,
            mode: "send",
          });
          return;
        } catch {
          showToast("本地服务暂时不可用，消息已保存在离线工作区。", "warning");
        }
      }

      dispatch({
        type: "message/append",
        message: {
          id: identifier("message"),
          conversationId: conversation.id,
          role: "user",
          content,
          createdLabel: new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date()),
          revision: 1,
        },
      });
    },
    [conversation, runGeneration, showToast, apiOnline],
  );

  const sendMessage = useCallback(async () => {
    await sendMessageContent(draft);
  }, [draft, sendMessageContent]);

  const copyMessage = useCallback(
    async (message: WorkspaceMessage) => {
      try {
        await navigator.clipboard.writeText(message.content);
        showToast("消息已复制。", "success");
      } catch {
        showToast("浏览器未允许写入剪贴板。", "warning");
      }
    },
    [showToast],
  );

  const updateMessage = useCallback(
    async (message: WorkspaceMessage, content: string) => {
      if (apiOnline) {
        try {
          const updated = await updateWorkspaceMessage(message, content);
          dispatch({ type: "message/replace", message: updated });
          await refreshMessages(message.conversationId);
          showToast("消息已保存。", "success");
          return;
        } catch {
          showToast("消息保存失败；服务器内容没有改变。", "warning");
          throw new Error("Message update failed");
        }
      }
      dispatch({ type: "message/update", messageId: message.id, content });
    },
    [refreshMessages, showToast, apiOnline],
  );

  const deleteMessage = useCallback(
    async (message: WorkspaceMessage) => {
      const actor = message.role === "user" ? "你的这条输入" : "这条模型回复";
      if (!window.confirm(`删除${actor}？`)) return;
      if (apiOnline) {
        try {
          await deleteWorkspaceMessage(message.id, message.revision);
        } catch {
          showToast("删除失败；服务器消息仍然保留。", "warning");
          return;
        }
      }
      dispatch({ type: "message/delete", messageId: message.id });
      showToast("消息已删除。", "success");
    },
    [showToast, apiOnline],
  );

  const regenerateMessage = useCallback(
    async (message: WorkspaceMessage) => {
      if (apiOnline) {
        await runGeneration({
          conversationId: message.conversationId,
          mode: "regenerate",
          targetMessage: message,
        });
        return;
      }
      dispatch({
        type: "message/swipe-add",
        messageId: message.id,
        swipe: {
          id: identifier("swipe"),
          content: message.content,
        },
      });
      showToast("已创建离线 Swipe 候选。", "info");
    },
    [runGeneration, showToast, apiOnline],
  );

  const continueFromMessage = useCallback(
    async (message: WorkspaceMessage) => {
      if (apiOnline) {
        await runGeneration({
          conversationId: message.conversationId,
          mode: "continue",
        });
        return;
      }
      dispatch({
        type: "draft/change",
        conversationId: message.conversationId,
        value: "请从这里继续。",
      });
      showToast("续写指令已放入输入框。");
    },
    [runGeneration, showToast, apiOnline],
  );

  const selectSwipe = useCallback(
    (message: WorkspaceMessage, index: number) => {
      const swipe = message.swipes?.[index];
      if (!swipe) return Promise.resolve();
      if (generationControllerRef.current) {
        showToast("当前回复仍在生成，请完成或停止后再切换 Swipe。", "warning");
        return Promise.resolve();
      }

      const operation = swipeSelectionQueueRef.current.then(async () => {
        if (apiOnline) {
          const currentMessage = (
            workspaceStateRef.current.messagesByConversation[
              message.conversationId
            ] ?? []
          ).find((candidate) => candidate.id === message.id);
          if (!currentMessage) return;
          try {
            await selectMessageSwipe(currentMessage, swipe.id);
            const refreshed = await refreshMessages(message.conversationId);
            const messageIndex = refreshed.findIndex(
              (candidate) => candidate.id === message.id,
            );
            if (messageIndex < 0) return;
            try {
              await tavernHelperRuntimeRef.current?.processAssistantSwipe(
                messageIndex,
                swipe.id,
              );
            } catch (error) {
              showToast(
                `Swipe 已切换，但变量回退或解析失败：${
                  error instanceof Error ? error.message : String(error)
                }`,
                "warning",
              );
            }
            return;
          } catch {
            showToast("Swipe 切换失败；服务器状态没有改变。", "warning");
            return;
          }
        }
        dispatch({
          type: "message/swipe-select",
          messageId: message.id,
          index,
        });
      });

      swipeSelectionQueueRef.current = operation.catch(() => undefined);
      return operation;
    },
    [refreshMessages, showToast, apiOnline],
  );

  const loadOlderMessages = useCallback(
    async (conversationId: string) => {
      const current = workspaceStateRef.current;
      const cursor = current.messageNextCursorByConversation[conversationId];
      if (!cursor || current.messageHistoryLoading[conversationId]) return;
      dispatch({
        type: "messages/history-loading",
        conversationId,
        loading: true,
      });
      try {
        const page = await loadConversationMessagePage(
          conversationId,
          current.selectedPresetId,
          cursor,
        );
        dispatch({
          type: "messages/prepend",
          conversationId,
          messages: page.items,
          nextCursor: page.nextCursor,
        });
      } catch {
        dispatch({
          type: "messages/history-loading",
          conversationId,
          loading: false,
        });
        showToast("更早消息加载失败，请稍后重试。", "warning");
      }
    },
    [showToast],
  );

  const createConversationSpace = useCallback(
    async (input: { title: string; cardId: string }) => {
      const card = state.cards.find(
        (candidate) => candidate.id === input.cardId,
      );
      if (!card) {
        showToast("请先选择角色卡，再新建对话。", "warning");
        throw new Error("Card selection is required");
      }
      await tavernHelperRuntimeRef.current?.flushPersistence();
      if (apiOnline) {
        let created: ConversationSpace;
        try {
          created = await createConversationSpaceOnServer(input);
        } catch {
          showToast("会话创建失败；服务器没有写入任何内容。", "warning");
          throw new Error("Conversation creation failed");
        }
        dispatch({ type: "conversation/create", conversation: created });
        try {
          await refreshMessages(created.id);
          showToast(`对话已归入“${card.name}”。`, "success");
        } catch {
          showToast(
            "会话已创建，但首条模型问候暂未刷新；重新载入即可恢复。",
            "warning",
          );
        }
        return;
      }
      dispatch({
        type: "conversation/create",
        conversation: {
          id: identifier("conversation"),
          title: input.title,
          subtitle: `角色卡 · ${card.name}`,
          cardId: card.id,
          worldbookIds: card.worldbookIds,
          updatedLabel: "刚刚",
          unreadCount: 0,
          pinned: false,
        },
      });
      showToast(`对话已归入“${card.name}”并保存在本地。`, "success");
    },
    [refreshMessages, showToast, apiOnline, state.cards],
  );

  const removeConversation = useCallback(
    async (target: ConversationSpace) => {
      if (
        state.generation.conversationId === target.id &&
        state.generation.status !== "idle"
      ) {
        showToast(
          "当前对话仍在生成，请先停止或等待生成完成后再删除。",
          "warning",
        );
        return;
      }
      const accepted = window.confirm(
        `永久删除“${target.title}”？该对话的消息、Swipe、聊天变量、消息变量、对话衍生数据和对话专属世界书绑定会一并删除；仍被其他范围使用的世界书不会受影响。`,
      );
      if (!accepted) return;

      if (apiOnline) {
        try {
          await deleteConversationSpace({
            conversationId: target.id,
            expectedRevision: target.revision ?? 1,
          });
        } catch {
          showToast("对话删除失败；服务器内容没有改变。", "warning");
          return;
        }
      }

      clearMessageFrameStorage(target.id);
      dispatch({ type: "conversation/delete", id: target.id });

      if (apiOnline) {
        try {
          const payload = await loadWorkspaceFromApi(
            state.selectedPresetId,
            state.selectedConversationId,
          );
          dispatch({ type: "bootstrap/api", payload });
        } catch {
          showToast(
            "对话已删除，但工作区刷新失败；请重新载入页面。",
            "warning",
          );
          return;
        }
      }
      showToast(`对话“${target.title}”及其会话数据已删除。`, "success");
    },
    [
      showToast,
      apiOnline,
      state.generation.conversationId,
      state.generation.status,
      state.selectedPresetId,
    ],
  );

  const openRoleCard = useCallback(
    async (cardId: string) => {
      const card = state.cards.find((candidate) => candidate.id === cardId);
      if (!card) return;
      const latestConversation = state.conversations.find(
        (candidate) => candidate.cardId === cardId,
      );
      if (latestConversation) {
        await tavernHelperRuntimeRef.current?.flushPersistence();
        dispatch({ type: "card/select", id: cardId });
        return;
      }
      await createConversationSpace({
        cardId,
        title: `${card.name} · 新对话`,
      });
    },
    [createConversationSpace, state.cards, state.conversations],
  );

  const removeRoleCard = useCallback(
    async (card: RoleCard) => {
      if (!apiOnline) {
        showToast("离线工作区不能删除已导入角色卡。", "warning");
        return;
      }
      const accepted = window.confirm(
        `永久删除“${card.name}”？该角色卡的 ${String(card.conversationCount)} 个历史对话、专属世界书、角色卡正则、脚本和变量数据都会一并删除。`,
      );
      if (!accepted) return;
      try {
        await deleteRoleCard({
          cardId: card.id,
          expectedRevision: card.revision,
        });
        const payload = await loadWorkspaceFromApi(
          state.selectedPresetId,
          state.selectedConversationId,
        );
        dispatch({ type: "bootstrap/api", payload });
        showToast(`角色卡“${card.name}”及其绑定内容已删除。`, "success");
      } catch {
        showToast("角色卡删除失败，服务器内容没有改变。", "warning");
      }
    },
    [showToast, apiOnline, state.selectedPresetId],
  );

  const removePromptPreset = useCallback(
    async (presetToDelete: PromptPreset) => {
      if (!apiOnline) {
        showToast("离线工作区不能删除已导入预设。", "warning");
        return;
      }
      const accepted = window.confirm(
        `永久删除预设“${presetToDelete.name}”？该预设的全部提示词条目、预设正则、脚本和变量数据都会一并删除。`,
      );
      if (!accepted) return;
      try {
        await deletePromptPreset({
          presetId: presetToDelete.id,
          expectedRevision: presetToDelete.revision,
        });
        const payload = await loadWorkspaceFromApi(
          state.selectedPresetId,
          state.selectedConversationId,
        );
        dispatch({ type: "bootstrap/api", payload });
        showToast(
          `预设“${presetToDelete.name}”及其绑定内容已删除。`,
          "success",
        );
      } catch {
        showToast("预设删除失败，服务器内容没有改变。", "warning");
      }
    },
    [showToast, apiOnline],
  );

  const installPlugin = useCallback(
    async (plugin: LegacyPlugin) => {
      const canonicalId = canonicalLegacyPluginId(plugin.id);
      if (!canonicalId) {
        showToast("该插件不在固定兼容目标中。", "warning");
        return;
      }
      const current = legacyHostPlugins[canonicalId];
      if (current?.installed && current.verified) {
        showToast(`${plugin.name} 的固定版本已经安装并通过校验。`);
        return;
      }
      const repository = current?.repository ?? plugin.repository;
      const commit = current?.commit ?? plugin.commit;
      const accepted = window.confirm(
        `将从 ${repository} 下载 ${plugin.name} 的固定提交 ${commit.slice(0, 12)}，校验 manifest 和资源哈希后安装到独立兼容域。安装不会自动启用插件或执行卡内脚本。是否继续？`,
      );
      if (!accepted) return;
      try {
        const result = await installLegacyPlugin(canonicalId, repository);
        const health = await loadLegacyHostHealth();
        applyLegacyHealth(health);
        dispatch({
          type: "plugin/update",
          plugin: { ...plugin, status: "disabled", trust: "untrusted" },
        });
        let grantsRevoked = true;
        try {
          await updateLegacyPluginGrants(canonicalId, false);
        } catch {
          grantsRevoked = false;
        }
        showToast(
          grantsRevoked
            ? result.outcome === "already-installed"
              ? `${plugin.name} 的固定版本已经存在并通过校验，当前保持停用。`
              : `${plugin.name} 已安装并通过固定提交与资源哈希校验，当前保持停用。`
            : `${plugin.name} 已安装且宿主保持停用，但旧授权清理失败；启用前请重试。`,
          grantsRevoked ? "success" : "warning",
        );
      } catch {
        try {
          const health = await loadLegacyHostHealth();
          applyLegacyHealth(health);
          const observed = health.plugins.find(
            (candidate) => candidate.id === canonicalId,
          );
          if (observed?.installed && observed.verified) {
            dispatch({
              type: "plugin/update",
              plugin: { ...plugin, status: "disabled", trust: "untrusted" },
            });
            showToast(
              `${plugin.name} 的安装连接中断，但固定版本已由宿主重新核验；当前保持停用。`,
              "warning",
            );
            return;
          }
        } catch {
          // The host may still be finishing a request after the client timeout.
        }
        showToast(
          `${plugin.name} 安装未完成，或结果暂时无法确认；宿主不会因此启用插件。`,
          "warning",
        );
      }
    },
    [applyLegacyHealth, legacyHostPlugins, showToast],
  );

  const togglePlugin = useCallback(
    async (plugin: LegacyPlugin) => {
      const canonicalId = canonicalLegacyPluginId(plugin.id);
      if (!canonicalId) {
        showToast("该插件不在固定兼容目标中。", "warning");
        return;
      }
      if (!apiOnline) {
        showToast("连接本地服务后才能更新旧版插件授权。", "warning");
        return;
      }
      let health;
      try {
        health = await loadLegacyHostHealth();
        applyLegacyHealth(health);
      } catch {
        showToast("旧版插件隔离服务不可用。", "warning");
        return;
      }
      const hostPlugin = health.plugins.find(
        (candidate) => candidate.id === canonicalId,
      );
      const available = Boolean(
        !health.safeMode && hostPlugin?.installed && hostPlugin.verified,
      );
      setLegacyAvailability((current) => ({
        ...current,
        [canonicalId]: available,
      }));
      if (hostPlugin?.enabled) {
        try {
          await setLegacyPluginEnabled(canonicalId, false);
          let grantsRevoked = true;
          try {
            await updateLegacyPluginGrants(canonicalId, false);
          } catch {
            grantsRevoked = false;
          }
          const refreshed = await loadLegacyHostHealth();
          applyLegacyHealth(refreshed);
          dispatch({
            type: "plugin/update",
            plugin: {
              ...plugin,
              status: "disabled",
              trust: grantsRevoked ? "untrusted" : plugin.trust,
            },
          });
          showToast(
            grantsRevoked
              ? `${plugin.name} 已由宿主停用，旧版插件授权也已撤销。`
              : `${plugin.name} 已由宿主停用，但授权清理失败；插件不会加载。`,
            grantsRevoked ? "success" : "warning",
          );
        } catch {
          showToast("插件停用失败；宿主状态没有确认改变。", "warning");
        }
        return;
      }
      if (!available) {
        dispatch({
          type: "plugin/update",
          plugin: { ...plugin, status: "attention" },
        });
        showToast(
          health.safeMode
            ? "安全模式已禁用所有旧版插件。"
            : "未找到与固定版本及哈希一致的用户安装插件。",
          "warning",
        );
        return;
      }
      const accepted = window.confirm(
        `${plugin.name} 会在独立来源执行已核验的用户安装代码，并获得设置读写、当前角色卡扩展字段和当前预设扩展字段的只读权限。Provider 密钥、主应用 DOM 和数据库不会暴露；卡内脚本仍需独立授权。确认启用？`,
      );
      if (!accepted) return;
      try {
        await updateLegacyPluginGrants(canonicalId, true);
        let enabledPlugin: Awaited<ReturnType<typeof setLegacyPluginEnabled>>;
        try {
          enabledPlugin = await setLegacyPluginEnabled(canonicalId, true);
        } catch (error) {
          await updateLegacyPluginGrants(canonicalId, false).catch(
            () => undefined,
          );
          throw error;
        }
        setLegacyHostPlugins((current) => ({
          ...current,
          [canonicalId]: enabledPlugin,
        }));
        setLegacyAvailability((current) => ({
          ...current,
          [canonicalId]: enabledPlugin.installed && enabledPlugin.verified,
        }));
        dispatch({
          type: "plugin/update",
          plugin: { ...plugin, status: "enabled", trust: "trusted" },
        });
        try {
          const refreshed = await loadLegacyHostHealth();
          applyLegacyHealth(refreshed);
        } catch {
          showToast(
            `${plugin.name} 已启用，但宿主状态列表刷新失败；页面会按本次确认结果加载。`,
            "warning",
          );
          return;
        }
        showToast(`${plugin.name} 已在隔离兼容域启用。`, "success");
      } catch {
        showToast("插件授权失败；兼容域没有启用。", "warning");
      }
    },
    [applyLegacyHealth, showToast, apiOnline],
  );

  const toggleTavernHelperSource = useCallback(
    async (source: TavernHelperSource) => {
      const accepted = window.confirm(
        source.trusted
          ? `停止并撤销“${source.name}”中的全部脚本？`
          : `“${source.name}”包含 ${String(source.bundle.scripts.length)} 个可执行脚本。启用后，脚本可以通过酒馆助手兼容接口读写当前对话、变量、快捷按钮并访问外部网络。仅应信任来源明确的角色卡或预设。是否信任并启用？`,
      );
      if (!accepted) return;
      try {
        await updateTavernHelperGrant({
          scope: source.scope,
          id: source.id,
          granted: !source.trusted,
        });
        setTavernHelperRevision((revision) => revision + 1);
        const scopeLabel =
          source.scope === "global"
            ? "全局"
            : source.scope === "card"
              ? "角色卡"
              : "预设";
        showToast(
          source.trusted
            ? `${scopeLabel}脚本已停止。`
            : `${scopeLabel}脚本已由原生酒馆助手兼容层加载。`,
          "success",
        );
      } catch {
        showToast("脚本信任状态更新失败，现有运行状态保持不变。", "warning");
      }
    },
    [showToast],
  );

  const openTavernHelper = useCallback(
    (tool: TavernHelperTool) => {
      setTavernHelperInitialTool(tool);
      setTavernHelperWorkbenchOpen(true);
      void ensureTavernHelperRuntime();
    },
    [ensureTavernHelperRuntime],
  );

  const saveTavernHelperWorkbenchSettings = useCallback(
    async (settings: NonNullable<TavernHelperContext["settings"]>) => {
      await saveTavernHelperSettings(settings);
      setTavernHelperContext((current) =>
        current ? { ...current, settings } : current,
      );
      setTavernHelperRevision((revision) => revision + 1);
      showToast("酒馆助手设置已保存。", "success");
    },
    [showToast],
  );

  const saveTavernHelperWorkbenchScripts = useCallback(
    async (
      source: Pick<TavernHelperSource, "scope" | "id">,
      scripts: TavernHelperSource["bundle"]["scripts"],
    ) => {
      await saveTavernHelperScripts({ ...source, scripts });
      setTavernHelperRevision((revision) => revision + 1);
      showToast("脚本来源已保存并重新加载。", "success");
    },
    [showToast],
  );

  const saveRenderedMessageVariables = useCallback(
    (message: WorkspaceMessage, variables: Record<string, unknown>) => {
      const snapshot = structuredClone(variables);
      setTavernHelperContext((current) =>
        current
          ? {
              ...current,
              variables: {
                ...current.variables,
                messages: {
                  ...current.variables.messages,
                  [message.id]: snapshot,
                },
              },
            }
          : current,
      );
      void saveTavernHelperState({
        conversationId: message.conversationId,
        ...(state.selectedPresetId ? { presetId: state.selectedPresetId } : {}),
        namespace: "message",
        messageId: message.id,
        variables: snapshot,
      }).catch(() => {
        showToast("状态栏变量保存失败；本次修改没有持久化。", "warning");
      });
    },
    [showToast, state.selectedPresetId],
  );

  const runTavernHelperButton = useCallback(
    async (button: TavernHelperRuntimeButton) => {
      try {
        await tavernHelperRuntimeRef.current?.clickButton(button);
      } catch (error) {
        showToast(
          `脚本按钮执行失败：${
            error instanceof Error ? error.message : String(error)
          }`,
          "warning",
        );
      }
    },
    [showToast],
  );

  const importFile = useCallback(
    async (file: File) => {
      let imported;
      let tavernHelperScriptCount = 0;
      try {
        imported = await importPortableFile(file, {
          ...(state.selectedCardId
            ? { conversationCardId: state.selectedCardId }
            : {}),
        });
      } catch (error) {
        showToast(
          error instanceof WorkspaceApiError &&
            error.code === "CONVERSATION_CARD_REQUIRED"
            ? "请先选择角色卡，再把聊天记录导入到该卡下。"
            : "导入失败；请检查本地服务与文件格式。",
          "warning",
        );
        throw new Error("Import failed", { cause: error });
      }
      if (
        (imported.kind === "card" || imported.kind === "preset") &&
        typeof imported.result === "object" &&
        imported.result !== null
      ) {
        const result = imported.result as Record<string, unknown>;
        const target = result[imported.kind] as
          Record<string, unknown> | undefined;
        const count = result.regexScriptCount;
        if (typeof result.tavernHelperScriptCount === "number") {
          tavernHelperScriptCount = result.tavernHelperScriptCount;
        }
        if (
          typeof target?.id === "string" &&
          typeof count === "number" &&
          count > 0
        ) {
          const accepted = window.confirm(
            `${file.name} 携带 ${String(count)} 条文本正则。是否允许它们处理消息显示副本和发送给模型的提示词副本？原始消息保持不变；正则替换中包含的脚本及 Tavern Helper 脚本仍不会被执行。`,
          );
          if (accepted) {
            try {
              await updateRegexGrant({
                scope: imported.kind,
                id: target.id,
                granted: true,
              });
            } catch {
              showToast(
                "内容已导入，但正则授权保存失败；正则仍保持禁用。",
                "warning",
              );
            }
          }
        }
      }
      try {
        const payload = await loadWorkspaceFromApi(
          state.selectedPresetId,
          state.selectedConversationId,
        );
        dispatch({ type: "bootstrap/api", payload });
      } catch {
        showToast("内容已导入，但工作区刷新失败；请重新载入页面。", "warning");
        return;
      }
      const kindLabel = {
        card: "卡",
        worldbook: "世界书",
        conversation: "聊天记录",
        preset: "提示词预设",
      }[imported.kind];
      showToast(
        `${file.name} 已作为${kindLabel}导入。${
          tavernHelperScriptCount > 0
            ? ` 已保留 ${String(tavernHelperScriptCount)} 个 Tavern Helper 脚本，并保持禁用。`
            : ""
        }`,
        "success",
      );
    },
    [showToast, state.selectedCardId, state.selectedPresetId],
  );

  const handleLegacyStatus = useCallback(
    (status: LegacyRealmStatus) => {
      const plugin = state.plugins.find(
        (candidate) => candidate.id === status.uiPluginId,
      );
      if (!plugin) return;
      if (status.phase === "error") {
        setLegacyAvailability((current) => ({
          ...current,
          [status.pluginId]: false,
        }));
        dispatch({
          type: "plugin/update",
          plugin: { ...plugin, status: "attention" },
        });
        showToast(`${plugin.name} 加载失败：${status.message}`, "warning");
      }
    },
    [showToast, state.plugins],
  );

  const changePermission = useCallback(
    async (
      worldbook: Worldbook,
      entry: WorldbookEntry,
      agentEditable: boolean,
    ) => {
      if (apiOnline) {
        try {
          const result = await updateWorldbookEntryPermission(
            worldbook,
            entry,
            agentEditable,
          );
          dispatch({
            type: "worldbook/entry-permission",
            worldbookId: result.worldbook.id,
            worldbookRevision: result.worldbook.revision,
            entry: result.entry,
          });
          showToast("该条目的 AI 编辑权限已更新。", "success");
          return;
        } catch {
          showToast("权限更新结果未能确认，请刷新后重试。", "warning");
          throw new Error("Permission update failed");
        }
      }
      dispatch({
        type: "worldbook/entry-permission",
        worldbookId: worldbook.id,
        worldbookRevision: worldbook.revision + 1,
        entry: {
          ...entry,
          agentEditable,
          revision: entry.revision + 1,
        },
      });
      showToast("离线演示中的条目权限已更新。", "success");
    },
    [showToast, apiOnline],
  );

  const saveWorldbookEntry = useCallback(
    async (
      worldbook: Worldbook,
      entry: WorldbookEntry,
      patch: WorldbookEntryUpdate,
    ) => {
      if (workspaceStateRef.current.availability === "api") {
        try {
          const updated = await updateWorldbookEntry(worldbook, entry, patch);
          dispatch({
            type: "worldbooks/replace",
            worldbooks: workspaceStateRef.current.worldbooks.map((candidate) =>
              candidate.id === updated.id ? updated : candidate,
            ),
          });
          showToast("世界书条目及召回设置已保存。", "success");
          return;
        } catch {
          showToast("条目保存失败，服务器内容没有改变。", "warning");
          throw new Error("Worldbook entry update failed");
        }
      }

      const updatedEntry: WorldbookEntry = {
        ...entry,
        ...patch,
        keys: [...patch.primaryKeys, ...patch.secondaryKeys],
        revision: entry.revision + 1,
      };
      dispatch({
        type: "worldbooks/replace",
        worldbooks: workspaceStateRef.current.worldbooks.map((candidate) =>
          candidate.id === worldbook.id
            ? {
                ...candidate,
                revision: candidate.revision + 1,
                entries: candidate.entries.map((candidateEntry) =>
                  candidateEntry.id === entry.id
                    ? updatedEntry
                    : candidateEntry,
                ),
              }
            : candidate,
        ),
      });
      showToast("离线演示中的世界书条目已更新。", "success");
    },
    [showToast],
  );

  const changePresetPrompt = useCallback(
    async (
      promptId: string,
      patch: {
        enabled?: boolean;
        inserted?: boolean;
        content?: string;
        role?: PromptPresetEntry["role"];
      },
    ) => {
      const currentState = workspaceStateRef.current;
      const currentPreset = currentState.presets.find(
        (candidate) => candidate.id === currentState.selectedPresetId,
      );
      if (!currentPreset) {
        showToast("没有可更新的提示词预设。", "warning");
        throw new Error("No selected preset");
      }

      if (currentState.availability === "api") {
        try {
          const updated = await updatePresetPrompt({
            presetId: currentPreset.id,
            promptId,
            expectedRevision: currentPreset.revision,
            ...patch,
          });
          dispatch({ type: "preset/replace", preset: updated });
          showToast(
            patch.inserted === true
              ? "预设条目已插入，当前保持停用。"
              : patch.inserted === false
                ? "预设条目已移出当前列表。"
                : patch.enabled === undefined
                  ? "预设条目已保存。"
                  : patch.enabled
                    ? "预设条目已启用。"
                    : "预设条目已停用。",
            "success",
          );
          return;
        } catch {
          showToast("预设条目更新失败，服务器内容没有改变。", "warning");
          throw new Error("Preset prompt update failed");
        }
      }

      const insertionOrder =
        Math.max(
          ...currentPreset.prompts
            .filter((prompt) => prompt.inserted !== false)
            .map((prompt) => prompt.order),
          -1,
        ) + 1;
      dispatch({
        type: "preset/replace",
        preset: {
          ...currentPreset,
          revision: currentPreset.revision + 1,
          prompts: currentPreset.prompts.map((prompt) =>
            prompt.id === promptId
              ? {
                  ...prompt,
                  ...patch,
                  ...(patch.inserted === true
                    ? {
                        inserted: true,
                        enabled: patch.enabled ?? false,
                        order: insertionOrder,
                      }
                    : {}),
                  ...(patch.inserted === false
                    ? { inserted: false, enabled: false }
                    : {}),
                }
              : prompt,
          ),
        },
      });
      showToast("离线演示中的预设条目已更新。", "success");
    },
    [showToast],
  );

  const changePresetGeneration = useCallback(
    async (patch: PresetGenerationPatch) => {
      const currentState = workspaceStateRef.current;
      const currentPreset = currentState.presets.find(
        (candidate) => candidate.id === currentState.selectedPresetId,
      );
      if (!currentPreset) {
        showToast("没有可更新的提示词预设。", "warning");
        throw new Error("No selected preset");
      }

      if (currentState.availability === "api") {
        try {
          const updated = await updatePresetGeneration({
            presetId: currentPreset.id,
            expectedRevision: currentPreset.revision,
            generation: patch,
          });
          dispatch({ type: "preset/replace", preset: updated });
          showToast("预设生成参数已保存。", "success");
          return;
        } catch {
          showToast("生成参数保存失败，服务器内容没有改变。", "warning");
          throw new Error("Preset generation update failed");
        }
      }

      const baseGeneration = currentPreset.generation ?? {
        stop: [],
        samplerOrder: [],
        additional: {},
      };
      const generation = {
        ...baseGeneration,
        ...patch,
        stop: patch.stop ?? baseGeneration.stop,
        samplerOrder: patch.samplerOrder ?? baseGeneration.samplerOrder,
        additional: {
          ...baseGeneration.additional,
          ...(patch.additional ?? {}),
        },
      };
      dispatch({
        type: "preset/replace",
        preset: {
          ...currentPreset,
          generation,
          revision: currentPreset.revision + 1,
        },
      });
      showToast("离线演示中的生成参数已更新。", "success");
    },
    [showToast],
  );

  const reorderPresetPrompts = useCallback(
    async (promptIds: string[]) => {
      const currentState = workspaceStateRef.current;
      const currentPreset = currentState.presets.find(
        (candidate) => candidate.id === currentState.selectedPresetId,
      );
      if (!currentPreset) {
        showToast("没有可排序的提示词预设。", "warning");
        throw new Error("No selected preset");
      }

      if (currentState.availability === "api") {
        try {
          const updated = await reorderPresetPromptsOnServer({
            presetId: currentPreset.id,
            expectedRevision: currentPreset.revision,
            promptIds,
          });
          dispatch({ type: "preset/replace", preset: updated });
          showToast("预设条目顺序已保存。", "success");
          return;
        } catch {
          showToast("顺序保存失败，已恢复服务器中的排列。", "warning");
          throw new Error("Preset prompt reorder failed");
        }
      }

      const orderById = new Map(
        promptIds.map((promptId, index) => [promptId, index]),
      );
      dispatch({
        type: "preset/replace",
        preset: {
          ...currentPreset,
          revision: currentPreset.revision + 1,
          prompts: currentPreset.prompts.map((prompt) => {
            const order = orderById.get(prompt.id);
            return order === undefined ? prompt : { ...prompt, order };
          }),
        },
      });
      showToast("离线演示中的预设顺序已更新。", "success");
    },
    [showToast],
  );

  const changeRegexScope = useCallback(
    async (
      scope: RegexScope,
      patch: { enabled?: boolean; scripts?: RegexScriptDefinition[] },
    ) => {
      const currentState = workspaceStateRef.current;
      if (currentState.availability === "api") {
        try {
          const updated = await saveRegexScopeOnServer({ scope, ...patch });
          dispatch({ type: "regexScope/replace", scope: updated });

          const activeConversation = currentState.conversations.find(
            (candidate) => candidate.id === currentState.selectedConversationId,
          );
          if (activeConversation) {
            const page = await loadConversationMessagePage(
              activeConversation.id,
              currentState.selectedPresetId,
            );
            dispatch({
              type: "messages/replace",
              conversationId: activeConversation.id,
              messages: page.items,
              nextCursor: page.nextCursor,
            });
          }

          showToast(
            patch.enabled === undefined
              ? "正则条目与顺序已保存，消息显示和提示词将使用新版本。"
              : patch.enabled
                ? "正则来源已信任并启用。"
                : "正则来源已停用，导入条目仍完整保留。",
            "success",
          );
          return;
        } catch {
          showToast("正则更新失败，服务器内容没有改变。", "warning");
          throw new Error("Regex scope update failed");
        }
      }

      dispatch({
        type: "regexScope/replace",
        scope: {
          ...scope,
          ...patch,
          revision: scope.revision + 1,
          updatedAt: new Date().toISOString(),
        },
      });
      showToast("离线演示中的正则来源已更新。", "success");
    },
    [showToast],
  );

  const confirmToolProposal = useCallback(async () => {
    if (!state.agentProposal) return;
    if (!apiOnline) {
      showToast("模型工具提案需要连接服务器后才能确认。", "warning");
      return;
    }
    try {
      const result = await confirmAgentProposal(state);
      dispatch({ type: "agent/applied", payload: result });
      showToast("模型工具写入已应用并记录审计。", "success");
    } catch {
      showToast("模型工具写入未应用；请刷新修订状态后重试。", "warning");
    }
  }, [apiOnline, showToast, state]);

  const rejectToolProposal = useCallback(async () => {
    if (!state.agentProposal) return;
    if (!apiOnline || !state.agentRun) {
      showToast("模型工具提案需要连接服务器后才能拒绝。", "warning");
      return;
    }
    try {
      await cancelAgentRun(state.agentRun.id);
    } catch {
      showToast("拒绝提案失败；服务器状态没有改变。", "warning");
      return;
    }
    dispatch({ type: "agent/rejected" });
    showToast("已拒绝这次模型工具提案。", "success");
  }, [showToast, state.agentProposal, state.agentRun, apiOnline]);

  const undoAppliedToolProposal = useCallback(async () => {
    if (!state.agentProposal) return;
    if (!apiOnline) {
      showToast("模型工具写入需要连接服务器后才能撤销。", "warning");
      return;
    }
    try {
      const result = await undoAgentProposal(state);
      dispatch({ type: "agent/undone", payload: result });
      showToast("模型工具写入已在服务器撤销并记录审计。", "success");
      return;
    } catch {
      showToast("撤销失败；服务器内容没有改变。", "warning");
      return;
    }
  }, [apiOnline, showToast, state]);

  const saveProvider = useCallback(
    async (input: ProviderConnectionInput, current?: ProviderConnection) => {
      const saved = await saveProviderConnection(input, current);
      dispatch({ type: "provider/upsert", provider: saved });
      showToast(
        current ? "Provider 连接已更新。" : "Provider 连接已创建。",
        "success",
      );
      return saved;
    },
    [showToast],
  );

  const legacyBridgePlugins = useMemo(
    () =>
      state.plugins
        .filter(
          (plugin) =>
            plugin.id !== "plugin-js-slash-runner" &&
            plugin.id !== "plugin-st-prompt-template",
        )
        .map((plugin) => {
          const canonicalId = canonicalLegacyPluginId(plugin.id);
          const hostEnabled =
            canonicalId !== null &&
            legacyHostPlugins[canonicalId]?.enabled === true;
          return {
            id: plugin.id,
            enabled: apiOnline && plugin.status === "enabled" && hostEnabled,
            available:
              canonicalId !== null && legacyAvailability[canonicalId] === true,
          };
        }),
    [legacyAvailability, legacyHostPlugins, apiOnline, state.plugins],
  );

  const legacyRealmPanels = (
    <Suspense fallback={null}>
      <LazyLegacyRealmBridge
        plugins={legacyBridgePlugins}
        scope={{
          ...(conversation === undefined
            ? {}
            : { conversationId: conversation.id }),
          ...(preset === undefined ? {} : { presetId: preset.id }),
          revisionKey: `${String(messages.length)}:${
            messages.at(-1)?.id ?? "empty"
          }:${String(messages.at(-1)?.revision ?? 0)}`,
        }}
        onRpc={(_pluginId, request) => callLegacyRpc(request)}
        onStatus={handleLegacyStatus}
      />
    </Suspense>
  );

  const workspaceOverlays = (
    <>
      <WorkspaceModals
        modal={state.modal}
        apiOnline={apiOnline}
        cards={state.cards}
        selectedCard={selectedCard}
        preset={preset}
        regexScopes={state.regexScopes}
        expandedPanels={state.expandedPanels}
        personas={state.personas}
        activePersonaId={activePersona?.id ?? null}
        plugins={state.plugins}
        pluginRealms={legacyRealmPanels}
        legacyHostPlugins={legacyHostPlugins}
        worldbooks={state.worldbooks}
        activeWorldbooks={boundWorldbooks}
        agentProposal={state.agentProposal}
        providerConnections={state.providerConnections}
        selectedProviderId={state.selectedProviderId}
        onClose={() =>
          dispatch({ type: "modal/set", modal: { kind: "closed" } })
        }
        onSelectPersona={selectPersona}
        onSavePersona={savePersona}
        onDeletePersona={removePersona}
        onCreateConversation={createConversationSpace}
        onImport={importFile}
        onInstallPlugin={installPlugin}
        onTogglePlugin={togglePlugin}
        onPermission={changePermission}
        onRequestWorldbookPermission={(worldbookId, entryId) =>
          dispatch({
            type: "modal/set",
            modal: { kind: "permission", worldbookId, entryId },
          })
        }
        onTogglePanel={(panel) => dispatch({ type: "panel/toggle", panel })}
        onSaveRegexScope={changeRegexScope}
        onSaveWorldbookEntry={saveWorldbookEntry}
        onOpenPlugins={() =>
          dispatch({ type: "modal/set", modal: { kind: "plugins" } })
        }
        onConfirmToolProposal={() => void confirmToolProposal()}
        onRejectToolProposal={() => void rejectToolProposal()}
        onUndoToolProposal={() => void undoAppliedToolProposal()}
        onSelectProvider={(id) => dispatch({ type: "provider/select", id })}
        onSaveProvider={saveProvider}
        onLoadProviderModels={loadProviderModels}
      />
      {state.toast ? (
        <div
          className={`toast toast--${state.toast.tone}`}
          role="status"
          aria-live="polite"
        >
          {state.toast.message}
        </div>
      ) : null}
    </>
  );

  if (!conversation) {
    return (
      <>
        <CardConversationEntry
          cards={state.cards}
          onSelectCard={(id) => void openRoleCard(id)}
          onImport={() =>
            dispatch({ type: "modal/set", modal: { kind: "import" } })
          }
          notice={
            <WorkspaceConnectionBanner
              availability={state.availability}
              error={state.bootstrapError}
              onRetry={bootstrapWorkspace}
              onEnterDemo={enterDemoWorkspace}
            />
          }
        />
        {workspaceOverlays}
      </>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="brand-mark" aria-hidden="true">
            <ChatCircleDots size={21} weight="fill" />
          </span>
          <div>
            <strong>SillyTavern N</strong>
            <span>Conversation workspace</span>
          </div>
        </div>
        <nav className="topbar__actions" aria-label="工作区操作">
          <div className="topbar-action-group" aria-label="角色与生成配置">
            <button
              className="topbar-button"
              type="button"
              aria-label={state.navOpen ? "关闭角色卡选择" : "打开角色卡选择"}
              aria-expanded={state.navOpen}
              onClick={() =>
                dispatch({ type: "nav/set", open: !state.navOpen })
              }
            >
              <Books size={18} />
              <span>角色卡</span>
            </button>
            <button
              className="topbar-button persona-button"
              type="button"
              aria-label="管理用户人设"
              onClick={() =>
                dispatch({ type: "modal/set", modal: { kind: "personas" } })
              }
            >
              <UserCircle size={18} />
              <span>{activePersona?.name ?? "用户人设"}</span>
            </button>
            <button
              className="topbar-button"
              type="button"
              aria-label={presetSettingsOpen ? "关闭预设设置" : "打开预设设置"}
              aria-expanded={presetSettingsOpen}
              onClick={() => setPresetSettingsOpen((open) => !open)}
            >
              <SlidersHorizontal size={18} />
              <span>预设</span>
            </button>
          </div>

          <div className="topbar-action-group" aria-label="内容规则">
            <button
              className="topbar-button"
              type="button"
              aria-label="打开世界书菜单"
              onClick={() =>
                dispatch({ type: "modal/set", modal: { kind: "worldbooks" } })
              }
            >
              <BookOpenText size={18} />
              <span>世界书</span>
            </button>
            <button
              className="topbar-button"
              type="button"
              aria-label="打开正则菜单"
              onClick={() =>
                dispatch({ type: "modal/set", modal: { kind: "regex" } })
              }
            >
              <BracketsCurly size={18} />
              <span>正则</span>
            </button>
          </div>

          <div className="topbar-action-group" aria-label="连接与维护">
            <button
              className="topbar-button provider-button"
              type="button"
              aria-label="管理 Provider 连接"
              onClick={() =>
                dispatch({ type: "modal/set", modal: { kind: "providers" } })
              }
            >
              <PlugsConnected size={18} />
              <span>{selectedProvider?.name ?? "本地 Provider"}</span>
            </button>
            <button
              className="topbar-button"
              type="button"
              aria-label="打开扩展菜单"
              onClick={() =>
                dispatch({ type: "modal/set", modal: { kind: "extensions" } })
              }
            >
              <PuzzlePiece size={18} />
              <span>扩展</span>
            </button>
            <button
              className="topbar-button"
              type="button"
              aria-label="导入便携内容"
              onClick={() =>
                dispatch({ type: "modal/set", modal: { kind: "import" } })
              }
            >
              <UploadSimple size={18} />
              <span>导入</span>
            </button>
          </div>

          <div className="topbar__status">
            <SurfaceStatus tone={apiOnline ? "mint" : "slate"}>
              {apiOnline ? <CloudCheck size={14} /> : <CloudSlash size={14} />}
              {loading ? "正在连接" : apiOnline ? "本地服务在线" : "离线工作区"}
            </SurfaceStatus>
          </div>
        </nav>
      </header>

      <div className="workspace-layout">
        <PresetSettingsRail
          open={presetSettingsOpen}
          presets={state.presets}
          selectedPresetId={state.selectedPresetId}
          onSelectPreset={(id) => dispatch({ type: "preset/select", id })}
          onDeletePreset={(presetToDelete) =>
            void removePromptPreset(presetToDelete)
          }
          onTogglePrompt={(promptId, enabled) =>
            changePresetPrompt(promptId, { enabled })
          }
          onSavePrompt={(promptId, content, role) =>
            changePresetPrompt(promptId, { content, role })
          }
          onSaveGeneration={changePresetGeneration}
          onInsertPrompt={(promptId) =>
            changePresetPrompt(promptId, { inserted: true })
          }
          onDetachPrompt={(promptId) =>
            changePresetPrompt(promptId, { inserted: false })
          }
          onReorderPrompts={reorderPresetPrompts}
          onClose={() => setPresetSettingsOpen(false)}
        />

        <main className="conversation-workspace">
          <WorkspaceConnectionBanner
            availability={state.availability}
            error={state.bootstrapError}
            onRetry={bootstrapWorkspace}
            onEnterDemo={enterDemoWorkspace}
          />
          <header className="conversation-header">
            <div className="conversation-header__identity">
              <div>
                <h1>{conversation.title}</h1>
                <p>
                  角色卡 · {selectedCard?.name}
                  {activePersona ? ` · 你是${activePersona.name}` : ""}
                </p>
              </div>
            </div>
          </header>

          <MessageStream
            conversationId={conversation.id}
            cardId={selectedCard?.id}
            storageConversationIds={state.conversations
              .filter((candidate) => candidate.cardId === selectedCard?.id)
              .map((candidate) => candidate.id)}
            messages={messages}
            hasMore={Boolean(
              state.messageNextCursorByConversation[conversation.id],
            )}
            loadingOlder={Boolean(state.messageHistoryLoading[conversation.id])}
            onLoadOlder={() => loadOlderMessages(conversation.id)}
            generation={state.generation}
            helperRenderSettings={tavernHelperContext?.settings?.render}
            variablesByMessage={tavernHelperContext?.variables.messages}
            onCopy={copyMessage}
            onUpdate={updateMessage}
            onDelete={deleteMessage}
            onRegenerate={regenerateMessage}
            onContinue={continueFromMessage}
            onSelectSwipe={selectSwipe}
            onEmbeddedSend={(content) => void sendMessageContent(content)}
            onVariablesChange={saveRenderedMessageVariables}
          />

          <ConversationComposer
            draft={draft}
            conversations={state.conversations.filter(
              (candidate) => candidate.cardId === selectedCard?.id,
            )}
            selectedConversationId={conversation.id}
            cardName={selectedCard?.name ?? "当前角色卡"}
            disabled={
              state.generation.status !== "idle" &&
              state.generation.conversationId !== conversation.id
            }
            generationStatus={
              state.generation.conversationId === conversation.id
                ? state.generation.status
                : "idle"
            }
            scriptSources={(tavernHelperContext?.sources ?? []).filter(
              (source) => source.bundle.scripts.length > 0,
            )}
            scriptButtons={tavernHelperButtons}
            scriptStatus={tavernHelperStatus}
            onDraftChange={(value) =>
              dispatch({
                type: "draft/change",
                conversationId: conversation.id,
                value,
              })
            }
            onSelectConversation={selectConversation}
            onDeleteConversation={(target) => void removeConversation(target)}
            onCreateConversation={() =>
              dispatch({
                type: "modal/set",
                modal: {
                  kind: "create_conversation",
                  cardId: selectedCard!.id,
                },
              })
            }
            onOpenCards={() => dispatch({ type: "nav/set", open: true })}
            onOpenHelperTool={openTavernHelper}
            onToggleScriptSource={(source) =>
              void toggleTavernHelperSource(source)
            }
            onScriptButton={(button) => void runTavernHelperButton(button)}
            onSend={sendMessage}
            onStop={() => void stopGeneration()}
          />
        </main>

        <Suspense fallback={null}>
          {tavernHelperWorkbenchOpen ? (
            <LazyTavernHelperWorkbench
              open
              initialTool={tavernHelperInitialTool}
              context={tavernHelperContext}
              status={tavernHelperStatus}
              onClose={() => setTavernHelperWorkbenchOpen(false)}
              onToggleSource={(source) => void toggleTavernHelperSource(source)}
              onSaveSettings={saveTavernHelperWorkbenchSettings}
              onSaveScripts={saveTavernHelperWorkbenchScripts}
              onSaveVariables={async (target, variables) => {
                await saveTavernHelperState({
                  conversationId: conversation.id,
                  ...(state.selectedPresetId
                    ? { presetId: state.selectedPresetId }
                    : {}),
                  namespace: target.namespace,
                  variables,
                  ...(target.messageId ? { messageId: target.messageId } : {}),
                });
                setTavernHelperRevision((revision) => revision + 1);
                showToast("变量已保存。", "success");
              }}
              onLoadPrompt={async () => {
                await ensureTavernHelperRuntime(conversation.id);
                const prepared = await preparePromptTemplate({
                  conversationId: conversation.id,
                  connectionId: state.selectedProviderId,
                  ...(state.selectedPresetId
                    ? { presetId: state.selectedPresetId }
                    : {}),
                });
                const rendered = await renderPreparedPrompt(
                  prepared,
                  tavernHelperContextRef.current,
                );
                return {
                  ...prepared,
                  messages: rendered.messages,
                  templateCount: rendered.sourceTemplateCount,
                  renderedCount: rendered.renderedCount,
                  diagnostics: rendered.diagnostics,
                };
              }}
            />
          ) : null}
        </Suspense>

        <NavigationRail
          key={state.selectedCardId || "card-list"}
          open={state.navOpen}
          cards={state.cards}
          selectedCardId={state.selectedCardId}
          onSelectCard={(id) => void openRoleCard(id)}
          onCreateConversation={(cardId) =>
            dispatch({
              type: "modal/set",
              modal: { kind: "create_conversation", cardId },
            })
          }
          onDeleteCard={(card) => void removeRoleCard(card)}
          onClose={() => dispatch({ type: "nav/set", open: false })}
        />
      </div>

      {presetSettingsOpen ? (
        <button
          className="drawer-scrim drawer-scrim--preset"
          aria-label="关闭预设设置"
          type="button"
          onClick={() => setPresetSettingsOpen(false)}
        />
      ) : null}
      {state.navOpen ? (
        <button
          className="drawer-scrim drawer-scrim--nav"
          aria-label="关闭角色卡选择"
          type="button"
          onClick={() => dispatch({ type: "nav/set", open: false })}
        />
      ) : null}
      {workspaceOverlays}
    </div>
  );
}
