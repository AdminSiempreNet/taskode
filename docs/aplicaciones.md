# Aplicaciones por proyecto

Cada proyecto tiene su catálogo de aplicaciones. Comienza con Web, Android, iOS, Windows y macOS. En la configuración del proyecto, **Aplicaciones** permite crear opciones y cambiar sus nombres y colores. Administran el catálogo los administradores y el líder del proyecto, como en tipos e impactos.

La aplicación inicial Web se identifica por su registro y su indicador interno de predeterminada: renombrarla no cambia su función. No puede eliminarse. Otras aplicaciones solo pueden eliminarse cuando no están asociadas a módulos, features o tareas, incluidas las archivadas.

## Selección

En **Propiedades → Aplicaciones**, los usuarios con permiso de edición pueden seleccionar varias aplicaciones, buscar opciones y quitar la selección. Los módulos y features comienzan sin aplicaciones. Sus selecciones son independientes de las de sus hijos y no conceden permisos de acceso.

Las tareas nuevas comienzan con la aplicación predeterminada. Se puede quitar, sustituir o dejar la tarea sin aplicaciones. Esto se aplica a la web, MCP, onboarding, ejemplos e importaciones de Trello. El selector de tareas existentes guarda al cambiar; las demás propiedades conservan su guardado habitual.

En **Clasificación → Aplicaciones**, elige una o varias opciones o **Sin aplicación**. Coincidir con cualquiera de las seleccionadas basta; los demás grupos de filtros siguen aplicándose conjuntamente. El filtro se conserva con las preferencias actuales y funciona en tablero, lista, calendario y lista de tareas de una feature.

## API y MCP

El workspace incluye `applications` y cada módulo, feature y tarea expone `applicationIds`. El proyecto posee el catálogo y no tiene selección propia.

- `application.create`, `application.update`, `application.delete`: administración del catálogo mediante los comandos compartidos de `/api/workspace`.
- `entity.applications.update`: reemplaza las asociaciones de un módulo, feature o tarea, con su `scope` y `applicationIds`.
- `task.create`: omitir `applicationIds` asigna la predeterminada; un array explícito, incluido `[]`, se respeta.
- `task.update`: omitir `applicationIds` conserva las asociaciones; `[]` las elimina.

En MCP, `get_project_tree` devuelve el catálogo y la predeterminada; `get_entity`, `get_task` y `search_tasks` incluyen las asociaciones. `upsert_project_option` y `delete_item` aceptan `application`; la eliminación conserva su confirmación exacta. `set_links` admite `applicationIds` y los modos `add`, `remove` y `replace` para módulos, features y tareas. `create_task` y `update_task` siguen las reglas anteriores. `search_tasks.applicationIds` acepta identificadores y `__unassigned__`, con la misma semántica que el filtro web.

## Actualización y respaldos

Aplicar `0015_applications` antes de arrancar la nueva versión. Para desarrollo local: `npm run db:migrate -- --development`. Para producción, usar el procedimiento de migraciones del despliegue. La migración crea las cinco aplicaciones en cada proyecto y asigna Web a todas las tareas existentes, incluidas las archivadas; los módulos y features quedan sin aplicaciones.

Los respaldos nuevos usan la versión 13. Conservan nombres, colores, identidad de la predeterminada y asociaciones, incluso selecciones vacías. Los respaldos de versiones 1–12 siguen admitidos y, al convertirlos, reciben las cinco aplicaciones por proyecto y Web en sus tareas. La restauración valida referencias y pertenencia al proyecto antes de modificar datos.

## Verificación

`npm run typecheck`, `npm test`, `npm run build` y `npm run test:applications:browser`. Las pruebas de dominio y MCP cubren permisos, aislamiento, valores iniciales, filtros, migración y respaldos; las de navegador verifican creación, edición y filtros desde la interfaz.
