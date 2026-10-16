import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardDropTarget,
  type DropColumn,
  type DropCard,
} from "../src/lib/board-drop";

const viewport = { left: 240, right: 1000, top: 60, bottom: 800 };
const columns: DropColumn[] = [
  {
    id: "a",
    rect: { left: 240, right: 520, top: 60, bottom: 800 },
    listRect: { left: 240, right: 520, top: 110, bottom: 760 },
  },
  {
    id: "b",
    rect: { left: 532, right: 812, top: 60, bottom: 800 },
    listRect: { left: 532, right: 812, top: 110, bottom: 760 },
  },
  {
    id: "c",
    rect: { left: 824, right: 1104, top: 60, bottom: 800 },
    listRect: { left: 824, right: 1104, top: 110, bottom: 760 },
  },
];
const cards: DropCard[] = [
  {
    id: "a1",
    columnId: "a",
    rect: { left: 250, right: 510, top: 120, bottom: 280 },
  },
  {
    id: "b1",
    columnId: "b",
    rect: { left: 542, right: 802, top: 120, bottom: 420 },
  },
  {
    id: "b2",
    columnId: "b",
    rect: { left: 542, right: 802, top: 432, bottom: 550 },
  },
];

test("el puntero elige la columna aunque la tarjeta arrastrada se extienda hacia la adyacente", () => {
  assert.deepEqual(
    boardDropTarget({ x: 535, y: 150 }, columns, cards, viewport),
    { columnId: "b", taskId: "b1", after: false },
  );
  assert.deepEqual(
    boardDropTarget({ x: 810, y: 500 }, columns, cards, viewport),
    { columnId: "b", taskId: "b2", after: true },
  );
  assert.deepEqual(
    boardDropTarget({ x: 830, y: 150 }, columns, cards, viewport),
    { columnId: "c", taskId: null, after: false },
  );
});

test("soltar en un hueco entre columnas o fuera del tablero cancela sin elegir una columna vecina", () => {
  for (const point of [
    { x: 526, y: 200 },
    { x: 238, y: 200 },
    { x: 1001, y: 200 },
    { x: 600, y: 801 },
  ])
    assert.equal(boardDropTarget(point, columns, cards, viewport), null);
});

test("la mitad de la tarjeta bajo el puntero decide si se inserta antes o después", () => {
  assert.equal(
    boardDropTarget({ x: 650, y: 150 }, columns, cards, viewport)?.after,
    false,
  );
  assert.equal(
    boardDropTarget({ x: 650, y: 390 }, columns, cards, viewport)?.after,
    true,
  );
  assert.deepEqual(
    boardDropTarget({ x: 650, y: 426 }, columns, cards, viewport),
    { columnId: "b", taskId: "b2", after: false },
  );
});

test("las tarjetas ocultas por el scroll no interceptan el drop y la cabecera sigue siendo un destino", () => {
  const hidden = {
    id: "hidden",
    columnId: "b",
    rect: { left: 542, right: 802, top: 30, bottom: 105 },
  };
  assert.deepEqual(
    boardDropTarget({ x: 650, y: 112 }, columns, [hidden, ...cards], viewport),
    { columnId: "b", taskId: "b1", after: false },
  );
  assert.deepEqual(
    boardDropTarget({ x: 650, y: 80 }, columns, [hidden, ...cards], viewport),
    { columnId: "b", taskId: null, after: false },
  );
  const offscreen = [
    { ...columns[0], rect: { left: 0, right: 280, top: 60, bottom: 800 } },
  ];
  assert.equal(
    boardDropTarget({ x: 100, y: 150 }, offscreen, cards, viewport),
    null,
  );
});
