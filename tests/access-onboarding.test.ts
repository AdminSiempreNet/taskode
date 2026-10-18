import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { actor, createRepository, addUser, authConfig } from "./helpers";
import {
  installation,
  invitations,
  projectMembers,
} from "../src/server/schema";
import { InvitationService } from "../src/server/invitations";
import { createFirstProject, finishOnboarding } from "../src/server/onboarding";
import type { Command } from "../src/lib/validation";
const fields = {
  name: "Aplicación web",
  description: "",
  icon: "🌐",
  color: "#059669",
};

test("permisos: proyectos privados, participación, administración global y transferencia exclusiva del administrador", async () => {
  const repo = await createRepository();
  try {
    const owner = await addUser(repo, "owner"),
      member = await addUser(repo, "member"),
      stranger = await addUser(repo, "stranger");
    const { createdId: id } = await repo.execute(
      { type: "project.create", ...fields },
      owner,
    );
    const p = id!,
      w = await repo.getWorkspace(owner),
      featureId = w.features[0].id,
      statusId = w.statuses[0].id;
    assert.equal(w.projects[0].ownerId, owner.id);
    assert.equal((await repo.getWorkspace(member)).projects.length, 0);
    assert.equal((await repo.getWorkspace(actor)).projects.length, 1);
    await repo.execute(
      { type: "project.member.add", projectId: p, userId: member.id },
      owner,
    );
    const { createdId: taskId } = await repo.execute(
      {
        type: "task.create",
        projectId: p,
        featureId,
        statusId,
        title: "Compartida",
        description: "",
        priority: "medium",
        dueDate: null,
        labels: [],
      },
      member,
    );
    const { createdId: moduleId } = await repo.execute(
      {
        type: "module.create",
        projectId: p,
        name: "Interfaz",
        description: "",
      },
      member,
    );
    const { createdId: listId } = await repo.execute(
      { type: "checklist.create", taskId: taskId!, title: "Entrega" },
      member,
    );
    const { createdId: itemId } = await repo.execute(
      { type: "checklist.item.create", checklistId: listId!, title: "Revisar" },
      member,
    );
    const { createdId: commentId } = await repo.execute(
      { type: "comment.create", taskId: taskId!, content: "Comentario" },
      member,
    );
    const attacks: Command[] = [
      { type: "project.update", id: p, ...fields },
      { type: "project.delete", id: p },
      { type: "module.create", projectId: p, name: "Ajeno", description: "" },
      { type: "module.update", id: moduleId!, name: "Ajeno", description: "" },
      { type: "module.delete", id: moduleId! },
      { type: "module.reorder", projectId: p, ids: [moduleId!] },
      { type: "feature.create", projectId: p, name: "Ajena", description: "" },
      { type: "feature.update", id: featureId, name: "Ajena", description: "" },
      { type: "feature.delete", id: featureId },
      { type: "feature.pin", id: featureId, pinned: true },
      { type: "feature.reorder", projectId: p, ids: [featureId] },
      { type: "task.rename", id: taskId!, title: "Ajena" },
      { type: "task.archive", id: taskId!, archived: true },
      { type: "task.delete", id: taskId! },
      { type: "task.move", id: taskId!, statusId, beforeId: null },
      {
        type: "status.create",
        projectId: p,
        name: "Ajeno",
        color: "#059669",
        isDone: false,
      },
      {
        type: "status.update",
        id: statusId,
        name: "Ajeno",
        color: "#059669",
        isDone: false,
      },
      { type: "status.delete", id: statusId },
      {
        type: "status.reorder",
        projectId: p,
        ids: w.statuses.map((s) => s.id),
      },
      {
        type: "priority.update",
        projectId: p,
        id: "medium",
        name: "Ajena",
        color: "#059669",
      },
      { type: "label.create", projectId: p, name: "Ajena", color: "#059669" },
      { type: "checklist.create", taskId: taskId!, title: "Ajeno" },
      { type: "checklist.update", id: listId!, title: "Ajeno" },
      { type: "checklist.delete", id: listId! },
      { type: "checklist.item.create", checklistId: listId!, title: "Ajeno" },
      {
        type: "checklist.item.update",
        id: itemId!,
        title: "Ajeno",
        completed: true,
      },
      { type: "checklist.item.delete", id: itemId! },
      { type: "comment.create", taskId: taskId!, content: "Ajeno" },
      { type: "comment.update", id: commentId!, content: "Ajeno" },
      { type: "comment.delete", id: commentId! },
      {
        type: "trello.import",
        projectId: p,
        board: { name: "Ajeno", lists: [], cards: [] },
      },
    ];
    for (const command of attacks)
      await assert.rejects(
        repo.execute(command, stranger),
        (e: unknown) => (e as { status: number }).status === 404,
        command.type,
      );
    await assert.rejects(
      repo.execute(
        { type: "project.member.add", projectId: p, userId: stranger.id },
        member,
      ),
      { status: 403 },
    );
    await assert.rejects(
      repo.execute({ type: "project.update", id: p, ...fields }, member),
      { status: 403 },
    );
    await assert.rejects(
      repo.execute(
        { type: "project.transferOwnership", id: p, userId: member.id },
        owner,
      ),
      { status: 403 },
    );
    await repo.execute(
      { type: "project.transferOwnership", id: p, userId: stranger.id },
      actor,
    );
    assert.equal(
      (await repo.getWorkspace(stranger)).projects[0].ownerId,
      stranger.id,
    );
    assert.equal((await repo.getWorkspace(owner)).projects.length, 1);
    await assert.rejects(
      repo.execute({ type: "project.update", id: p, ...fields }, owner),
      { status: 403 },
    );
    await assert.rejects(repo.execute({ type: "project.member.remove", projectId: p, userId: member.id }, stranger), { status: 409 });
    await repo.execute({ type: "task.assignment.update", id: taskId!, leaderId: stranger.id, teamMemberIds: [] }, stranger);
    await repo.execute({ type: "module.transferOwnership", id: moduleId!, userId: stranger.id }, stranger);
    await repo.execute(
      { type: "project.member.remove", projectId: p, userId: member.id },
      stranger,
    );
    assert.equal((await repo.getWorkspace(member)).tasks.length, 0);
    await assert.rejects(
      repo.execute(
        { type: "task.rename", id: taskId!, title: "Sin permiso" },
        member,
      ),
      { status: 404 },
    );
    await assert.rejects(repo.getWorkspace({ id: "missing" }), { status: 401 });
  } finally {
    await repo.close();
  }
});

