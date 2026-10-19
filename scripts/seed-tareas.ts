import { loadEnvConfig } from "@next/env";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { commandSchema } from "../src/lib/validation";
import { PostgresRepository } from "../src/server/postgres";
import { databaseUrl } from "../src/server/database";
import { projects } from "../src/server/schema";

// Each task has two concrete acceptance criteria drawn from the referenced code.
type ExampleTask = [title: string, criterion: string, criterion: string];
type ExampleFeature = {
  key: string;
  name: string;
  description: string;
  sources: string[];
  tasks: ExampleTask[];
};
type ExampleModule = {
  key: string;
  name: string;
  description: string;
  area: string;
  features: ExampleFeature[];
};

const examples: ExampleModule[] = [
  {
    key: "access",
    name: "Acceso y equipo",
    description: "Identidad con Better Auth, ingreso por invitación y permisos de líderes y participantes.",
    area: "Seguridad",
    features: [
      {
        key: "oauth",
        name: "Inicio de sesión y perfil",
        description: "Acceso con Google o GitHub, identidad del proveedor y cierre de sesión.",
        sources: ["src/server/auth.ts", "src/components/auth-screen.tsx", "src/components/account-menu.tsx"],
        tasks: [
          ["Integrar el acceso con Google y GitHub", "Mostrar únicamente los proveedores que tengan credenciales configuradas.", "Redirigir al espacio de proyectos después de una autenticación válida."],
          ["Verificar el perfil y el cierre de sesión", "Mostrar nombre, correo, proveedor y rol de la cuenta autenticada.", "Impedir el acceso al espacio de trabajo después de cerrar sesión."],
          ["Probar el rechazo de identidades sin correo verificado", "Rechazar el registro cuando el proveedor no acredita un correo verificado.", "Mostrar un mensaje de acceso comprensible sin exponer datos del proveedor."],
        ],
      },
      {
        key: "invitations",
        name: "Invitaciones y configuración inicial",
        description: "Primer administrador, asistente reanudable e invitaciones con proyectos iniciales.",
        sources: ["src/server/onboarding.ts", "src/server/invitations.ts", "src/components/invitation-manager.tsx"],
        tasks: [
          ["Preparar el asistente del primer administrador", "Crear el primer proyecto una sola vez aunque se reintente el paso.", "Retomar el asistente desde el paso guardado en la instalación."],
          ["Validar la vigencia y el reenvío de invitaciones", "Rechazar invitaciones vencidas, revocadas o destinadas a otro correo.", "Invalidar el enlace anterior cuando se reenvía una invitación."],
          ["Revisar el recorrido de invitación sin correo disponible", "Conservar la invitación si falla el envío por Resend.", "Permitir copiar el enlace y seleccionar los proyectos iniciales."],
        ],
      },
      {
        key: "permissions",
        name: "Líderes, equipos y permisos",
        description: "Asignación de responsables y acceso por proyecto, módulo, feature y tarea.",
        sources: ["src/server/postgres.ts", "src/components/project-people.tsx", "tests/entity-assignments.test.ts"],
        tasks: [
          ["Asignar líderes y equipos a la jerarquía del proyecto", "Validar que los responsables tengan acceso al proyecto.", "Evitar que el líder aparezca duplicado en la lista de colaboradores."],
          ["Revisar la visibilidad de tareas compartidas", "Permitir acceso al líder y a los colaboradores de la tarea.", "Respetar el acceso de líderes superiores y del administrador."],
          ["Probar permisos al cambiar el líder de un proyecto", "Restringir el cambio de líder del proyecto al administrador.", "Conservar el acceso del líder anterior como miembro del equipo."],
        ],
      },
    ],
  },
  {
    key: "organization",
    name: "Organización del proyecto",
    description: "Estructura de proyectos, módulos y features con descripciones, orden y numeración.",
    area: "Organización",
    features: [
      {
        key: "projects",
        name: "Gestión de proyectos",
        description: "Creación y edición de la identidad y la descripción de cada proyecto.",
        sources: ["src/components/forms.tsx", "src/components/workspace-app.tsx", "src/server/postgres.ts"],
        tasks: [
          ["Crear proyectos con icono y color propios", "Guardar nombre, descripción, icono y color del proyecto.", "Crear sus estados, prioridades, tipos e impactos iniciales."],
          ["Revisar la edición y el detalle del proyecto", "Persistir los cambios de identidad y descripción al recargar.", "Mostrar el detalle del proyecto desde su ruta propia."],
          ["Probar validaciones del formulario de proyecto", "Rechazar nombres vacíos y colores con formato inválido.", "Conservar los datos del formulario cuando el guardado falla."],
        ],
      },
      {
        key: "modules",
        name: "Módulos y orden de trabajo",
        description: "Agrupación de features en módulos contraíbles con orden persistido.",
        sources: ["src/components/feature-sidebar.tsx", "src/server/postgres.ts", "tests/modules.test.ts"],
        tasks: [
          ["Crear módulos con nombre y descripción", "Añadir el módulo al final del orden del proyecto.", "Mostrar el código del módulo con al menos dos dígitos."],
          ["Verificar el reordenamiento de módulos", "Persistir el orden después de subir o bajar un módulo.", "Rechazar una lista de orden que omita o duplique módulos."],
          ["Probar el traslado a General al eliminar un módulo", "Mover las features del módulo eliminado a General.", "Conservar las tareas y asignar números de feature sin colisiones."],
        ],
      },
      {
        key: "features",
        name: "Features y numeración",
        description: "Numeración independiente por módulo, búsqueda y accesos fijados a features.",
        sources: ["src/lib/features.ts", "src/components/feature-sidebar.tsx", "tests/feature-numbering.test.ts"],
        tasks: [
          ["Crear features con numeración por módulo", "Asignar el primer número libre dentro del módulo seleccionado.", "Mantener una numeración independiente para las features de General."],
          ["Revisar búsqueda y selección de features", "Buscar por número, nombre y descripción de la feature o su módulo.", "Ignorar diferencias de mayúsculas y tildes en la búsqueda."],
          ["Probar el límite de features fijadas", "Permitir hasta cinco features fijadas en el proyecto.", "Explicar cómo liberar un acceso cuando se intenta fijar una sexta."],
        ],
      },
    ],
  },
  {
    key: "tasks",
    name: "Gestión de tareas",
    description: "Ciclo de vida de las tareas, propiedades, seguimiento de avances y archivo.",
    area: "Tareas",
    features: [
      {
        key: "editing",
        name: "Creación y edición de tareas",
        description: "Modal de creación, detalle editable y programación de inicio y entrega.",
        sources: ["src/components/forms.tsx", "src/components/task-detail.tsx", "src/lib/validation.ts"],
        tasks: [
          ["Crear tareas desde el modal del proyecto", "Guardar título, descripción, feature, estado y prioridad.", "Cerrar con Crear y abrir el detalle con Crear y editar."],
          ["Revisar la edición de fechas y horas de una tarea", "Persistir el inicio y la entrega junto con sus horas opcionales.", "Rechazar una entrega anterior al inicio o una hora sin fecha."],
          ["Probar la protección de cambios sin guardar", "Advertir cuando se intenta abandonar una edición pendiente.", "Permitir guardar o descartar los cambios desde el recorrido previsto."],
        ],
      },
      {
        key: "classification",
        name: "Clasificación y filtros",
        description: "Prioridades, etiquetas, tipos, impactos y filtros de trabajo por usuario.",
        sources: ["src/lib/task-filters.ts", "src/components/status-filter.tsx", "src/components/workspace-app.tsx"],
        tasks: [
          ["Clasificar tareas por tipo, impacto y prioridad", "Usar únicamente opciones pertenecientes al proyecto de la tarea.", "Guardar las etiquetas seleccionadas sin duplicados."],
          ["Verificar la combinación de filtros de tareas", "Combinar estado, tipo, impacto y usuario entre sí.", "Aceptar cualquiera de las opciones marcadas dentro de un mismo filtro."],
          ["Probar los filtros Mis tareas y Sin asignar", "Incluir tareas donde el usuario sea líder o colaborador.", "Distinguir las tareas sin tipo o impacto usando la opción correspondiente."],
        ],
      },
      {
        key: "tracking",
        name: "Checklists, historial y archivo",
        description: "Seguimiento por criterios, transiciones de estado y tareas archivadas.",
        sources: ["src/components/task-detail.tsx", "src/server/postgres.ts", "tests/task-history.test.ts"],
        tasks: [
          ["Gestionar el checklist de una tarea", "Crear, editar y completar los elementos del checklist.", "Conservar el orden de los elementos y su progreso al recargar."],
          ["Revisar el historial de cambios de estado", "Registrar el estado anterior, el nuevo y la fecha de transición.", "Conservar nombres y colores históricos aunque se edite el catálogo."],
          ["Probar el archivo y la recuperación de tareas", "Retirar de las vistas activas una tarea archivada.", "Recuperar la tarea conservando descripción, relaciones y checklist."],
        ],
      },
    ],
  },
  {
    key: "views",
    name: "Vistas y navegación",
    description: "Tablero, lista, calendario y navegación persistente del espacio de trabajo.",
    area: "Frontend",
    features: [
      {
        key: "board",
        name: "Tablero y lista",
        description: "Visualización de tareas por estado y movimiento con arrastrar y soltar.",
        sources: ["src/components/views.tsx", "src/lib/board-drop.ts", "tests/board-drop.test.ts"],
        tasks: [
          ["Mostrar tareas en tablero y lista", "Representar los mismos resultados filtrados en ambas vistas.", "Ofrecer creación de tareas desde una columna o desde la lista."],
          ["Revisar el movimiento de tarjetas entre estados", "Actualizar estado y posición al soltar una tarjeta.", "Respetar la tarjeta de referencia al insertar en una columna."],
          ["Probar columnas vacías y movimientos sin cambios", "Permitir soltar una tarjeta en una columna sin tareas.", "Conservar un orden estable al soltar sobre la misma posición."],
        ],
      },
      {
        key: "calendar",
        name: "Calendario y agenda",
        description: "Vistas de mes y semana con intervalos de fechas y franjas horarias.",
        sources: ["src/components/calendar-view.tsx", "src/lib/calendar.ts", "tests/calendar.test.ts"],
        tasks: [
          ["Representar tareas en el calendario mensual y semanal", "Mostrar tareas con fecha de inicio, entrega o ambas.", "Navegar al mes o semana anterior y siguiente manteniendo el modo."],
          ["Revisar la distribución de tareas con horas solapadas", "Repartir el ancho disponible entre intervalos que se superponen.", "Recortar correctamente una tarea que atraviesa varios días."],
          ["Probar la creación desde una franja del calendario", "Precargar la fecha y la hora del espacio seleccionado.", "Diferenciar las tareas de día completo de las tareas con hora."],
        ],
      },
      {
        key: "navigation",
        name: "Sidebar y preferencias",
        description: "Selector de proyectos, favoritos, recientes, expansión y tema visual.",
        sources: ["src/lib/project-navigation.ts", "src/lib/sidebar-expansion.ts", "src/components/theme-provider.tsx"],
        tasks: [
          ["Recordar proyectos favoritos y abiertos recientemente", "Priorizar favoritos y recientes en los cinco accesos del selector.", "Recordar el último proyecto por usuario sin saltarse los permisos."],
          ["Revisar la navegación por enlaces y teclado", "Abrir directamente un proyecto o tarea y permitir Atrás y Adelante.", "Recorrer las opciones del selector con flechas y activarlas con Enter."],
          ["Probar preferencias de sidebar y tema al recargar", "Recuperar los módulos expandidos y el ancho de la barra lateral.", "Mantener el tema elegido al regresar al espacio de trabajo."],
        ],
      },
    ],
  },
  {
    key: "collaboration",
    name: "Contenido y colaboración",
    description: "Descripciones enriquecidas, conversaciones y documentos en la jerarquía de trabajo.",
    area: "Colaboración",
    features: [
      {
        key: "editor",
        name: "Editor de descripciones",
        description: "Edición con Tiptap y Markdown, imágenes, alineación y contenido multimedia.",
        sources: ["src/components/description-editor.tsx", "src/components/media-extensions.ts", "tests/media-markdown.test.ts"],
        tasks: [
          ["Editar descripciones con formato enriquecido", "Conservar títulos, listas, enlaces y bloques de código al guardar.", "Representar el Markdown guardado en el detalle de la entidad."],
          ["Revisar imágenes y contenido multimedia del editor", "Conservar tamaño y alineación de las imágenes insertadas.", "Representar videos admitidos con un diseño adaptable al contenedor."],
          ["Probar contenido pegado y enlaces no permitidos", "Validar el formato de los enlaces y archivos antes de incorporarlos.", "Mantener el contenido legible al alternar edición y visualización."],
        ],
      },
      {
        key: "comments",
        name: "Conversaciones en tiempo real",
        description: "Comentarios por entidad, permisos de moderación y sincronización mediante Ably.",
        sources: ["src/server/comment-http.ts", "src/server/realtime.ts", "src/components/use-task-comments.ts"],
        tasks: [
          ["Comentar en proyectos, módulos, features y tareas", "Asociar cada mensaje con una única entidad del proyecto.", "Mostrar autor y fechas sin mezclar conversaciones de otras entidades."],
          ["Revisar la sincronización de comentarios entre sesiones", "Actualizar los mensajes al recibir un evento del canal autorizado.", "Recuperar la conversación al reconectar o regresar a la pestaña."],
          ["Probar reintentos y permisos al editar comentarios", "Evitar mensajes duplicados al reintentar la misma solicitud.", "Permitir edición al autor y moderación a los responsables autorizados."],
        ],
      },
      {
        key: "documents",
        name: "Archivos y documentos adjuntos",
        description: "Carga validada, descarga autorizada y almacenamiento local o compatible con S3.",
        sources: ["src/server/files.ts", "src/server/file-storage.ts", "src/components/task-documents.tsx"],
        tasks: [
          ["Adjuntar documentos al detalle de una entidad", "Validar extensión, tamaño y tipo real del archivo cargado.", "Vincular el documento finalizado con el proyecto y la entidad elegidos."],
          ["Revisar la descarga y eliminación de documentos", "Autorizar cada descarga según los permisos de la entidad.", "Eliminar el archivo usando el adaptador de almacenamiento configurado."],
          ["Probar límites de carga y limpieza de temporales", "Rechazar archivos que superen el límite configurado de la instalación.", "Limpiar cargas temporales vencidas sin retirar documentos vinculados."],
        ],
      },
    ],
  },
  {
    key: "catalogs",
    name: "Clientes y catálogos",
    description: "Directorio de clientes con geografía colombiana y opciones configurables por proyecto.",
    area: "Datos",
    features: [
      {
        key: "clients",
        name: "Directorio de clientes y ciudades",
        description: "Clientes identificados por nombre normalizado y ciudad del catálogo DIVIPOLA.",
        sources: ["src/components/clients-manager.tsx", "src/lib/clients.ts", "src/server/catalogs/README.md"],
        tasks: [
          ["Crear clientes con departamento y ciudad", "Seleccionar una ciudad del catálogo geográfico disponible.", "Guardar el nombre del cliente normalizando espacios innecesarios."],
          ["Revisar duplicados de clientes por ciudad", "Rechazar nombres equivalentes dentro de la misma ciudad.", "Permitir clientes con el mismo nombre en ciudades diferentes."],
          ["Probar la búsqueda y edición del directorio", "Encontrar clientes sin depender de mayúsculas o tildes.", "Conservar las asociaciones de tareas al editar el cliente."],
        ],
      },
      {
        key: "task-clients",
        name: "Clientes relacionados con tareas",
        description: "Selección de uno o varios clientes y conservación de sus asociaciones.",
        sources: ["src/components/client-picker.tsx", "src/server/postgres.ts", "tests/clients.test.ts"],
        tasks: [
          ["Relacionar varios clientes con una tarea", "Seleccionar clientes existentes desde el formulario de la tarea.", "Guardar cada asociación una sola vez aunque se repita en la solicitud."],
          ["Revisar la actualización de clientes de una tarea", "Conservar las asociaciones cuando una edición omite ese campo.", "Desvincular todos los clientes cuando se envía una selección vacía."],
          ["Probar la eliminación de clientes que tienen tareas", "Rechazar la eliminación mientras existan tareas relacionadas.", "Permitir eliminar el cliente después de retirar sus asociaciones."],
        ],
      },
      {
        key: "options",
        name: "Catálogos del proyecto",
        description: "Administración de estados, prioridades, tipos, impactos y etiquetas con colores.",
        sources: ["src/components/project-catalog.tsx", "src/components/settings-modal.tsx", "tests/task-categories.test.ts"],
        tasks: [
          ["Personalizar opciones y colores del proyecto", "Crear y editar nombres y colores en los catálogos admitidos.", "Evitar opciones con el mismo nombre dentro de un catálogo del proyecto."],
          ["Revisar restricciones al eliminar opciones en uso", "Bloquear la eliminación de tipos, impactos o prioridades usados por tareas.", "Considerar también las tareas archivadas al verificar referencias."],
          ["Probar el renombrado de etiquetas y el catálogo mínimo", "Propagar el nuevo nombre de una etiqueta a las tareas que la usan.", "Conservar al menos una prioridad disponible en el proyecto."],
        ],
      },
    ],
  },
  {
    key: "storage",
    name: "Datos y respaldos",
    description: "Persistencia PostgreSQL con Drizzle, recuperación de datos e importación desde Trello.",
    area: "Backend",
    features: [
      {
        key: "postgres",
        name: "PostgreSQL y migraciones",
        description: "Esquema versionado, integridad referencial y escrituras transaccionales coordinadas.",
        sources: ["src/server/database.ts", "src/server/schema.ts", "scripts/migrate.ts"],
        tasks: [
          ["Preparar PostgreSQL y aplicar migraciones explícitas", "Usar la base configurada en DATABASE_URL y el esquema validado.", "Comprobar que la migración instalada coincide con la esperada."],
          ["Revisar atomicidad y coordinación de escrituras", "Revertir todos los cambios de una transacción cuando ocurre un fallo.", "Coordinar escrituras de distintos procesos mediante el bloqueo compartido."],
          ["Probar el aislamiento de referencias entre proyectos", "Impedir tareas con feature o estado pertenecientes a otro proyecto.", "Verificar claves foráneas e índices en una base aislada de pruebas."],
        ],
      },
      {
        key: "backups",
        name: "Respaldos y restauración",
        description: "Exportación JSON versionada y almacenamiento de respaldos local o S3.",
        sources: ["src/server/backup-data.ts", "src/server/backups.ts", "src/server/s3-backup-storage.ts"],
        tasks: [
          ["Exportar respaldos portables de la aplicación", "Exportar las tablas de dominio desde un snapshot consistente.", "Excluir sesiones y metadatos operativos del respaldo portable."],
          ["Revisar validaciones antes de restaurar un respaldo", "Validar versión, estructura y relaciones antes de sustituir datos.", "Preparar el respaldo previo mediante el recorrido de restauración."],
          ["Probar almacenamiento y exclusión mutua de respaldos", "Operar con el adaptador local o S3 según la configuración.", "Rechazar operaciones incompatibles mientras haya otra en curso."],
        ],
      },
      {
        key: "trello",
        name: "Importación desde Trello",
        description: "Conversión de tableros JSON a estados y tareas con control de duplicados.",
        sources: ["src/lib/validation.ts", "src/server/postgres.ts", "tests/repository.test.ts"],
        tasks: [
          ["Importar un tablero de Trello desde JSON", "Convertir las listas del tablero en estados del proyecto de destino.", "Importar títulos, descripciones, fechas y etiquetas de las tarjetas."],
          ["Revisar la importación repetida del mismo tablero", "Reconocer tarjetas existentes mediante su identificador externo.", "Informar cuántas tarjetas se importaron y cuántas se omitieron."],
          ["Probar archivos Trello inválidos y tarjetas archivadas", "Rechazar JSON mal formado o estructuras fuera de los límites admitidos.", "Respetar la condición de archivo de las tarjetas importadas."],
        ],
      },
    ],
  },
  {
    key: "platform",
    name: "Plataforma y calidad",
    description: "Presentación pública, despliegue, comprobaciones de servicio y recorridos de calidad.",
    area: "Calidad",
    features: [
      {
        key: "landing",
        name: "Página pública e identidad Taskode",
        description: "Landing pública y consistencia de la marca en navegación y comunicaciones.",
        sources: ["src/components/landing-page.tsx", "src/components/taskode-brand.tsx", "src/emails/invitation.tsx"],
        tasks: [
          ["Presentar Taskode en la página pública", "Mostrar la propuesta y las funciones principales sin exigir sesión.", "Ofrecer un acceso visible a la pantalla de inicio de sesión."],
          ["Revisar la identidad en interfaz y correo de invitación", "Usar la marca Taskode de forma consistente en los componentes compartidos.", "Generar una vista previa del correo y su versión de texto sin enviarlo."],
          ["Probar la compatibilidad de preferencias anteriores", "Recuperar las preferencias admitidas de la marca anterior.", "Mantener los enlaces y respaldos compatibles según su versión."],
        ],
      },
      {
        key: "deployment",
        name: "Despliegue y salud del servicio",
        description: "Configuración para Vercel, PostgreSQL en Dokploy y almacenamiento externo.",
        sources: ["src/app/api/health/route.ts", "scripts/check-production.ts", "src/server/database-config.ts"],
        tasks: [
          ["Preparar la configuración de producción", "Validar variables requeridas antes de la compilación de producción.", "Usar conexión TLS verificada al PostgreSQL externo."],
          ["Revisar la respuesta del endpoint de salud", "Responder 200 cuando la conexión y el esquema están disponibles.", "Responder 503 cuando falla la conexión o la versión del esquema."],
          ["Probar el recorrido de despliegue documentado", "Ejecutar las comprobaciones de configuración y compilación del proyecto.", "Verificar salud, acceso y almacenamiento después de una publicación autorizada."],
        ],
      },
      {
        key: "quality",
        name: "Pruebas y experiencia de uso",
        description: "Cobertura de reglas de negocio, comprobaciones HTTP y revisión de recorridos adaptables.",
        sources: ["tests/postgres-fixture.ts", "tests/http-smoke.mjs", "package.json"],
        tasks: [
          ["Preparar pruebas con PostgreSQL aislado", "Usar TEST_DATABASE_URL sin apuntar a la base de desarrollo.", "Crear y limpiar el esquema de prueba sin modificar datos de trabajo."],
          ["Revisar los recorridos HTTP principales", "Comprobar respuestas de autenticación, proyectos y tareas según permisos.", "Validar errores de entrada con mensajes y códigos HTTP esperados."],
          ["Revisar formularios y vistas en móvil y con teclado", "Permitir abrir, completar y cerrar los formularios principales con teclado.", "Verificar lectura y desplazamiento del tablero, detalle y calendario en móvil."],
        ],
      },
    ],
  },
];

