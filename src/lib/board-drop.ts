export type DropRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export type DropPoint = { x: number; y: number };
export type DropColumn = { id: string; rect: DropRect; listRect: DropRect };
export type DropCard = { id: string; columnId: string; rect: DropRect };
export type BoardDropTarget = {
  columnId: string;
  taskId: string | null;
  after: boolean;
};

function contains(rect: DropRect, point: DropPoint) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

// The pointer chooses the column; the dragged card's size and grab offset must
// never make an adjacent column win. Hidden cards cannot intercept a drop.
export function boardDropTarget(
  point: DropPoint,
  columns: DropColumn[],
  cards: DropCard[],
  viewport: DropRect,
): BoardDropTarget | null {
  if (!contains(viewport, point)) return null;
  const column = columns.find((candidate) => contains(candidate.rect, point));
  if (!column) return null;
  if (!contains(column.listRect, point))
    return { columnId: column.id, taskId: null, after: false };
  const visible = cards.filter(
    (card) =>
      card.columnId === column.id &&
      card.rect.bottom > column.listRect.top &&
      card.rect.top < column.listRect.bottom,
  );
  const direct = visible.find((card) => contains(card.rect, point));
  const target =
    direct ??
    visible.reduce<DropCard | null>((nearest, card) => {
      const distance = (item: DropCard) =>
        Math.abs(point.y - (item.rect.top + item.rect.bottom) / 2);
      return !nearest || distance(card) < distance(nearest) ? card : nearest;
    }, null);
  return {
    columnId: column.id,
    taskId: target?.id ?? null,
    after: target
      ? point.y > (target.rect.top + target.rect.bottom) / 2
      : false,
  };
}
