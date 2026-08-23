import {
  LEGACY_REALM_PROTOCOL,
  type LegacyPluginLock,
} from "@stn/legacy-compat";

function json(value: string): string {
  return JSON.stringify(value);
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface LegacyRealmOptions {
  readonly activateExport?: string;
  readonly conversationId?: string;
  readonly presetId?: string;
}

export function createLegacyRealmHtml(
  lock: LegacyPluginLock,
  mainOrigin: string,
  options: LegacyRealmOptions = {},
): string {
  const entry = `/scripts/extensions/third-party/${lock.installDirectory}/${lock.entryPath}`;
  const stylesheets = lock.stylesheetPaths
    .map(
      (stylesheet) =>
        `<link rel="stylesheet" href="${html(
          `/scripts/extensions/third-party/${lock.installDirectory}/${stylesheet}`,
        )}">`,
    )
    .join("\n  ");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(lock.displayName)} · SillyTavern N Legacy Realm</title>
  <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
  ${stylesheets}
  <style>
    :root {
      color-scheme: light;
      --SmartThemeBodyColor: #263746;
      --SmartThemeEmColor: #5d8297;
      --SmartThemeQuoteColor: #d65f52;
      --SmartThemeBlurTintColor: #f7fbfd;
      --SmartThemeBorderColor: #d9e3e8;
      --SmartThemeChatTintColor: #ffffff;
      --SmartThemeUserMesBlurTintColor: #edf7fb;
      --SmartThemeBotMesBlurTintColor: #ffffff;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      overflow-x: hidden;
      background: #f7fbfd;
      color: #263746;
      font: 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #extensions_settings, #extensions_settings2 { display: grid; gap: 8px; padding: 8px; }
    #send_form, #chat { display: none; }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }
    input, select, textarea {
      max-width: 100%;
      color: inherit;
      background: #fff;
      border: 1px solid #d9e3e8;
      border-radius: 6px;
    }
    .inline-drawer {
      overflow: hidden;
      background: #fff;
      border: 1px solid #d9e3e8;
      border-radius: 8px;
    }
    .inline-drawer-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      padding: 8px 10px;
      font-weight: 650;
    }
    .inline-drawer-content { padding: 0 10px 10px; }
    .flex-container { display: flex; align-items: center; gap: 8px; }
    .flex1 { flex: 1 1 auto; }
    .menu_button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 5px 9px;
      color: inherit;
      background: #edf7fb;
      border: 1px solid #cbdde5;
      border-radius: 6px;
    }
  </style>
  <script
    type="application/json"
    src="https://testingcf.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js"
    data-loaded="true"
  ></script>
