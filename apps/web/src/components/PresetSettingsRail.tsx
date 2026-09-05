import {
  BookOpenText,
  PlugsConnected,
  SlidersHorizontal,
  Trash,
  X,
} from "@phosphor-icons/react";

import type { PromptPreset, PromptPresetEntry } from "../domain/workspace";
import { PresetDetail } from "./ContextRail";
import type { PresetGenerationPatch } from "./PresetGenerationControls";
import { IconButton } from "./WorkspacePrimitives";

type PresetSettingsRailProps = {
  open: boolean;
  presets: PromptPreset[];
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  onDeletePreset: (preset: PromptPreset) => void;
  onTogglePrompt: (promptId: string, enabled: boolean) => Promise<void>;
  onSavePrompt: (
    promptId: string,
    content: string,
    role: PromptPresetEntry["role"],
  ) => Promise<void>;
  onSaveGeneration: (patch: PresetGenerationPatch) => Promise<void>;
  onInsertPrompt: (promptId: string) => Promise<void>;
  onDetachPrompt: (promptId: string) => Promise<void>;
  onReorderPrompts: (promptIds: string[]) => Promise<void>;
  onClose: () => void;
  providerName?: string;
  onOpenProvider?: () => void;
};

export function PresetSettingsRail({
  open,
  presets,
  selectedPresetId,
  onSelectPreset,
  onDeletePreset,
  onTogglePrompt,
  onSavePrompt,
  onSaveGeneration,
  onInsertPrompt,
  onDetachPrompt,
  onReorderPrompts,
  onClose,
  providerName,
  onOpenProvider,
}: PresetSettingsRailProps) {
  const preset = presets.find((candidate) => candidate.id === selectedPresetId);

  return (
    <aside
      className={`preset-settings-rail${
        open ? " preset-settings-rail--open" : ""
      }`}
      aria-label="预设设置"
    >
      <div className="preset-settings-rail__header">
        <div>
          <SlidersHorizontal size={18} />
          <span>
            <strong>预设与生成</strong>
            <small>调整参数与提示词</small>
          </span>
        </div>
        <IconButton
          className="preset-settings-rail__close"
          label="关闭预设设置"
          icon={<X size={18} />}
          onClick={onClose}
          compact
        />
      </div>

      <div className="preset-settings-rail__scroll">
        {onOpenProvider ? (
          <button
            type="button"
            className="preset-provider"
            onClick={onOpenProvider}
            aria-label="管理 Provider 连接"
          >
            <PlugsConnected size={18} />
            <span>
              <small>模型连接</small>
              <strong>{providerName ?? "本地 Provider"}</strong>
            </span>
            <span className="preset-provider__action">管理</span>
          </button>
        ) : null}
        <div className="preset-settings-rail__select">
          <span>
            <BookOpenText size={15} />
            当前预设
          </span>
          <div className="preset-settings-rail__select-row">
            <select
              aria-label="当前预设"
              value={selectedPresetId}
              onChange={(event) => onSelectPreset(event.target.value)}
            >
              {presets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <IconButton
              compact
              className="preset-settings-rail__delete"
              label={preset ? `删除预设 ${preset.name}` : "删除当前预设"}
              icon={<Trash size={16} />}
              onClick={() => {
                if (preset) onDeletePreset(preset);
              }}
              disabled={!preset}
            />
          </div>
        </div>

        {preset ? (
          <PresetDetail
            preset={preset}
            onToggle={onTogglePrompt}
            onSave={onSavePrompt}
            onSaveGeneration={onSaveGeneration}
            onInsert={onInsertPrompt}
            onDetach={onDetachPrompt}
            onReorder={onReorderPrompts}
          />
        ) : (
          <p className="support-empty">请先导入或选择一个提示词预设。</p>
        )}
      </div>
    </aside>
  );
}
