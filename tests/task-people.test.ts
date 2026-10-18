import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TaskAssignments,
  TaskPeopleFields,
} from "../src/components/task-people";

test("la asignación muestra Líder y Equipo, permite buscar correos y limita la cabecera a tres miembros", () => {
  const people = ["leader", "one", "two", "three", "four"].map((id) => ({
    id,
    name: id,
    projectId: "project",
    email: `${id}@example.com`,
    image: null,
  }));
  const selection = {
    people,
    leaderId: "leader",
    teamMemberIds: people.slice(1).map((person) => person.id),
  };
  const header = renderToStaticMarkup(
    createElement(TaskAssignments, {
      ...selection,
      onSave: async () => true,
      busy: false,
      canManage: true,
    }),
  );
  assert.match(header, /aria-label="Líder: leader"/);
  assert.match(header, /aria-label="Equipo: 4"/);
  assert.equal(
    (header.match(/aria-label="Miembro del equipo:/g) ?? []).length,
    3,
  );
  const fields = renderToStaticMarkup(
    createElement(TaskPeopleFields, {
      ...selection,
      onLeader() {},
      onTeamMembers() {},
    }),
  );
  assert.match(fields, /aria-label="Líder"/);
  assert.match(fields, /aria-label="Equipo"/);
  for (const person of people) assert.ok(fields.includes(person.email));
  assert.doesNotMatch(fields + header, /Responsable|Colaboradores/);
});
