import { SlidersHorizontal } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import type { PromptPreset } from "../domain/workspace";

export type PresetGenerationPatch = Partial<PromptPreset["generation"]>;

type Draft = {
  reasoningEffort: string;
  maxContextTokens: number;
  maxContextUnlocked: boolean;
  maxOutputTokens: number;
  n: number;
  stream: boolean;
  temperature: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topP: number;
};

const contextLimit = (preset: PromptPreset): number => {
  const value = preset.generation?.additional?.maxContextTokens;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 32_768;
};

const draftFromPreset = (preset: PromptPreset): Draft => ({
  reasoningEffort:
    typeof preset.generation?.additional?.reasoning_effort === "string"
      ? preset.generation.additional.reasoning_effort
      : "auto",
  maxContextTokens: contextLimit(preset),
  maxContextUnlocked:
    preset.generation?.additional?.maxContextUnlocked === true,
  maxOutputTokens: preset.generation?.maxOutputTokens ?? 300,
  n: preset.generation?.n ?? 1,
  stream: preset.generation?.stream !== false,
  temperature: preset.generation?.temperature ?? 1,
  frequencyPenalty: preset.generation?.frequencyPenalty ?? 0,
  presencePenalty: preset.generation?.presencePenalty ?? 0,
  topP: preset.generation?.topP ?? 1,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const numberFromInput = (
  value: string,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = integer ? Math.trunc(parsed) : parsed;
  return clamp(normalized, min, max);
};

const decimalLabel = (value: number): string => value.toFixed(2);

export function PresetGenerationControls({
  preset,
  onSave,
}: {
  preset: PromptPreset;
  onSave: (patch: PresetGenerationPatch) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFromPreset(preset));
  const submittedRef = useRef<Record<string, number | boolean | string>>({});

  useEffect(() => {
    setDraft(draftFromPreset(preset));
    submittedRef.current = {};
  }, [preset.id, preset.revision]);

  const submit = (
    key: keyof Draft,
    value: number | boolean | string,
    patch: PresetGenerationPatch,
  ) => {
    if (submittedRef.current[key] === value) return;
    submittedRef.current[key] = value;
    void onSave(patch).catch(() => {
      if (submittedRef.current[key] === value) delete submittedRef.current[key];
    });
  };

  const contextMaximum = draft.maxContextUnlocked
    ? 2_000_000
    : Math.max(200_000, draft.maxContextTokens);

  const commitContext = (value: number) => {
    const normalized = clamp(Math.trunc(value), 512, contextMaximum);
    setDraft((current) => ({ ...current, maxContextTokens: normalized }));
    submit("maxContextTokens", normalized, {
      additional: { maxContextTokens: normalized },
    });
  };

  const commitNumber = (
    key: "maxOutputTokens" | "n",
    value: number,
    min: number,
    max: number,
  ) => {
    const normalized = Math.trunc(clamp(value, min, max));
    setDraft((current) => ({ ...current, [key]: normalized }));
    submit(key, normalized, { [key]: normalized });
  };

  const commitDecimal = (
    key: "temperature" | "frequencyPenalty" | "presencePenalty" | "topP",
    value: number,
    min: number,
    max: number,
  ) => {
    const normalized = clamp(value, min, max);
    setDraft((current) => ({ ...current, [key]: normalized }));
    submit(key, normalized, { [key]: normalized });
  };

  return (
    <section className="preset-generation" aria-label="生成参数">
      <div className="preset-generation__heading">
        <span>
          <SlidersHorizontal size={14} />
          生成参数
        </span>
        <small>修改后写入当前预设，下一次生成生效</small>
      </div>

      <label className="preset-generation__check">
        <input
          type="checkbox"
          checked={draft.maxContextUnlocked}
          onChange={(event) => {
            const value = event.target.checked;
            setDraft((current) => ({ ...current, maxContextUnlocked: value }));
            submit("maxContextUnlocked", value, {
              additional: { maxContextUnlocked: value },
            });
          }}
        />
        <span>解锁上下文长度</span>
        <small>允许使用更大的上下文窗口</small>
      </label>

      <label className="preset-generation__field">
        <span className="preset-generation__label-row">
          <span>上下文长度（以词符数计）</span>
          <output>{draft.maxContextTokens}</output>
        </span>
        <span className="preset-generation__range-row">
          <input
            type="range"
            min={512}
            max={contextMaximum}
            step={512}
            value={Math.min(draft.maxContextTokens, contextMaximum)}
            aria-label="上下文长度（以词符数计）"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxContextTokens: Number(event.target.value),
              }))
            }
            onPointerUp={() => commitContext(draft.maxContextTokens)}
            onBlur={() => commitContext(draft.maxContextTokens)}
          />
          <input
            type="number"
            min={512}
            max={contextMaximum}
            step={512}
            value={draft.maxContextTokens}
            aria-label="上下文长度数值"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxContextTokens: numberFromInput(
                  event.target.value,
                  current.maxContextTokens,
                  512,
                  contextMaximum,
                  true,
                ),
              }))
            }
            onBlur={() => commitContext(draft.maxContextTokens)}
          />
        </span>
      </label>

      <label className="preset-generation__field preset-generation__field--number">
        <span>最大回复长度（以词符数计）</span>
        <input
          type="number"
          min={1}
          max={128_000}
          value={draft.maxOutputTokens}
          aria-label="最大回复长度（以词符数计）"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              maxOutputTokens: numberFromInput(
                event.target.value,
                current.maxOutputTokens,
                1,
                128_000,
                true,
              ),
            }))
          }
          onBlur={() =>
            commitNumber("maxOutputTokens", draft.maxOutputTokens, 1, 128_000)
          }
        />
      </label>

      <label className="preset-generation__field preset-generation__field--number">
        <span>每次生成多个备选回复</span>
        <input
          type="number"
          min={1}
          max={16}
          value={draft.n}
          aria-label="每次生成多个备选回复"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              n: numberFromInput(event.target.value, current.n, 1, 16, true),
            }))
          }
          onBlur={() => commitNumber("n", draft.n, 1, 16)}
        />
      </label>

      <label className="preset-generation__check">
        <input
          type="checkbox"
          checked={draft.stream}
          onChange={(event) => {
            const value = event.target.checked;
            setDraft((current) => ({ ...current, stream: value }));
            submit("stream", value, { stream: value });
          }}
        />
        <span>流式传输</span>
        <small>边生成边显示回复内容</small>
      </label>

      <GenerationRange
        label="温度"
        value={draft.temperature}
        min={0}
        max={2}
        step={0.01}
        display={decimalLabel(draft.temperature)}
        onChange={(value) =>
          setDraft((current) => ({ ...current, temperature: value }))
        }
        onCommit={() => commitDecimal("temperature", draft.temperature, 0, 2)}
      />
      <GenerationRange
        label="频率惩罚"
        value={draft.frequencyPenalty}
        min={-2}
        max={2}
        step={0.01}
        display={decimalLabel(draft.frequencyPenalty)}
        onChange={(value) =>
          setDraft((current) => ({ ...current, frequencyPenalty: value }))
        }
        onCommit={() =>
          commitDecimal("frequencyPenalty", draft.frequencyPenalty, -2, 2)
        }
      />
      <GenerationRange
        label="存在惩罚"
        value={draft.presencePenalty}
        min={-2}
        max={2}
        step={0.01}
        display={decimalLabel(draft.presencePenalty)}
        onChange={(value) =>
          setDraft((current) => ({ ...current, presencePenalty: value }))
        }
        onCommit={() =>
          commitDecimal("presencePenalty", draft.presencePenalty, -2, 2)
        }
      />
      <GenerationRange
        label="Top P"
        value={draft.topP}
        min={0}
        max={1}
        step={0.01}
        display={decimalLabel(draft.topP)}
        onChange={(value) =>
          setDraft((current) => ({ ...current, topP: value }))
        }
        onCommit={() => commitDecimal("topP", draft.topP, 0, 1)}
      />

      <label className="preset-generation__field">
        <span className="preset-generation__label-row">思考强度</span>
        <select
          aria-label="思考强度"
          value={draft.reasoningEffort}
          onChange={(event) => {
            const value = event.target.value;
            setDraft((current) => ({ ...current, reasoningEffort: value }));
            submit("reasoningEffort", value, {
              additional: { reasoning_effort: value },
            });
          }}
        >
          {!["auto", "low", "medium", "high"].includes(
            draft.reasoningEffort,
          ) && (
            <option value={draft.reasoningEffort}>
              {draft.reasoningEffort}（预设值）
            </option>
          )}
          <option value="auto">自动（模型默认）</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
        <small>由当前模型决定支持的强度；自动使用模型默认设置。</small>
      </label>
    </section>
  );
}

function GenerationRange({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="preset-generation__field">
      <span className="preset-generation__label-row">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <span className="preset-generation__range-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={onCommit}
          onBlur={onCommit}
        />
        <output aria-label={`${label}数值`}>{display}</output>
      </span>
    </label>
  );
}
