import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readSidebarTasksOnly,
  saveSidebarTasksOnly,
  setSidebarGroups,
  sidebarVisibility,
} from "../src/lib/sidebar-visibility";

const groups = [
  { id: "general", name: "General", description: "Features sin módulo" },
  { id: "m1", name: "Tareas", description: "" },
  { id: "m2", name: "Storage", description: "Archivos" },
];
const features = [
  { id: "f1", number: 1, name: "Inicio", description: "", moduleId: null },
  {
    id: "f2",
    number: 1,
    name: "Vista de lista",
    description: "",
    moduleId: "m1",
  },
  { id: "f3", number: 2, name: "Atributos", description: "", moduleId: "m1" },
  { id: "f4", number: 1, name: "Subidas", description: "", moduleId: "m2" },
];
const counts = { f1: 0, f2: 3, f3: 0, f4: 0 };
const visibility = (
  overrides: Partial<Parameters<typeof sidebarVisibility>[0]>,
) =>
  sidebarVisibility({
    groups,
    features,
    query: "",
    counts,
    onlyWithTasks: false,
    selectedId: "all",
    ...overrides,
  });
const shown = (result: ReturnType<typeof visibility>) =>
  result.groups.map((group) => [group.id, group.items.map((item) => item.id)]);

test("el sidebar muestra todos los módulos sin filtros", () => {
  const result = visibility({});
  assert.equal(result.searching, false);
  assert.deepEqual(shown(result), [
    ["general", ["f1"]],
    ["m1", ["f2", "f3"]],
    ["m2", ["f4"]],
  ]);
  assert.deepEqual(
    result.groups.map((group) => group.total),
    [1, 2, 1],
  );
});

test("solo con tareas oculta features y módulos sin tareas", () => {
  const result = visibility({ onlyWithTasks: true });
  assert.deepEqual(shown(result), [["m1", ["f2"]]]);
  assert.equal(result.groups[0].total, 1);
  assert.equal(result.matches(features[2]), false);
});

test("solo con tareas conserva la feature seleccionada aunque no tenga tareas", () => {
  const result = visibility({ onlyWithTasks: true, selectedId: "f4" });
  assert.deepEqual(shown(result), [
    ["m1", ["f2"]],
    ["m2", ["f4"]],
  ]);
});

test("solo con tareas se combina con la búsqueda", () => {
  assert.deepEqual(shown(visibility({ query: "storage" })), [["m2", ["f4"]]]);
  assert.deepEqual(
    shown(visibility({ query: "storage", onlyWithTasks: true })),
    [],
  );
  assert.deepEqual(shown(visibility({ query: "VISTA", onlyWithTasks: true })), [
    ["m1", ["f2"]],
  ]);
  assert.equal(visibility({ query: "  " }).searching, false);
});

test("expandir y contraer todo solo toca los módulos indicados", () => {
  const current = new Set(["general", "oculto"]);
  assert.deepEqual(
    [...setSidebarGroups(current, ["m1", "m2"], true)],
    ["general", "oculto", "m1", "m2"],
  );
  assert.deepEqual(
    [...setSidebarGroups(current, ["general", "m1"], false)],
    ["oculto"],
  );
  assert.deepEqual([...current], ["general", "oculto"]);
});

test("la preferencia de solo con tareas se recuerda por usuario", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(readSidebarTasksOnly("u", storage), false);
  saveSidebarTasksOnly("u", true, storage);
  assert.equal(readSidebarTasksOnly("u", storage), true);
  assert.equal(readSidebarTasksOnly("otro", storage), false);
  saveSidebarTasksOnly("u", false, storage);
  assert.equal(readSidebarTasksOnly("u", storage), false);
});

test("la preferencia de solo con tareas tolera almacenamiento bloqueado", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  saveSidebarTasksOnly("bloqueado", true, blocked);
  assert.equal(readSidebarTasksOnly("bloqueado", blocked), true);
});
