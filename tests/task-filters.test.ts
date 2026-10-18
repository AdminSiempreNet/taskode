import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesTaskFilters, MINE_FILTER, UNASSIGNED_FILTER } from "../src/lib/task-filters";

const task = {
  leaderId: "leader",
  teamMemberIds: ["member"],
  statusId: "pending",
  priority: "high",
  typeId: "requirement",
  impactId: "project",
  labels: ["Ejemplo", "Seguridad"],
};
const all = { statusIds: [], typeIds: [], impactIds: [] };

test("los filtros de la lista combinan usuario, estado, etiquetas, prioridad, tipo e impacto", () => {
  const filters = {
    userIds: [MINE_FILTER],
    currentUserId: "member",
    statusIds: ["review", "pending"],
    labelNames: ["Frontend", "Seguridad"],
    priorityIds: ["medium", "high"],
    typeIds: ["requirement"],
    impactIds: ["project"],
  };
  assert.equal(matchesTaskFilters(task, filters), true);
  for (const override of [
    { userIds: ["other"] },
    { statusIds: ["done"] },
    { labelNames: ["Frontend"] },
    { priorityIds: ["low"] },
    { typeIds: ["bug"] },
    { impactIds: ["client"] },
  ]) assert.equal(matchesTaskFilters(task, { ...filters, ...override }), false);
});

test("seleccionar estado y etiqueta exige ambas condiciones aunque compartan combobox", () => {
  const filters = { ...all, statusIds: ["pending"], labelNames: ["Seguridad"] };
  assert.equal(matchesTaskFilters(task, filters), true);
  assert.equal(matchesTaskFilters({ ...task, statusId: "done" }, filters), false);
  assert.equal(matchesTaskFilters({ ...task, labels: ["Frontend"] }, filters), false);
});

test("Sin etiquetas admite tareas vacías y se puede combinar con etiquetas concretas", () => {
  const filters = { ...all, includeUnlabeled: true };
  const unlabeled = { ...task, labels: [] };
  assert.equal(matchesTaskFilters(unlabeled, filters), true);
  assert.equal(matchesTaskFilters(task, filters), false);
  const mixed = { ...filters, labelNames: ["Seguridad"] };
  assert.equal(matchesTaskFilters(task, mixed), true);
  assert.equal(matchesTaskFilters(unlabeled, mixed), true);
  assert.equal(matchesTaskFilters({ ...task, labels: ["Frontend"] }, mixed), false);
});

test("las prioridades respetan tipos e impactos opcionales y limpiar muestra todas las tareas", () => {
  const unclassified = { ...task, typeId: null, impactId: null, labels: [] };
  assert.equal(matchesTaskFilters(unclassified, {
    ...all, priorityIds: ["high"], typeIds: [UNASSIGNED_FILTER], impactIds: [UNASSIGNED_FILTER],
  }), true);
  assert.equal(matchesTaskFilters(unclassified, { ...all, priorityIds: ["low"] }), false);
  assert.equal(matchesTaskFilters(task, all), true);
  assert.equal(matchesTaskFilters(unclassified, all), true);
  assert.equal(matchesTaskFilters(task, { ...all, priorityIds: [], labelNames: [], includeUnlabeled: false }), true);
});
