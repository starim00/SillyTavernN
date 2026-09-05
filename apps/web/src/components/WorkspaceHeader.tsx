import {
  BookOpenText,
  Books,
  BracketsCurly,
  ChatCircleDots,
  CloudCheck,
  CloudSlash,
  GearSix,
  LockKey,
  PlugsConnected,
  PuzzlePiece,
  SlidersHorizontal,
  UploadSimple,
  UserCircle,
} from "@phosphor-icons/react";
import { ActionPopover } from "./ActionPopover";
import { SurfaceStatus } from "./WorkspacePrimitives";

type SettingsTarget =
  "personas" | "worldbooks" | "regex" | "providers" | "extensions" | "import";

export function WorkspaceHeader({
  title,
  cardName,
  personaName,
  navOpen,
  presetOpen,
  online,
  loading,
  onToggleCards,
  onTogglePreset,
  onOpenSettings,
  onOpenSecurity,
}: {
  title: string;
  cardName: string;
  personaName: string;
  navOpen: boolean;
  presetOpen: boolean;
  online: boolean;
  loading: boolean;
  onToggleCards: () => void;
  onTogglePreset: () => void;
  onOpenSettings: (target: SettingsTarget) => void;
  onOpenSecurity: () => void;
}) {
  const settings = [
    {
      target: "personas",
      label: "用户人设",
      icon: UserCircle,
    },
    { target: "worldbooks", label: "世界书", icon: BookOpenText },
    { target: "regex", label: "正则", icon: BracketsCurly },
    { target: "providers", label: "Provider 连接", icon: PlugsConnected },
    { target: "extensions", label: "扩展", icon: PuzzlePiece },
    { target: "import", label: "导入内容", icon: UploadSimple },
  ] as const;
  return (
    <header className="topbar">
      <div className="topbar__leading">
        <div className="topbar__brand" aria-label="SillyTavern N">
          <span className="brand-mark" aria-hidden="true">
            <ChatCircleDots size={19} weight="fill" />
          </span>
          <strong>SillyTavern N</strong>
        </div>
        <div className="topbar__conversation">
          <h1 title={title}>{title}</h1>
          <p>角色卡 · {cardName}</p>
        </div>
      </div>
      <nav className="topbar__actions" aria-label="工作区操作">
        <button
          className="topbar-button topbar-button--preset"
          type="button"
          aria-label={presetOpen ? "关闭预设设置" : "打开预设设置"}
          aria-expanded={presetOpen}
          onClick={onTogglePreset}
        >
          <SlidersHorizontal size={19} />
          <span>预设</span>
        </button>
        <button
          className="topbar-button"
          type="button"
          aria-label={navOpen ? "关闭角色卡选择" : "打开角色卡选择"}
          aria-expanded={navOpen}
          onClick={onToggleCards}
        >
          <Books size={19} />
          <span>角色卡</span>
        </button>
        <ActionPopover label="工作区设置" icon={<GearSix size={19} />}>
          {(close) => (
            <>
              <div className="action-popover__heading">内容与工作区</div>
              {settings.map(({ target, label, icon: Icon }) => (
                <button
                  type="button"
                  key={target}
                  onClick={() => {
                    close();
                    onOpenSettings(target);
                  }}
                >
                  <Icon size={19} />
                  <span>
                    {label}
                    {target === "personas" ? (
                      <small>{personaName}</small>
                    ) : null}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  close();
                  onOpenSecurity();
                }}
              >
                <LockKey size={19} />
                <span>账户与密码</span>
              </button>
            </>
          )}
        </ActionPopover>
        <div className="topbar__status">
          <SurfaceStatus tone={online ? "mint" : "slate"}>
            {online ? <CloudCheck size={14} /> : <CloudSlash size={14} />}
            {loading ? "正在连接" : online ? "服务在线" : "离线工作区"}
          </SurfaceStatus>
        </div>
      </nav>
    </header>
  );
}
