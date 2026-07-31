import type { NativeCapability } from "./manifest.js";

export const EXTENSION_UI_SLOTS = [
  "top-toolbar",
  "message-input",
  "message-actions",
  "card-detail-tab",
  "settings-section",
  "message-before",
  "message-after",
  "dialog",
] as const;

export type ExtensionUiSlot = (typeof EXTENSION_UI_SLOTS)[number];

export interface ExtensionUiContext {
  readonly extensionId: string;
  readonly slot: ExtensionUiSlot;
  readonly signal: AbortSignal;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ExtensionUiContribution {
  readonly id: string;
  readonly extensionId: string;
  readonly slot: ExtensionUiSlot;
  readonly order?: number;
  readonly render: (context: ExtensionUiContext) => unknown;
}

export class ExtensionUiRegistry {
  readonly #contributions = new Map<string, ExtensionUiContribution>();

  constructor(
    private readonly requireCapability: (
      extensionId: string,
      capability: NativeCapability,
    ) => void,
  ) {}

  register(contribution: ExtensionUiContribution): () => void {
    this.requireCapability(contribution.extensionId, "ui.panel");
    const key = `${contribution.extensionId}:${contribution.id}`;
    if (this.#contributions.has(key)) {
      throw new Error(`UI contribution ${key} is already registered.`);
    }
    this.#contributions.set(key, Object.freeze({ ...contribution }));
    return () => {
      this.#contributions.delete(key);
    };
  }

  list(slot: ExtensionUiSlot): readonly ExtensionUiContribution[] {
    return [...this.#contributions.values()]
      .filter((contribution) => contribution.slot === slot)
      .sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) ||
          left.extensionId.localeCompare(right.extensionId) ||
          left.id.localeCompare(right.id),
      );
  }

  removeExtension(extensionId: string): void {
    for (const [key, contribution] of this.#contributions) {
      if (contribution.extensionId === extensionId) {
        this.#contributions.delete(key);
      }
    }
  }

  render(
    slot: ExtensionUiSlot,
    data: Readonly<Record<string, unknown>>,
    signal = new AbortController().signal,
  ): readonly unknown[] {
    return this.list(slot).map((contribution) =>
      contribution.render({
        extensionId: contribution.extensionId,
        slot,
        signal,
        data,
      }),
    );
  }
}
