import { Books, MagnifyingGlass, UploadSimple } from "@phosphor-icons/react";
import { useDeferredValue, useState, type ReactNode } from "react";

import type { RoleCard } from "../domain/workspace";

type CardConversationEntryProps = {
  cards: RoleCard[];
  onSelectCard: (id: string) => void;
  onImport: () => void;
  notice?: ReactNode;
};

export function CardConversationEntry({
  cards,
  onSelectCard,
  onImport,
  notice,
}: CardConversationEntryProps) {
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const filteredCards = cards.filter((card) =>
    `${card.name} ${card.description}`.toLocaleLowerCase().includes(search),
  );
  return (
    <main className="card-entry" aria-labelledby="card-entry-title">
      {notice}
      <div className="card-entry__intro">
        <span className="card-entry__icon" aria-hidden="true">
          <Books size={28} />
        </span>
        <div>
          <h1 id="card-entry-title">选择角色卡</h1>
          <p>选择后会直接进入这张角色卡最近使用的对话。</p>
        </div>
        <button
          className="button button--quiet"
          type="button"
          onClick={onImport}
        >
          <UploadSimple size={17} />
          导入角色卡
        </button>
      </div>

      {cards.length > 0 ? (
        <label className="rail-search card-entry__search">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <span className="sr-only">搜索角色卡</span>
          <input
            type="search"
            placeholder="搜索角色卡"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}
      {cards.length > 0 ? (
        <div className="card-entry__grid">
          {filteredCards.map((card) => (
            <button
              className="card-entry-item"
              type="button"
              key={card.id}
              onClick={() => onSelectCard(card.id)}
            >
              {card.imageUrl ? (
                <img src={card.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="card-entry-item__placeholder">
                  <Books size={25} />
                </span>
              )}
              <span className="card-entry-item__body">
                <strong>{card.name}</strong>
                <span>{card.description || "已导入的角色卡"}</span>
                <small>{card.conversationCount} 个历史对话</small>
              </span>
            </button>
          ))}
          {filteredCards.length === 0 ? (
            <p role="status">没有匹配的角色卡，请尝试其他关键词。</p>
          ) : null}
        </div>
      ) : (
        <div className="card-entry__empty">
          <Books size={30} />
          <h2>还没有角色卡</h2>
          <p>导入一张角色卡后，就可以在卡下创建和管理对话。</p>
          <button
            className="button button--primary"
            type="button"
            onClick={onImport}
          >
            <UploadSimple size={17} />
            导入角色卡
          </button>
        </div>
      )}
    </main>
  );
}
