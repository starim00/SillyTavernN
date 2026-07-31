import { Books, MagnifyingGlass, Plus, Trash, X } from "@phosphor-icons/react";
import { useDeferredValue, useMemo, useState } from "react";

import type { RoleCard } from "../domain/workspace";
import { IconButton } from "./WorkspacePrimitives";

type NavigationRailProps = {
  open: boolean;
  cards: RoleCard[];
  selectedCardId: string;
  onSelectCard: (id: string) => void;
  onCreateConversation: (cardId: string) => void;
  onDeleteCard: (card: RoleCard) => void;
  onOpenLibrary: () => void;
  onClose: () => void;
};

export function NavigationRail({
  open,
  cards,
  selectedCardId,
  onSelectCard,
  onCreateConversation,
  onDeleteCard,
  onOpenLibrary,
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
      <div className="navigation-rail__mobile-header">
        <strong>角色卡</strong>
        <IconButton
          label="关闭角色卡选择"
          icon={<X size={19} />}
          onClick={onClose}
          compact
        />
      </div>

      <div className="rail-title">
        <div>
          <strong>角色卡</strong>
          <span>选择角色卡进入它的聊天空间</span>
        </div>
        <IconButton
          label="打开角色卡管理"
          icon={<Books size={18} />}
          onClick={onOpenLibrary}
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
                <>
                  <IconButton
                    compact
                    className="character-row__new"
                    label={`在 ${card.name} 下新建对话`}
                    icon={<Plus size={15} />}
                    onClick={() => onCreateConversation(card.id)}
                  />
                  <IconButton
                    compact
                    className="character-row__delete"
                    label={`删除角色卡 ${card.name}`}
                    icon={<Trash size={15} />}
                    onClick={() => onDeleteCard(card)}
                  />
                </>
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
