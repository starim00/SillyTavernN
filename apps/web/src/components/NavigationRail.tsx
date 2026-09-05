import {
  ArrowClockwise,
  Books,
  DotsThree,
  MagnifyingGlass,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useDeferredValue, useMemo, useState } from "react";

import type { RoleCard } from "../domain/workspace";
import { IconButton } from "./WorkspacePrimitives";
import { ActionPopover } from "./ActionPopover";

type NavigationRailProps = {
  open: boolean;
  cards: RoleCard[];
  selectedCardId: string;
  onSelectCard: (id: string) => void;
  onCreateConversation: (cardId: string) => void;
  onUpdateCard: (card: RoleCard) => void;
  onDeleteCard: (card: RoleCard) => void;
  onClose: () => void;
};

export function NavigationRail({
  open,
  cards,
  selectedCardId,
  onSelectCard,
  onCreateConversation,
  onUpdateCard,
  onDeleteCard,
  onClose,
}: NavigationRailProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const filteredCards = useMemo(
    () =>
      cards.filter((card) => {
        if (!deferredQuery) return true;
        return `${card.name} ${card.description}`
          .toLocaleLowerCase()
          .includes(deferredQuery);
      }),
    [cards, deferredQuery],
  );

  return (
    <aside
      className={`navigation-rail${open ? " navigation-rail--open" : ""}`}
      aria-label="角色卡选择"
    >
      <div className="rail-title">
        <div>
          <strong>角色卡</strong>
          <span>选择角色卡进入它的聊天空间</span>
        </div>
        <IconButton
          label="关闭角色卡选择"
          icon={<X size={18} />}
          onClick={onClose}
          compact
        />
      </div>

      <label className="rail-search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <span className="sr-only">搜索角色卡</span>
        <input
          type="search"
          value={query}
          placeholder="搜索角色卡"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="world-list">
        {filteredCards.map((card) => {
          const selected = card.id === selectedCardId;
          return (
            <div
              className={`character-row${selected ? " is-selected" : ""}`}
              key={card.id}
            >
              <button
                type="button"
                className="world-row"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelectCard(card.id)}
              >
                {card.imageUrl ? (
                  <img
                    className="world-row__cover"
                    src={card.imageUrl}
                    alt=""
                  />
                ) : (
                  <span className="world-row__icon">
                    <Books size={18} />
                  </span>
                )}
                <span>
                  <strong>{card.name}</strong>
                  <small>{card.description || "已导入的角色卡"}</small>
                </span>
                <span className="world-row__count">
                  {card.conversationCount}
                </span>
              </button>
              {selected ? (
                <div className="character-row__actions">
                  <button
                    type="button"
                    className="topbar-button"
                    aria-label={`在 ${card.name} 下新建对话`}
                    onClick={() => onCreateConversation(card.id)}
                  >
                    <Plus size={16} />
                    <span>新建对话</span>
                  </button>
                  <ActionPopover label="更多" icon={<DotsThree size={19} />}>
                    {(close) => (
                      <>
                        <button
                          type="button"
                          aria-label={`更新角色卡 ${card.name}`}
                          onClick={() => {
                            close();
                            onUpdateCard(card);
                          }}
                        >
                          <ArrowClockwise size={17} />
                          <span>更新角色卡</span>
                        </button>
                        <button
                          type="button"
                          className="action-popover__danger"
                          aria-label={`删除角色卡 ${card.name}`}
                          onClick={() => {
                            close();
                            onDeleteCard(card);
                          }}
                        >
                          <Trash size={17} />
                          <span>删除角色卡</span>
                        </button>
                      </>
                    )}
                  </ActionPopover>
                </div>
              ) : null}
            </div>
          );
        })}
        {filteredCards.length === 0 ? (
          <div className="rail-empty">
            <Books size={24} />
            <strong>
              {query.trim() ? "没有匹配的角色卡" : "还没有角色卡"}
            </strong>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