const marker = (key: string) => `<!-- taskode:example:tareas:v1:${key} -->`;
const notice = "Dato de ejemplo basado en el código de Tareas. Los estados, las fechas y el progreso son simulados; no representan una auditoría ni el avance real del proyecto.";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

function existing<T extends { id: string; description: string }>(rows: T[], key: string) {
  const matches = rows.filter((row) => row.description.includes(marker(key)));
  if (matches.length > 1) throw new Error(`Hay ejemplos duplicados para ${key}.`);
  return matches[0];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--date=\d{4}-\d{2}-\d{2}$/.test(arg)))
    throw new Error("Uso: npm run db:seed:tareas -- [--apply] [--date=AAAA-MM-DD]");
  const apply = args.includes("--apply");
  const today = args.find((arg) => arg.startsWith("--date="))?.slice(7) ??
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const reference = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(reference.getTime()) || reference.toISOString().slice(0, 10) !== today)
    throw new Error("La fecha de referencia no es válida.");
  const dateAt = (offset: number) => {
    const date = new Date(reference);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  for (const source of new Set(examples.flatMap((module) => module.features.flatMap((feature) => feature.sources))))
    await access(resolve(process.cwd(), source));

  // This command deliberately loads development settings and never targets a remote database.
  loadEnvConfig(process.cwd(), true);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl()).hostname))
    throw new Error("La carga de ejemplos requiere la base PostgreSQL local del proyecto.");
  const repo = new PostgresRepository(databaseUrl());
  try {
    await repo.store.ready;
    const candidates = (await repo.store.db.select().from(projects)).filter((project) => normalize(project.name) === "tareas");
    if (candidates.length !== 1) throw new Error("Debe existir exactamente un proyecto llamado Tareas.");
    const project = candidates[0];
    const actor = { id: project.leaderId };
    const run = (input: unknown) => repo.execute(commandSchema.parse(input), actor);
    const result = await repo.store.transaction(async () => {
      const workspace = await repo.getWorkspace(actor);
      const moduleRows = workspace.modules.filter((row) => row.projectId === project.id);
      const featureRows = workspace.features.filter((row) => row.projectId === project.id);
      const taskRows = workspace.tasks.filter((row) => row.projectId === project.id);
      const option = (rows: { id: string; projectId: string; name: string }[], name: string) => {
        const matches = rows.filter((row) => row.projectId === project.id && normalize(row.name).includes(normalize(name)));
        if (matches.length !== 1) throw new Error(`No se encuentra una opción única para ${name}.`);
        return matches[0].id;
      };
      const statuses = ["Terminado", "En proceso", "Pendiente", "Terminado", "En revisión", "Pendiente"];
      const types = ["Requerimiento", "Requerimiento", "Sugerencia", "Requerimiento", "Falencia", "Error"];
      const added = { modules: 0, features: 0, tasks: 0, checklists: 0, items: 0 };
      const skipped = { modules: 0, features: 0, tasks: 0 };
      const taskIds: string[] = [];
      let index = 0;
      for (const module of examples) {
        const moduleKey = `module:${module.key}`;
        let moduleId = existing(moduleRows, moduleKey)?.id;
        if (moduleId) skipped.modules++;
        else {
          if (moduleRows.some((row) => normalize(row.name) === normalize(module.name)))
            throw new Error(`Ya existe un módulo ajeno a esta carga: ${module.name}.`);
          added.modules++;
          if (apply) moduleId = (await run({ type: "module.create", projectId: project.id,
            name: module.name, description: `${module.description}\n\n${notice}\n\n${marker(moduleKey)}` })).createdId!;
        }
        for (const feature of module.features) {
          const featureKey = `feature:${module.key}:${feature.key}`;
          let featureId = existing(featureRows, featureKey)?.id;
          if (featureId) {
            if (featureRows.find((row) => row.id === featureId)?.moduleId !== moduleId)
              throw new Error(`La feature de ejemplo cambió de módulo: ${feature.name}.`);
            skipped.features++;
          } else {
            if (featureRows.some((row) => row.moduleId === moduleId && normalize(row.name) === normalize(feature.name)))
              throw new Error(`Ya existe una feature ajena a esta carga: ${feature.name}.`);
            added.features++;
            if (apply) featureId = (await run({ type: "feature.create", projectId: project.id, moduleId,
              name: feature.name, description: `${feature.description}\n\n### Código de referencia\n${feature.sources.map((source) => `- \`${source}\``).join("\n")}\n\n${notice}\n\n${marker(featureKey)}` })).createdId!;
          }
          for (const [taskIndex, [title, ...criteria]] of feature.tasks.entries()) {
            const taskKey = `task:${module.key}:${feature.key}:${taskIndex + 1}`;
            const ticketNumber = `DEMO-TAR-${String(index + 1).padStart(3, "0")}`;
            const statusName = statuses[index % statuses.length];
            const statusId = option(workspace.statuses, statusName);
            const priority = option(workspace.priorities, ["Alta", "Media", "Baja"][(index + Math.floor(index / 3)) % 3]);
            const typeId = option(workspace.taskTypes, types[index % types.length]);
            const impactId = option(workspace.impacts, ["Usuario", "Feature", "Proyecto"][index % 3]);
            const previous = existing(taskRows, taskKey);
            const offset = statusName === "Terminado" ? -5 + index % 5 :
              statusName === "Pendiente" ? 3 + index % 18 : -2 + index % 9;
            const noDate = statusName === "Pendiente" && index % 6 === 5;
            if (previous) {
              if (previous.featureId !== featureId) throw new Error(`La tarea de ejemplo cambió de feature: ${title}.`);
              skipped.tasks++;
              taskIds.push(previous.id);
            } else {
              added.tasks++;
              added.checklists++;
              added.items += criteria.length;
              const input = commandSchema.parse({ type: "task.create", projectId: project.id, featureId: featureId ?? "preview",
                title, statusId, priority, typeId, impactId,
                description: `## Objetivo\n${title}.\n\n${feature.description}\n\n### Criterios de aceptación\n${criteria.map((criterion) => `- ${criterion}`).join("\n")}\n\n### Código de referencia\n${feature.sources.map((source) => `- \`${source}\``).join("\n")}\n\n${notice}\n\n${marker(taskKey)}`,
                startDate: noDate ? null : dateAt(offset - (taskIndex === 1 ? 2 : 0)),
                dueDate: noDate ? null : dateAt(offset),
                startTime: !noDate && index % 4 === 0 ? "09:00" : null,
                dueTime: !noDate && index % 4 === 0 ? "11:00" : null,
                labels: ["Ejemplo", module.area],
              });
              if (apply) {
                const taskId = (await run(input)).createdId!;
                taskIds.push(taskId);
                await run({ type: "ticket.create", number: ticketNumber, description: "", url: null, clientId: null,
                  scope: { kind: "task", id: taskId, projectId: project.id } });
                const checklistId = (await run({ type: "checklist.create", taskId, title: "Criterios de aceptación" })).createdId!;
                for (const [criterionIndex, criterion] of criteria.entries()) {
                  const itemId = (await run({ type: "checklist.item.create", checklistId, title: criterion })).createdId!;
                  if (statusName === "Terminado" || (statusName === "En revisión" && criterionIndex === 0))
                    await run({ type: "checklist.item.update", id: itemId, title: criterion, completed: true });
                }
              }
            }
            index++;
          }
        }
      }
      if (apply) {
        // Validate the same snapshot contract consumed by the application before committing.
        const after = await repo.getWorkspace(actor);
        const saved = after.tasks.filter((task) => taskIds.includes(task.id));
        if (saved.length !== index || saved.some((task) => !task.labels.includes("Ejemplo") ||
          task.checklists.length !== 1 || task.checklists[0].items.length !== 2))
          throw new Error("Los ejemplos no superaron la verificación; se revierte toda la carga.");
      }
      return { mode: apply ? "aplicado" : "vista previa; añade --apply para guardar", project: project.name,
        projectId: project.id, referenceDate: today, added, skipped };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await repo.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No se pudieron cargar los ejemplos.");
  process.exitCode = 1;
});