</head>
<body>
  <aside id="extensions_settings" aria-label="Legacy extension settings"></aside>
  <aside id="extensions_settings2" aria-label="Legacy script extension settings"></aside>
  <form id="send_form">
    <div id="qr--bar"><div class="qr--buttons"></div></div>
  </form>
  <main id="chat" aria-label="Legacy chat mirror"></main>
  <button id="mes_stop" type="button" hidden>Stop</button>
  <div id="world_popup_entries_list" hidden></div>
  <script src="/vendor/lodash.min.js"></script>
  <script src="/vendor/jquery.min.js"></script>
  <script src="/vendor/popper.min.js"></script>
  <script>
    (() => {
      const protocol = ${json(LEGACY_REALM_PROTOCOL)};
      const targetOrigin = ${json(mainOrigin)};
      const pluginId = ${json(lock.id)};
      const installDirectory = ${json(lock.installDirectory)};
      const activateExport = ${json(options.activateExport ?? "")};
      const conversationId = ${json(options.conversationId ?? "")};
      const presetId = ${json(options.presetId ?? "")};
      const pending = new Map();
      const stable = new Map();
      const extensionSettings = Object.create(null);
      const extensionPrompts = Object.create(null);
      let sequence = 0;
      let settingsTimer = null;
      let loadedModule = null;
      let crashed = false;

      function notify(type, detail = {}) {
        window.parent.postMessage({ protocol, type, pluginId, ...detail }, targetOrigin);
      }

      function describeError(error) {
        return error instanceof Error ? error.message : String(error);
      }

      function reportCrash(stage, error) {
        if (crashed) return;
        crashed = true;
        console.error("[SillyTavern N legacy realm]", stage, error);
        notify("plugin.error", { stage, message: describeError(error) });
      }

      function postAs(actor, method, capability, params, timeoutMs = 1500) {
        if (crashed) return Promise.reject(new Error("Legacy realm has crashed."));
        const id = pluginId + ":" + (++sequence);
        const promise = new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            pending.delete(id);
            reject(new Error("Legacy host RPC timed out."));
          }, timeoutMs);
          pending.set(id, {
            resolve: (value) => {
              window.clearTimeout(timeout);
              resolve(value);
            },
            reject: (error) => {
              window.clearTimeout(timeout);
              reject(error);
            },
          });
        });
        window.parent.postMessage({
          protocol,
          id,
          pluginId,
          actor,
          method,
          capability,
          params,
        }, targetOrigin);
        return promise;
      }

      function post(method, capability, params, timeoutMs = 1500) {
        return postAs("legacy-plugin", method, capability, params, timeoutMs);
      }

      window.addEventListener("message", (event) => {
        if (event.origin !== targetOrigin || event.source !== window.parent) return;
        const response = event.data;
        if (!response || response.protocol !== protocol) return;
        if (response.type === "host.event" && typeof response.event === "string") {
          void eventSource.emit(response.event, response.payload);
          return;
        }
        if (!pending.has(response.id)) return;
        const waiter = pending.get(response.id);
        pending.delete(response.id);
        if (response.ok) waiter.resolve(response.result);
        else waiter.reject(Object.assign(new Error(response.error.message), response.error));
      });

      window.addEventListener("error", (event) => {
        if (!event.error && !event.message) {
          notify("plugin.resource-error", {
            resource: event.target?.src || event.target?.href || "unknown",
          });
          return;
        }
        reportCrash("runtime", event.error || event.message);
      });
      window.addEventListener("unhandledrejection", (event) => {
        reportCrash("unhandled-rejection", event.reason);
      });

      const eventListeners = new Map();
      let listenerSequence = 0;
      function registerEvent(event, callback, once, order) {
        const current = eventListeners.get(event) || [];
        current.push({ callback, once, order, sequence: listenerSequence++ });
        current.sort((a, b) => a.order - b.order || a.sequence - b.sequence);
        eventListeners.set(event, current);
      }
      const eventSource = {
        on: (event, listener) => registerEvent(event, listener, false, 0),
        once: (event, listener) => registerEvent(event, listener, true, 0),
        makeFirst: (event, listener) => registerEvent(event, listener, false, -1),
        makeLast: (event, listener) => registerEvent(event, listener, false, 1),
        removeListener: (event, listener) => {
          eventListeners.set(event, (eventListeners.get(event) || []).filter((item) => item.callback !== listener));
        },
        emit: async (event, ...args) => {
          for (const item of [...(eventListeners.get(event) || [])]) {
            try {
              await item.callback(...args);
            } catch (error) {
              notify("plugin.listener-error", { event, message: describeError(error) });
            }
            if (item.once) eventSource.removeListener(event, item.callback);
          }
        },
        emitAndWait: async (event, ...args) => eventSource.emit(event, ...args),
      };

      const eventTypes = new Proxy(Object.create(null), {
        get(target, property) {
          if (typeof property !== "string") return target[property];
          if (!(property in target)) target[property] = property;
          return target[property];
        },
      });

      function scheduleSettingsSave() {
        window.clearTimeout(settingsTimer);
        settingsTimer = window.setTimeout(() => {
          void post("settings.save", "settings.write", { value: extensionSettings })
            .catch((error) => notify("plugin.settings-error", { message: describeError(error) }));
        }, 250);
      }

      async function loadSettings() {
        try {
          const value = await post("settings.load", "settings.read", {});
          if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.assign(extensionSettings, value);
          }
        } catch (error) {
          notify("plugin.settings-unavailable", { message: describeError(error) });
        }
      }

      async function renderExtensionTemplateAsync(directory, template) {
        const expected = "third-party/" + installDirectory;
        if (directory !== expected || !/^[A-Za-z0-9._/-]+$/.test(template)) {
          throw new Error("Legacy template path is outside the plugin realm.");
        }
        const suffix = template.endsWith(".html") ? template : template + ".html";
        const response = await fetch(
          "/scripts/extensions/third-party/" + installDirectory + "/" + suffix,
          { credentials: "omit" },
        );
        if (!response.ok) throw new Error("Legacy extension template was not found.");
        return response.text();
      }

      const legacySlashCommands = new Map();
      const ARGUMENT_TYPE = Object.freeze({
        STRING: "string",
        NUMBER: "number",
        RANGE: "range",
        BOOLEAN: "bool",
        VARIABLE_NAME: "varname",
        CLOSURE: "closure",
        SUBCOMMAND: "subcommand",
        LIST: "list",
        DICTIONARY: "dictionary",
      });
      const enumTypes = Object.freeze({
        enum: "enum",
        command: "command",
        namedArgument: "namedArgument",
        variable: "variable",
        qr: "qr",
        macro: "macro",
        number: "number",
        name: "name",
      });
      const enumIcons = Object.freeze({
        default: "enum",
        file: "file",
        true: "true",
        false: "false",
        boolean: "boolean",
      });
      class SlashCommand {
        static fromProps(properties) { return { ...properties }; }
      }
      class SlashCommandArgument {
        constructor(
          description,
          typeList = [ARGUMENT_TYPE.STRING],
          isRequired = false,
          acceptsMultiple = false,
          defaultValue = null,
          enumList = [],
          enumProvider = null,
          forceEnum = false,
        ) {
          this.description = description;
          this.typeList = Array.isArray(typeList) ? typeList : [typeList];
          this.isRequired = Boolean(isRequired);
          this.acceptsMultiple = Boolean(acceptsMultiple);
          this.defaultValue = defaultValue;
          this.enumList = Array.isArray(enumList) ? enumList : [enumList];
          this.enumProvider = enumProvider;
          this.forceEnum = Boolean(forceEnum);
        }
        static fromProps(properties) {
          return new SlashCommandArgument(
            properties.description,
            properties.typeList,
            properties.isRequired,
            properties.acceptsMultiple,
            properties.defaultValue,
            properties.enumList,
            properties.enumProvider,
            properties.forceEnum,
          );
        }
      }
      class SlashCommandNamedArgument extends SlashCommandArgument {
        constructor(
          name,
          description,
          typeList,
          isRequired,
          acceptsMultiple,
          defaultValue,
          enumList,
          aliasList = [],
          enumProvider,
          forceEnum,
        ) {
          super(
            description,
            typeList,
            isRequired,
            acceptsMultiple,
            defaultValue,
            enumList,
            enumProvider,
            forceEnum,
          );
          this.name = name;
          this.aliasList = Array.isArray(aliasList) ? aliasList : [aliasList];
        }
        static fromProps(properties) {
          return new SlashCommandNamedArgument(
            properties.name,
            properties.description,
            properties.typeList,
            properties.isRequired,
            properties.acceptsMultiple,
            properties.defaultValue,
            properties.enumList,
            properties.aliasList,
            properties.enumProvider,
            properties.forceEnum,
          );
        }
      }
      class SlashCommandEnumValue {
        constructor(
          value,
          description = null,
          type = enumTypes.enum,
          typeIcon = enumIcons.default,
          matchProvider = null,
          valueProvider = null,
          makeSelectable = false,
        ) {
          this.value = String(value ?? "");
          this.description = description;
          this.type = type || enumTypes.enum;
          this.typeIcon = typeIcon || enumIcons.default;
          this.matchProvider = matchProvider;
          this.valueProvider = valueProvider;
          this.makeSelectable = Boolean(makeSelectable);
        }
        static fromProps(properties) {
          return new SlashCommandEnumValue(
            properties.value,
            properties.description,
            properties.type,
            properties.typeIcon,
            properties.matchProvider,
            properties.valueProvider,
            properties.makeSelectable,
          );
        }
        toString() { return this.value; }
      }
      const commonEnumProviders = Object.freeze({
        boolean(mode = "trueFalse") {
          return () => {
            if (mode === "onOff" || mode === "onOffToggle") {
              const values = [
                new SlashCommandEnumValue("on", null, enumTypes.macro, enumIcons.true),
                new SlashCommandEnumValue("off", null, enumTypes.macro, enumIcons.false),
              ];
              if (mode === "onOffToggle") {
                values.push(
                  new SlashCommandEnumValue(
                    "toggle",
                    null,
                    enumTypes.macro,
                    enumIcons.boolean,
                  ),
                );
              }
              return values;
            }
            if (mode === "trueFalse") {
              return [
                new SlashCommandEnumValue("true", null, enumTypes.macro, enumIcons.true),
                new SlashCommandEnumValue("false", null, enumTypes.macro, enumIcons.false),
              ];
            }
            throw new Error("Unsupported legacy boolean enum mode: " + mode);
          };
        },
      });
      const legacyMacros = new Map();
      class MacrosParser {
        static registerMacro(name, replacement) {
          const key = String(name || "").trim();
          if (!key) throw new Error("Legacy macro name is required.");
          legacyMacros.set(key, replacement);
          return replacement;
        }
        static unregisterMacro(name) {
          return legacyMacros.delete(String(name || "").trim());
        }
      }
      const SlashCommandParser = {
        addCommandObject(command) {
          const name = String(command?.name || command?.command || "").toLowerCase();
          if (!/^[a-z][a-z0-9._-]*$/.test(name)) throw new Error("Invalid legacy slash command name.");
          if (legacySlashCommands.has(name)) throw new Error("Legacy slash command is already registered: " + name);
          legacySlashCommands.set(name, command);
          return command;
        },
      };
      async function executeSlashCommandsWithOptions(source, options = {}) {
        const trimmed = String(source || "").trim();
        if (!trimmed.startsWith("/")) return { pipe: trimmed, isHandled: false };
        const pieces = trimmed.slice(1).split(/\\s+/);
        const name = String(pieces.shift() || "").toLowerCase();
        const command = legacySlashCommands.get(name);
        if (!command) {
          if (options.handleParserErrors === false) return { pipe: "", isHandled: false };
          throw new Error("Unknown legacy slash command: /" + name);
        }
        const value = pieces.join(" ");
        const callback = command.callback || command.execute;
        const result = typeof callback === "function" ? await callback({}, value) : "";
        return { pipe: result == null ? "" : String(result), isHandled: true };
      }

      const arraySymbols = new Set(["chat", "characters", "groups", "world_names", "selected_world_info"]);
      const objectSymbols = new Set([
        "chat_metadata", "oai_settings", "power_user", "promptManager", "world_info"
      ]);
      const scalarDefaults = new Map([
        ["this_chid", null], ["selected_group", null], ["name1", "User"],
        ["name2", "Assistant"], ["main_api", "openai"], ["online_status", "no_connection"],
      ]);
      const presetList = { presets: [], preset_names: Object.create(null) };
      let currentCharacter = null;
      let currentPresetId = "";
      let currentPresetName = "";
      const presetManager = {
        getPresetList: () => presetList,
        getSelectedPreset: () => currentPresetId,
        getSelectedPresetName: () => currentPresetName,
        savePreset: async () => {
          throw new Error("The compatibility preset projection is read-only.");
        },
      };

      function getContext() {
        return {
          chat: universalSymbol("/script.js", "chat"),
          characters: universalSymbol("/script.js", "characters"),
          eventSource,
          event_types: eventTypes,
          extensionSettings,
          extensionPrompts,
          presetManager,
          saveSettingsDebounced: scheduleSettingsSave,
          getCurrentChatId: () => conversationId || "",
          getRequestHeaders: () => Object.freeze({}),
          saveChat: async () => undefined,
        };
      }

      function capabilityFor(modulePath, name) {
        if (modulePath.includes("world-info")) {
          return /^(save|create|delete|set|update)/i.test(name) ? "worldbook.write" : "worldbook.read";
        }
        if (/^(save|delete|set|update|add|clear|generate|stop)/i.test(name)) return "chat.write";
        return "chat.read";
      }

      function translate(template, ...values) {
        if (Array.isArray(template) && Object.prototype.hasOwnProperty.call(template, "raw")) {
          return template.reduce(
            (result, part, index) => result + part + (index < values.length ? String(values[index]) : ""),
            "",
          );
        }
        return String(template ?? "");
      }

      function getLastMessageId(options = {}) {
        const chat = universalSymbol("/script.js", "chat");
        const filter = typeof options?.filter === "function" ? options.filter : null;
        for (let index = chat.length - 1; index >= 0; index -= 1) {
          if (!filter || filter(chat[index])) return index;
        }
        return -1;
      }

      function renderLegacyMarkdown(source) {
        const escaped = String(source ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
        return '<div class="legacy-markdown">' + escaped.replaceAll("\\n", "<br>") + "</div>";
      }

      function universalSymbol(modulePath, name) {
        const key = modulePath + "::" + name;
        if (stable.has(key)) return stable.get(key);
        const worldInfoPosition = Object.freeze({
          before: 0,
          after: 1,
          ANTop: 2,
          ANBottom: 3,
          atDepth: 4,
          EMTop: 5,
          EMBottom: 6,
          outlet: 7,
        });
        const worldInfoLogic = Object.freeze({
          AND_ANY: 0,
          NOT_ALL: 1,
          NOT_ANY: 2,
          AND_ALL: 3,
        });
        const special = {
          eventSource,
          event_types: eventTypes,
          extension_settings: extensionSettings,
          extension_prompts: extensionPrompts,
          getContext,
          getCurrentLocale: () =>
            document.documentElement.lang || navigator.language || "en",
          t: translate,
          getPresetManager: () => presetManager,
          getCurrentChatId: () => conversationId || "",
          getLastMessageId,
          uuidv4: () => crypto.randomUUID(),
          reloadMarkdownProcessor: () => ({ makeHtml: renderLegacyMarkdown }),
          getCharacterCardFields: () => currentCharacter?.data || {},
          getCharacters: async () => universalSymbol("/script.js", "characters"),
          getOneCharacter: async () => currentCharacter,
          callGenericPopup: async () => false,
          saveSettingsDebounced: scheduleSettingsSave,
          saveMetadataDebounced: scheduleSettingsSave,
          renderExtensionTemplateAsync,
          SlashCommand,
          SlashCommandArgument,
          SlashCommandNamedArgument,
          SlashCommandEnumValue,
          ARGUMENT_TYPE,
          enumTypes,
          enumIcons,
          commonEnumProviders,
          MacrosParser,
          SlashCommandParser,
          executeSlashCommandsWithOptions,
          isAdmin: () => false,
          isMobile: () => window.matchMedia?.("(max-width: 720px)").matches === true,
          getRequestHeaders: () => Object.freeze({}),
          setExtensionPrompt: (id, content) => { extensionPrompts[id] = content; },
          getExtensionPrompt: (id) => extensionPrompts[id],
          getExtensionPromptByName: (id) => extensionPrompts[id],
          world_info_position: worldInfoPosition,
          wi_anchor_position: Object.freeze({ before: 0, after: 1 }),
          world_info_logic: worldInfoLogic,
          DEFAULT_DEPTH: 4,
          DEFAULT_WEIGHT: 100,
          METADATA_KEY: "world_info",
        };
        if (Object.prototype.hasOwnProperty.call(special, name)) {
          const value = special[name];
          stable.set(key, value);
          return value;
        }
        if (arraySymbols.has(name)) {
          const value = [];
          stable.set(key, value);
          return value;
        }
        if (objectSymbols.has(name)) {
          const value = {};
          stable.set(key, value);
          return value;
        }
        if (scalarDefaults.has(name)) return scalarDefaults.get(name);

        const callable = function (...args) {
          return post(
            "legacy.symbol.call",
            capabilityFor(modulePath, name),
            { modulePath, name, args },
          ).catch((error) => {
            throw new Error(
              "Legacy symbol " +
                modulePath +
                "::" +
                name +
                " failed: " +
                describeError(error),
            );
          });
        };
        const proxy = new Proxy(callable, {
          construct(_target, args) {
            return { __legacyClass: name, args };
          },
          get(target, property) {
            if (property === "then") return undefined;
            if (property === Symbol.toPrimitive) return () => name;
            if (property in target) return Reflect.get(target, property);
            if (property === "fromProps") return (properties) => ({ ...properties });
            return universalSymbol(modulePath + "/" + name, String(property));
          },
        });
        stable.set(key, proxy);
        return proxy;
      }

      async function hydrateCurrentContent() {
        if (conversationId) {
          try {
            const snapshot = await post(
              "character.current.read",
              "character.read",
              { conversationId },
            );
            if (snapshot?.character) {
              currentCharacter = snapshot.character;
              const characters = universalSymbol("/script.js", "characters");
              characters.splice(0, characters.length, snapshot.character);
              scalarDefaults.set("this_chid", Number(snapshot.chid ?? 0));
              scalarDefaults.set("name2", String(snapshot.character.name || "Assistant"));
              try {
                const scripts = await postAs(
                  "embedded-script",
                  "character.scripts.read",
                  "character.read",
                  { conversationId },
                );
                if (
                  scripts?.extensions &&
                  typeof scripts.extensions === "object" &&
                  !Array.isArray(scripts.extensions)
                ) {
                  Object.assign(
                    currentCharacter.data.extensions,
                    scripts.extensions,
                  );
                }
              } catch {
                // Card scripts remain absent until the user grants the script actor.
              }
            }
          } catch (error) {
            notify("plugin.context-unavailable", {
              scope: "character",
              message: describeError(error),
            });
          }
          try {
            const snapshot = await postAs(
              "embedded-script",
              "chat.snapshot",
              "chat.read",
              { conversationId },
            );
            if (Array.isArray(snapshot?.messages)) {
              const chat = universalSymbol("/script.js", "chat");
              chat.splice(
                0,
                chat.length,
                ...snapshot.messages.map((message, index) => ({
                  mes: String(message?.content || ""),
                  name:
                    message?.role === "user"
                      ? String(scalarDefaults.get("name1") || "User")
                      : String(scalarDefaults.get("name2") || "Assistant"),
                  is_user: message?.role === "user",
                  is_system: message?.role === "system",
                  send_date: message?.createdAt || "",
                  swipe_id: Number(
                    Array.isArray(message?.swipes)
                      ? message.swipes.findIndex((swipe) => swipe?.selected)
                      : 0,
                  ),
                  swipe_info: Array.isArray(message?.swipes)
                    ? message.swipes
                    : [],
                  extra: {
                    stnMessageId: message?.id || String(index),
                    stnRevision: Number(message?.revision || 0),
                  },
                })),
              );
            }
          } catch {
            // Chat source remains absent until the user grants the script actor.
          }
        }
        if (presetId) {
          try {
            const snapshot = await post(
              "preset.current.read",
              "preset.read",
              { presetId },
            );
            if (snapshot?.preset) {
              currentPresetId = String(snapshot.id || presetId);
              currentPresetName = String(snapshot.preset.name || "Preset");
              presetList.presets.splice(0, presetList.presets.length, snapshot.preset);
              for (const key of Object.keys(presetList.preset_names)) {
                delete presetList.preset_names[key];
              }
              presetList.preset_names[currentPresetName] = 0;
              const settings = universalSymbol("/scripts/openai.js", "oai_settings");
              for (const key of Object.keys(settings)) delete settings[key];
              Object.assign(settings, snapshot.preset);
              try {
                const scripts = await postAs(
                  "embedded-script",
                  "preset.scripts.read",
                  "preset.read",
                  { presetId },
                );
                if (
                  scripts?.extensions &&
                  typeof scripts.extensions === "object" &&
                  !Array.isArray(scripts.extensions)
                ) {
                  Object.assign(snapshot.preset.extensions, scripts.extensions);
                }
              } catch {
                // Preset scripts remain absent until the user grants the script actor.
              }
            }
          } catch (error) {
            notify("plugin.context-unavailable", {
              scope: "preset",
              message: describeError(error),
            });
          }
        }
      }

      window.__STN_LEGACY_BRIDGE__ = {
        symbol: universalSymbol,
        eventSource,
        rpc: post,
      };
      const popupType = Object.freeze({
        TEXT: 1,
        CONFIRM: 2,
        INPUT: 3,
        DISPLAY: 4,
      });
      const popupResult = Object.freeze({
        AFFIRMATIVE: 1,
        NEGATIVE: 0,
        CANCELLED: null,
      });
      const toolManager = Object.freeze({
        registerFunctionTool: () => undefined,
        unregisterFunctionTool: () => undefined,
        isToolCallingSupported: () => false,
      });
      window.SillyTavern = {
        getContext,
        getCurrentChatId: () => conversationId || "",
        getRequestHeaders: () => Object.freeze({}),
        getChatCompletionModel: () => "",
        callGenericPopup: async () => popupResult.CANCELLED,
        saveChat: async () => undefined,
        saveSettingsDebounced: scheduleSettingsSave,
        registerMacro: (name, replacement) =>
          MacrosParser.registerMacro(name, replacement),
        unregisterMacro: (name) => MacrosParser.unregisterMacro(name),
        unregisterFunctionTool: () => undefined,
        ToolManager: toolManager,
        POPUP_TYPE: popupType,
        POPUP_RESULT: popupResult,
        chat: universalSymbol("/script.js", "chat"),
        characters: universalSymbol("/script.js", "characters"),
        get characterId() { return scalarDefaults.get("this_chid"); },
        get name2() { return scalarDefaults.get("name2"); },
        extensionSettings,
        chatCompletionSettings: universalSymbol(
          "/scripts/openai.js",
          "oai_settings",
        ),
      };
      window._ = window._ || {};
      window.hljs = window.hljs || { highlightElement: () => undefined };
      window.toastr = {
        info: console.info.bind(console),
        success: console.info.bind(console),
        warning: console.warn.bind(console),
        error: console.error.bind(console),
      };

      async function shutdown() {
        window.clearTimeout(settingsTimer);
        try {
          await post("settings.save", "settings.write", { value: extensionSettings }, 500);
        } catch {}
        try {
          if (loadedModule && typeof loadedModule.exit === "function") {
            await loadedModule.exit();
          }
        } catch (error) {
          notify("plugin.deactivate-error", { message: describeError(error) });
        }
        for (const waiter of pending.values()) {
          waiter.reject(new Error("Legacy realm was shut down."));
        }
        pending.clear();
      }
      window.__STN_LEGACY_SHUTDOWN__ = shutdown;
      window.addEventListener("pagehide", () => { void shutdown(); }, { once: true });

      notify("realm.ready");
      void (async () => {
        await loadSettings();
        await hydrateCurrentContent();
        try {
          loadedModule = await import(${json(entry)});
          if (activateExport && typeof loadedModule[activateExport] === "function") {
            await loadedModule[activateExport]();
          }
          notify("plugin.loaded");
        } catch (error) {
          reportCrash("activate", error);
        }
      })();
    })();
  </script>
</body>
</html>`;
}
