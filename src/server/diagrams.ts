import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { diagrams } from "./schema";
import type { PostgresRepository } from "./postgres";
import type { Actor, EntityKind } from "../lib/types";
import { entityColumns, rowScope } from "../lib/entities";
import {
  diagramBytes,
  diagramInputSchema,
  MAX_DIAGRAM_BYTES,
  type DiagramDocument,
  type DiagramInput,
  type DiagramSummary,
  type PublicDiagram,
} from "../lib/diagrams";
import { DomainError } from "./repository";

function input(value: unknown): DiagramInput {
  if (diagramBytes(value) > MAX_DIAGRAM_BYTES)
    throw new DomainError(
      "El diagrama supera el límite de 3 MB, incluidas sus imágenes.",
      413,
    );
  const parsed = diagramInputSchema.safeParse(value);
  if (!parsed.success)
    throw new DomainError(
      "Revisa el título, la descripción y las imágenes del diagrama.",
    );
  return parsed.data;
}
const summaryColumns = {
  id: diagrams.id,
  title: diagrams.title,
  description: diagrams.description,
  revision: diagrams.revision,
  createdAt: diagrams.createdAt,
  updatedAt: diagrams.updatedAt,
  isPublic: sql<boolean>`${diagrams.publicToken} is not null`,
};
export class DiagramsService {
  constructor(private repo: PostgresRepository) {}
  private async target(actor: Actor, id: string) {
    const [row] = await this.repo.store.db
      .select()
      .from(diagrams)
      .where(eq(diagrams.id, id));
    if (!row)
      throw new DomainError("El diagrama no existe o no tienes acceso.", 404);
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
      const rows = await this.repo.store.db
        .select(summaryColumns)
        .from(diagrams)
        .where(
          and(
            eq(diagrams.projectId, scope.projectId),
            eq(diagrams.scopeType, scope.kind),
            ...(scope.kind === "project"
              ? []
              : [
                  eq(
                    scope.kind === "task"
                      ? diagrams.taskId
                      : scope.kind === "module"
                        ? diagrams.moduleId
                        : diagrams.featureId,
                    scope.id,
                  ),
                ]),
          ),
        )
        .orderBy(desc(diagrams.updatedAt), diagrams.id);
      return { diagrams: rows satisfies DiagramSummary[], permissions };
    });
  }
  async get(actor: Actor, id: string): Promise<DiagramDocument> {
    return this.repo.store.snapshot(async () => {
      const { row, scope, permissions } = await this.target(actor, id);
      const {
        publicToken,
        projectId: _p,
        taskId: _t,
        moduleId: _m,
        featureId: _f,
        scopeType: _s,
        ...document
      } = row;
      return {
        ...document,
        isPublic: !!publicToken,
        scope,
        permissions,
        ...(permissions.canManageAccess
          ? {
              publicPath: publicToken ? `/share/diagrams/${publicToken}` : null,
            }
          : {}),
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
          "No puedes crear diagramas en este elemento.",
          403,
        );
      const id = randomUUID(),
        now = new Date().toISOString();
      await this.repo.store.db
        .insert(diagrams)
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
      const { permissions } = await this.target(actor, id);
      if (!permissions.canEdit)
        throw new DomainError("No puedes editar este diagrama.", 403);
      const result = await this.repo.store.db
        .update(diagrams)
        .set({
          ...data,
          revision: revision + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(diagrams.id, id), eq(diagrams.revision, revision)))
        .returning({ id: diagrams.id });
      if (!result.length)
        throw new DomainError(
          "El diagrama cambió en otra pestaña. Tu borrador sigue aquí; recarga la versión guardada para continuar.",
          409,
        );
      return this.get(actor, id);
    });
  }
  async remove(actor: Actor, id: string) {
    await this.repo.store.transaction(async () => {
      const { permissions } = await this.target(actor, id);
      if (!permissions.canEdit)
        throw new DomainError("No puedes eliminar este diagrama.", 403);
      await this.repo.store.db.delete(diagrams).where(eq(diagrams.id, id));
    });
  }
  async share(actor: Actor, id: string, enabled: boolean) {
    return this.repo.store.transaction(async () => {
      const { row, permissions } = await this.target(actor, id);
      if (!permissions.canManageAccess)
        throw new DomainError(
          "Solo quien administra el acceso puede compartir el diagrama.",
          403,
        );
      await this.repo.store.db
        .update(diagrams)
        .set({
          publicToken: enabled
            ? (row.publicToken ?? randomBytes(32).toString("base64url"))
            : null,
        })
        .where(eq(diagrams.id, id));
      return this.get(actor, id);
    });
  }
  async publicDocument(token: string): Promise<PublicDiagram> {
    await this.repo.store.ready;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new DomainError("Diagrama no disponible.", 404);
    const [row] = await this.repo.store.db
      .select({
        title: diagrams.title,
        description: diagrams.description,
        scene: diagrams.scene,
      })
      .from(diagrams)
      .where(eq(diagrams.publicToken, token));
    if (!row) throw new DomainError("Diagrama no disponible.", 404);
    return {
      ...row,
      scene: {
        ...row.scene,
        elements: row.scene.elements.map(
          ({ customData: _c, link: _l, ...element }) => element,
        ),
      },
    };
  }
}
