import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { documents } from "./schema";
import type { PostgresRepository } from "./postgres";
import type { Actor, EntityKind, EntityRef, Feature, Task } from "../lib/types";
import { entityColumns, rowScope, sameEntity } from "../lib/entities";
import {
  documentInputSchema,
  type DocumentDetail,
  type DocumentDiagramOption,
} from "../lib/documents";
import { DomainError } from "./repository";
import { DiagramsService } from "./diagrams";

function input(value: unknown) {
  const parsed = documentInputSchema.safeParse(value);
  if (!parsed.success)
    throw new DomainError(
      "Revisa el título, la descripción y el contenido del documento.",
    );
  return parsed.data;
}
export class DocumentsService {
  constructor(private repo: PostgresRepository) {}
  private async target(actor: Actor, id: string) {
    const [row] = await this.repo.store.db
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    if (!row)
      throw new DomainError("El documento no existe o no tienes acceso.", 404);
    const scope = rowScope(row)!;
    const { permissions } = await this.repo.requireEntity(
      actor,
      scope.kind,
      scope.id,
      scope.projectId,
    );
    return { row, scope, permissions };
  }
  async list(actor: Actor, kind: EntityKind, id: string) {
    return this.repo.store.snapshot(async () => {
      const { scope, permissions } = await this.repo.requireEntity(
        actor,
        kind,
        id,
      );
      const columns = entityColumns(scope);
      const rows = await this.repo.store.db
        .select({
          id: documents.id,
          title: documents.title,
          description: documents.description,
          revision: documents.revision,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(
          and(
            eq(documents.projectId, scope.projectId),
            eq(documents.scopeType, kind),
            kind === "task"
              ? eq(documents.taskId, columns.taskId!)
              : kind === "feature"
                ? eq(documents.featureId, columns.featureId!)
                : kind === "module"
                  ? eq(documents.moduleId, columns.moduleId!)
                  : undefined,
          ),
        )
        .orderBy(desc(documents.updatedAt), documents.id);
      return { documents: rows, permissions };
    });
  }
  async get(actor: Actor, id: string): Promise<DocumentDetail> {
    return this.repo.store.snapshot(async () => {
      const { row, scope, permissions } = await this.target(actor, id);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        content: row.content,
        revision: row.revision,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        scope,
        permissions,
      };
    });
  }
  async create(
    actor: Actor,
    kind: EntityKind,
    entityId: string,
    value: unknown,
  ) {
    const data = input(value);
    return this.repo.store.transaction(async () => {
      const { scope, permissions } = await this.repo.requireEntity(
        actor,
        kind,
        entityId,
      );
      if (!permissions.canEdit)
        throw new DomainError(
          "No puedes crear documentos en este elemento.",
          403,
        );
      await this.repo.bindContentFiles(
        data.content,
        actor,
        scope.projectId,
        scope,
      );
      const id = randomUUID(),
        now = new Date().toISOString();
      await this.repo.store.db
        .insert(documents)
        .values({
          id,
          ...entityColumns(scope),
          ...data,
          createdAt: now,
          updatedAt: now,
        });
      return this.get(actor, id);
    });
  }
  async save(actor: Actor, id: string, revision: number, value: unknown) {
    const data = input(value);
    return this.repo.store.transaction(async () => {
      const { scope, permissions } = await this.target(actor, id);
      if (!permissions.canEdit)
        throw new DomainError("No puedes editar este documento.", 403);
      const result = await this.repo.store.db
        .update(documents)
        .set({
          ...data,
          revision: revision + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(documents.id, id), eq(documents.revision, revision)))
        .returning({ id: documents.id });
      if (!result.length)
        throw new DomainError(
          "El documento cambió en otra pestaña. Tu borrador sigue aquí; recarga la versión guardada para continuar.",
          409,
        );
      await this.repo.bindContentFiles(
        data.content,
        actor,
        scope.projectId,
        scope,
      );
      return this.get(actor, id);
    });
  }
  async remove(actor: Actor, id: string) {
    return this.repo.store.transaction(async () => {
      const { permissions } = await this.target(actor, id);
      if (!permissions.canEdit)
        throw new DomainError("No puedes eliminar este documento.", 403);
      await this.repo.store.db.delete(documents).where(eq(documents.id, id));
    });
  }
  private async lineage(actor: Actor, kind: EntityKind, id: string) {
    const detail = await this.repo.requireEntity(actor, kind, id);
    const scopes: EntityRef[] = [detail.scope];
    if (kind === "task") {
      const task = detail.entity as unknown as Task;
      const feature = await this.repo.requireEntity(
        actor,
        "feature",
        task.featureId,
        detail.scope.projectId,
      );
      scopes.push(feature.scope);
      if ((feature.entity as unknown as Feature).moduleId)
        scopes.push({
          kind: "module",
          id: (feature.entity as unknown as Feature).moduleId!,
          projectId: detail.scope.projectId,
        });
    } else if (kind === "feature" && detail.entity.moduleId) {
      scopes.push({
        kind: "module",
        id: String(detail.entity.moduleId),
        projectId: detail.scope.projectId,
      });
    }
    if (kind !== "project")
      scopes.push({
        kind: "project",
        id: detail.scope.projectId,
        projectId: detail.scope.projectId,
      });
    return scopes;
  }
  async diagramOptions(actor: Actor, kind: EntityKind, id: string) {
    return this.repo.store.snapshot(async () => {
      const scopes = await this.lineage(actor, kind, id),
        service = new DiagramsService(this.repo);
      const diagrams: DocumentDiagramOption[] = [];
      for (const scope of scopes) {
        const result = await service.list(actor, scope.kind, scope.id);
        diagrams.push(
          ...result.diagrams.map((diagram) => ({ ...diagram, scope })),
        );
      }
      return { diagrams };
    });
  }
  async diagram(actor: Actor, kind: EntityKind, id: string, diagramId: string) {
    return this.repo.store.snapshot(async () => {
      const scopes = await this.lineage(actor, kind, id);
      const diagram = await new DiagramsService(this.repo).get(
        actor,
        diagramId,
      );
      if (!scopes.some((scope) => sameEntity(scope, diagram.scope)))
        throw new DomainError("Diagrama no disponible.", 404);
      return diagram;
    });
  }
}