test("invitaciones: envío fallido conserva enlace, correo verificado, caducidad, revocación y consumo único", async () => {
  const repo = await createRepository();
  try {
    const member = await addUser(repo, "invited"),
      other = await addUser(repo, "other");
    const { createdId: p } = await repo.execute(
      { type: "project.create", ...fields },
      actor,
    );
    const service = new InvitationService(
      repo,
      authConfig.BETTER_AUTH_SECRET,
      authConfig.BETTER_AUTH_URL,
      async () => {
        throw new Error("Resend no disponible");
      },
    );
    await assert.rejects(service.create({ email: "x@example.com" }, other), {
      status: 403,
    });
    const result = await service.create(
        { email: " invited@example.com ", projectIds: [p] },
        actor,
      ),
      token = new URL(result.invitation.url).pathname.split("/").pop()!;
    assert.match(result.deliveryError!, /Resend/);
    assert.equal(result.invitation.deliveryStatus, "failed");
    assert.equal((await service.list(actor))[0].url, result.invitation.url);
    await assert.rejects(service.verify(token, "other@example.com"), {
      status: 403,
    });
    await assert.rejects(service.verify(`${token}x`));
    await repo.store.transaction(() =>
      service.consume(token, member.id, "invited@example.com"),
    );
    assert.equal((await repo.getWorkspace(member)).projects.length, 1);
    await assert.rejects(service.verify(token));
    assert.equal((await repo.store.db.select().from(projectMembers)).length, 1);
    const next = await service.create({ email: "other@example.com" }, actor),
      nextToken = new URL(next.invitation.url).pathname.split("/").pop()!;
    await service.revoke(next.invitation.id, actor);
    await assert.rejects(service.verify(nextToken));
    const resent = await service.resend(next.invitation.id, actor);
    assert.notEqual(resent.invitation.url, next.invitation.url);
    const [expired] = await repo.store.db
      .update(invitations)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(invitations.id, resent.invitation.id))
      .returning();
    await assert.rejects(service.verify(service.token(expired)));
  } finally {
    await repo.close();
  }
});

test("asistente: creación idempotente, ejemplos web opcionales y finalización persistente", async () => {
  const repo = await createRepository();
  try {
    await repo.store.db
      .update(installation)
      .set({ onboardingStep: 0, firstProjectId: null })
      .where(eq(installation.id, 1));
    const member = await addUser(repo, "member");
    await assert.rejects(createFirstProject(repo, member, fields, true), {
      status: 403,
    });
    const [a, b] = await Promise.all([
      createFirstProject(repo, actor, fields, true),
      createFirstProject(repo, actor, fields, true),
    ]);
    assert.equal(a.projectId, b.projectId);
    const w = await repo.getWorkspace(actor);
    assert.equal(w.projects.length, 1);
    assert.equal(w.modules.length, 3);
    assert.ok(w.tasks.length >= 10);
    assert.ok(w.tasks.every((t) => t.labels.includes("Ejemplo")));
    assert.ok(w.tasks.some((t) => t.checklists.length));
    assert.equal(w.onboarding.step, 1);
    assert.equal(
      (
        await repo.store.db
          .select()
          .from((await import("../src/server/schema")).user)
      ).length,
      2,
    );
    await finishOnboarding(repo, actor);
    await repo.execute({ type: "project.delete", id: a.projectId! }, actor);
    assert.equal((await repo.getWorkspace(actor)).onboarding.step, 2);
    await repo.store.db
      .update(installation)
      .set({ onboardingStep: 0, firstProjectId: null })
      .where(eq(installation.id, 1));
    await createFirstProject(repo, actor, fields, false);
    assert.equal((await repo.getWorkspace(actor)).tasks.length, 0);
  } finally {
    await repo.close();
  }
});
