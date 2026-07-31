import type { LegacyModuleSurface } from "./types.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function quoted(value: string): string {
  return JSON.stringify(value);
}

export function createLegacyFacadeModule(surface: LegacyModuleSurface): string {
  const lines = [
    "const bridge = globalThis.__STN_LEGACY_BRIDGE__;",
    "if (!bridge) throw new Error('SillyTavern N legacy bridge is unavailable');",
  ];

  for (const exportName of surface.exports) {
    if (exportName === "default") {
      lines.push(
        `export default bridge.symbol(${quoted(surface.path)}, "default");`,
      );
      continue;
    }
    if (!IDENTIFIER.test(exportName)) {
      throw new Error(`Invalid ESM export name: ${exportName}`);
    }
    lines.push(
      `export const ${exportName} = bridge.symbol(${quoted(surface.path)}, ${quoted(exportName)});`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export interface LegacyEventBus {
  emit(event: string, ...args: unknown[]): Promise<void>;
  emitAndWait(event: string, ...args: unknown[]): Promise<void>;
  makeFirst(event: string, listener: (...args: unknown[]) => unknown): void;
  makeLast(event: string, listener: (...args: unknown[]) => unknown): void;
  on(event: string, listener: (...args: unknown[]) => unknown): void;
  once(event: string, listener: (...args: unknown[]) => unknown): void;
  removeListener(
    event: string,
    listener: (...args: unknown[]) => unknown,
  ): void;
}

interface Listener {
  readonly callback: (...args: unknown[]) => unknown;
  readonly once: boolean;
  readonly order: number;
  readonly sequence: number;
}

export function createLegacyEventBus(): LegacyEventBus {
  const listeners = new Map<string, Listener[]>();
  let sequence = 0;

  const register = (
    event: string,
    callback: (...args: unknown[]) => unknown,
    once: boolean,
    order: number,
  ) => {
    const current = listeners.get(event) ?? [];
    current.push({ callback, once, order, sequence: sequence++ });
    current.sort(
      (left, right) =>
        left.order - right.order || left.sequence - right.sequence,
    );
    listeners.set(event, current);
  };

  const bus: LegacyEventBus = {
    on: (event, listener) => register(event, listener, false, 0),
    once: (event, listener) => register(event, listener, true, 0),
    makeFirst: (event, listener) => register(event, listener, false, -1),
    makeLast: (event, listener) => register(event, listener, false, 1),
    removeListener: (event, listener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter(
          (item) => item.callback !== listener,
        ),
      );
    },
    emit: async (event, ...args) => {
      const snapshot = [...(listeners.get(event) ?? [])];
      for (const listener of snapshot) {
        await listener.callback(...args);
        if (listener.once) {
          bus.removeListener(event, listener.callback);
        }
      }
    },
    emitAndWait: async (event, ...args) => {
      await bus.emit(event, ...args);
    },
  };

  return bus;
}
