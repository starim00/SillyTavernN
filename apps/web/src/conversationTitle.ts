const padTimePart = (value: number): string => String(value).padStart(2, "0");

export function createConversationTitle(
  cardName: string,
  createdAt = new Date(),
): string {
  const date = `${createdAt.getFullYear()}-${padTimePart(
    createdAt.getMonth() + 1,
  )}-${padTimePart(createdAt.getDate())}`;
  const time = `${padTimePart(createdAt.getHours())}:${padTimePart(
    createdAt.getMinutes(),
  )}:${padTimePart(createdAt.getSeconds())}`;
  return `${cardName} · ${date} ${time}`;
}
