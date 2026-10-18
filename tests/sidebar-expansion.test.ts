import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readSidebarExpansion,
  saveSidebarExpansion,
} from "../src/lib/sidebar-expansion";

test("el sidebar conserva expansiones del proyecto actual y las reinicia al cambiar", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.deepEqual([...readSidebarExpansion("u", "p1", storage)], []);
  saveSidebarExpansion("u", "p1", new Set(["general", "m1"]), storage);
  assert.deepEqual(
    [...readSidebarExpansion("u", "p1", storage)],
    ["general", "m1"],
  );
  assert.deepEqual([...readSidebarExpansion("other", "p1", storage)], []);
  assert.deepEqual([...readSidebarExpansion("u", "p2", storage)], []);
  assert.deepEqual([...readSidebarExpansion("u", "p1", storage)], []);
});

test("el sidebar tolera almacenamiento inválido o bloqueado", () => {
  const invalid = {
    getItem: () => "{",
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual([...readSidebarExpansion("blocked", "p", invalid)], []);
  saveSidebarExpansion("blocked", "p", new Set(["m"]), invalid);
  assert.deepEqual([...readSidebarExpansion("blocked", "p", invalid)], ["m"]);
  assert.deepEqual(
    [...readSidebarExpansion("blocked", "another", invalid)],
    [],
  );
});
