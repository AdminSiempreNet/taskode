import { eq } from "drizzle-orm";
import { commandSchema } from "../lib/validation";
import type { Actor } from "../lib/types";
import type { PostgresRepository } from "./postgres";
import { installation } from "./schema";
import { DomainError } from "./repository";

export async function createFirstProject(
  repo: PostgresRepository,
  actor: Actor,
  input: unknown,
  demo: boolean,
) {
  await repo.requireAdmin(actor);
  const command = commandSchema.safeParse({
    ...(input as object),
    type: "project.create",
  });
  if (!command.success)
    throw new DomainError("Completa los datos del proyecto.");
  return repo.store.transaction(async () => {
    const state = await repo.store.state();
    if (state.onboardingStep !== 0) return { projectId: state.firstProjectId };
    const { createdId: projectId } = await repo.execute(command.data, actor);
    if (demo) await seedWebApplication(repo, actor, projectId!);
    await repo.store.db
      .update(installation)
      .set({ onboardingStep: 1, firstProjectId: projectId })
      .where(eq(installation.id, 1));
    return { projectId };
  });
}
export async function finishOnboarding(repo: PostgresRepository, actor: Actor) {
  await repo.requireAdmin(actor);
  await repo.store.transaction(async () => {
    const state = await repo.store.state();
    if (state.onboardingStep === 0)
      throw new DomainError("Crea primero tu proyecto.");
    await repo.store.db
      .update(installation)
      .set({ onboardingStep: 2 })
      .where(eq(installation.id, 1));
  });
}
async function seedWebApplication(
  repo: PostgresRepository,
  actor: Actor,
  projectId: string,
) {
  const modules = [
    {
      name: "Interfaz y experiencia",
      description:
        "Diseño y construcción de la interfaz de una aplicación web.",
      features: [
        {
          name: "Página de inicio",
          tasks: [
            "Definir la estructura y los componentes de la página",
            "Implementar navegación y diseño adaptable",
            "Revisar accesibilidad y estados vacíos",
          ],
        },
        {
          name: "Panel de control",
          tasks: [
            "Diseñar las tarjetas de métricas",
            "Conectar filtros y búsqueda",
          ],
        },
      ],
    },
    {
      name: "Usuarios y datos",
      description: "Acceso de usuarios y funciones principales del producto.",
      features: [
        {
          name: "Acceso y perfil",
          tasks: [
            "Integrar acceso con proveedores sociales",
            "Mostrar los datos del perfil y cerrar sesión",
          ],
        },
        {
          name: "Gestión de contenido",
          tasks: [
            "Implementar creación y edición de registros",
            "Validar permisos y datos en el servidor",
          ],
        },
      ],
    },
    {
      name: "Calidad y despliegue",
      description: "Pruebas, publicación y operación de la aplicación.",
      features: [
        {
          name: "Lanzamiento",
          tasks: [
            "Preparar pruebas de los recorridos principales",
            "Configurar variables y entorno de producción",
            "Publicar la primera versión y verificar el servicio",
          ],
        },
      ],
    },
  ];
  const workspace = await repo.getWorkspace(actor),
    statuses = workspace.statuses.filter((s) => s.projectId === projectId);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Bogota",
  });
  let index = 0;
  for (const module of modules) {
    const { createdId: moduleId } = await repo.execute(
      {
        type: "module.create",
        projectId,
        name: module.name,
        description: module.description,
      },
      actor,
    );
    for (const feature of module.features) {
      const { createdId: featureId } = await repo.execute(
        {
          type: "feature.create",
          projectId,
          moduleId,
          name: feature.name,
          description: `Entregables de ${feature.name.toLowerCase()} para la aplicación web.`,
        },
        actor,
      );
      for (const title of feature.tasks) {
        const date = new Date(`${today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + index - 3);
        const { createdId: taskId } = await repo.execute(
          {
            type: "task.create",
            projectId,
            featureId: featureId!,
            statusId: statuses[index % statuses.length].id,
            title,
            description: `## Objetivo\n${title}.\n\n### Criterios de aceptación\n- La función responde al recorrido esperado.\n- Se contemplan errores y pantallas pequeñas.\n- El cambio está listo para revisión.`,
            priority:
              index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low",
            dueDate: date.toISOString().slice(0, 10),
            labels: ["Ejemplo", index % 2 ? "Frontend" : "Backend"],
          },
          actor,
        );
        if (index % 3 === 0) {
          const { createdId: checklistId } = await repo.execute(
            {
              type: "checklist.create",
              taskId: taskId!,
              title: "Lista de entrega",
            },
            actor,
          );
          for (const title of [
            "Implementar el cambio",
            "Revisar los criterios de aceptación",
            "Validar en móvil y escritorio",
          ])
            await repo.execute(
              {
                type: "checklist.item.create",
                checklistId: checklistId!,
                title,
              },
              actor,
            );
        }
        index++;
      }
    }
  }
}
