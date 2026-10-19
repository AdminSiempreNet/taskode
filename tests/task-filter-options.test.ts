import { test } from "node:test";
import assert from "node:assert/strict";
import { filterGroupValues, groupedFilterIds, taskFilterOptions } from "../src/lib/task-filter-options";
import { UNASSIGNED_FILTER } from "../src/lib/task-filters";

const option = (id: string, name: string, position = 0, projectId = "p") =>
  ({ id, name, position, projectId, color: "#64748b" });
const catalogs = {
  statuses: [{ ...option("pending", "Pendiente"), isDone: false }],
  labels: [option("z", "Zeta"), option("a", "Alfa"), option("foreign", "Ajena", 0, "other")],
  priorities: [option("high", "Alta", 2), option("low", "Baja", 0)],
  taskTypes: [option("type", "Requerimiento")],
  impacts: [option("impact", "Proyecto")],
  applications: [{ ...option("web", "Web"), isDefault: true }, { ...option("foreign", "Ajena", 0, "other"), isDefault: false }],
  people: [
    { id: "user", name: "Usuario", email: "user@example.com", image: null, projectId: "p" },
    { id: "foreign", name: "Otra persona", email: "other@example.com", image: null, projectId: "other" },
  ],
};

test("Sin etiqueta ocupa el primer lugar de Etiquetas y las opciones pertenecen al proyecto", () => {
  const options = taskFilterOptions(catalogs, "p");
  const labels = options.stateOptions.filter((entry) => entry.group === "Etiquetas");
  assert.deepEqual(labels.map((entry) => entry.name), ["Sin etiqueta", "Alfa", "Zeta"]);
  assert.equal(labels[0].id, `label:${UNASSIGNED_FILTER}`);
  assert.equal(options.userOptions.some((entry) => entry.id === "foreign"), false);
  assert.equal(options.stateOptions.some((entry) => entry.id === "label:foreign"), false);
  assert.deepEqual([...new Set(options.stateOptions.map((entry) => entry.group))], ["Estados", "Etiquetas"]);
});

test("la clasificación agrupa prioridades, tipos e impactos manteniendo el orden del catálogo", () => {
  const options = taskFilterOptions(catalogs, "p").classificationOptions;
  assert.deepEqual([...new Set(options.map((entry) => entry.group))], ["Prioridad", "Tipo", "Impacto", "Aplicaciones"]);
  assert.deepEqual(options.filter((entry) => entry.group === "Prioridad").map((entry) => entry.id), ["priority:low", "priority:high"]);
  assert.ok(options.some((entry) => entry.id === `type:${UNASSIGNED_FILTER}`));
  assert.ok(options.some((entry) => entry.id === `impact:${UNASSIGNED_FILTER}`));
  assert.deepEqual(options.filter(entry => entry.group === "Aplicaciones").map(entry => entry.id), [`application:${UNASSIGNED_FILTER}`, "application:web"]);
});

test("agrupar y separar las selecciones conserva IDs coincidentes y los que contienen dos puntos", () => {
  const selection = [
    ...groupedFilterIds(["same", "custom:priority"], "priority"),
    ...groupedFilterIds(["same", UNASSIGNED_FILTER], "type"),
    ...groupedFilterIds(["same"], "impact"),
  ];
  assert.deepEqual(filterGroupValues(selection, "priority"), ["same", "custom:priority"]);
  assert.deepEqual(filterGroupValues(selection, "type"), ["same", UNASSIGNED_FILTER]);
  assert.deepEqual(filterGroupValues(selection, "impact"), ["same"]);
  assert.deepEqual(filterGroupValues([], "label"), []);
});
