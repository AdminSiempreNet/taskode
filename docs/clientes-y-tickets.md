# Clientes y tickets

Los catálogos de Clientes y Tickets son globales y los puede gestionar cualquier usuario autenticado. Cada proyecto, módulo, feature y tarea tiene pestañas **Clientes** y **Tickets** con asignaciones directas; no se heredan de sus padres. El grupo sintético «General» no tiene asignaciones propias. Modificar las relaciones exige permiso de edición de la entidad.

Un ticket tiene número de texto (obligatorio, hasta 100 caracteres), descripción en texto plano, enlace HTTP/HTTPS y cliente opcionales. Los ceros iniciales se conservan. Pueden existir registros con igual número y cliente; se identifican por ID. Los selectores muestran cliente y descripción/enlace para distinguirlos, y el catálogo también muestra una referencia corta.

Al asignar un ticket se agrega su cliente a la entidad. Si cambia el cliente del ticket, se agrega el nuevo cliente a todas las entidades vinculadas, incluso cuando el editor del catálogo no tiene acceso a esos proyectos. Es una consecuencia de la edición global y la respuesta no expone esos destinos. Ambas operaciones son transaccionales. Los clientes anteriores se conservan; también se pueden quitar manualmente. Editar otros campos del ticket no vuelve a agregar un cliente quitado.

**Quitar** un ticket solo elimina el vínculo actual. **Eliminar** borra el registro global y exige desvincularlo de todos sus destinos primero. Los clientes tampoco se pueden eliminar mientras tengan entidades o tickets relacionados. Borrar una entidad elimina sus vínculos, conservando los catálogos.

Las tareas nuevas permiten elegir clientes y tickets antes de guardar. Crear un registro de catálogo desde el formulario es una operación explícita: ese registro se conserva si después se cancela la creación de la tarea.

## Menciones

Comentarios, descripciones de entidades y documentos admiten `@usuarios`, `#clientes` y `!tickets`. Los clientes y tickets se buscan en sus catálogos globales, aunque no estén asignados. Mencionar no asigna ni genera avisos para clientes o tickets; las menciones de usuarios conservan sus notificaciones y reglas de acceso.

Los tickets se guardan como `[número](/mentions/tickets/ID)` y se resuelven por ID, de modo que los números duplicados no se confunden. Su ficha muestra el cliente, la descripción y el enlace. Si se elimina el registro, se conserva el texto histórico sin ficha. Nuevas menciones a registros eliminados se rechazan conservando el borrador.

## API

Los catálogos muestran 25 filas por página, con tamaños de 10, 25, 50 o 100 y controles de primera, anterior, siguiente y última página. Buscar o cambiar el tamaño vuelve a la primera página. Tras eliminar el último registro de una página se muestra la última página disponible.

Tickets permite filtrar por un cliente, por **Sin cliente** o volver a **Todos los clientes**. El selector consulta clientes por páginas. El filtro se combina con la búsqueda y se conserva al cambiar de página o editar un ticket; cambiarlo vuelve a la primera página.

Al editar un ticket, **Vinculado a** muestra sus asignaciones directas en cuatro grupos: proyectos, módulos, features y tareas. Cada grupo incluye el total visible y paginación si supera 25 elementos. Los enlaces abren la pestaña de tickets de la entidad en otra pestaña del navegador para conservar el formulario. Solo se muestran entidades que el usuario puede consultar, incluidas las tareas archivadas a las que conserva acceso.

`GET /api/clients` y `GET /api/tickets` admiten `page`, `pageSize` y `q` (máximo 200 caracteres). Devuelven `{ items, page, pageSize, total, totalPages }`; requieren sesión y sus respuestas no se almacenan en caché. La búsqueda se aplica en PostgreSQL a todo el catálogo, ignora mayúsculas y acentos, y trata los comodines como texto literal. El selector de cliente del ticket también consulta páginas; `/api/clients?selectedId=ID` permite resolver el cliente seleccionado sin descargar el catálogo.

`GET /api/tickets` también admite `clientId=ID` o `withoutClient=true` (mutuamente excluyentes). Omitir ambos devuelve todos los clientes. `GET /api/tickets/ID/links/KIND` admite los mismos parámetros de paginación y búsqueda, con `KIND` igual a `project`, `module`, `feature` o `task`. Devuelve páginas de `{ kind, id, name, projectName, href }`; aplica los permisos antes de contar y paginar. Un ticket inexistente responde `404`.

Las vistas de catálogo solicitan snapshots de espacio sin catálogos completos mediante `GET/POST /api/workspace?catalogs=none`. La tabla carga sus datos por separado, con límite y desplazamiento en la consulta SQL. Las demás vistas conservan el contrato habitual de workspace.

Para reutilizar la navegación en futuras listas, usar `Pagination` (`src/components/pagination.tsx`), el contrato `Paginated<T>` (`src/lib/pagination.ts`) y `usePaginatedList` (`src/components/use-paginated-list.ts`). El hook coordina búsqueda con una espera de 250 ms, cancelación de solicitudes anteriores, errores y recarga tras mutaciones. `Pagination` también ofrece presentación compacta para selectores.

Los comandos se envían a `POST /api/workspace`:

- `entity.clients.update`: `scope: { kind, id, projectId }` y `clientIds`.
- `entity.tickets.update`: el mismo `scope` y `ticketIds`.
- `ticket.create`: `number`, `description`, `url`, `clientId`; admite `scope` para crear y asignar en una sola transacción.
- `ticket.update`: `id` y los campos del ticket.
- `ticket.delete`: `id`; responde `409` si quedan asignaciones.
- `task.create`: admite `clientIds` y `ticketIds` opcionales.

`task.clients.update` y `clientIds` en comandos de tarea siguen admitidos. Las solicitudes con el campo retirado `ticketNumber` responden `409` e indican recargar. Los snapshots incluyen `Workspace.tickets`, y `clientIds`/`ticketIds` en los cuatro tipos de entidad. No incluyen vínculos a tareas o proyectos inaccesibles.

## Actualización y respaldo

La migración `0012_clients_tickets` conserva `task_clients` y convierte cada número antiguo no vacío en un ticket independiente, sin fusionar coincidencias. Usa el único cliente de la tarea cuando existe exactamente uno; con cero o varios deja el ticket sin cliente. Conserva las fechas y verifica las cantidades antes de retirar la columna antigua.

Los nuevos respaldos usan versión **11**. Se admiten las versiones 1–10 con validadores históricos y la misma conversión de números. Los nuevos vínculos y los catálogos se validan y restauran dentro de la transacción habitual, sin volver a aplicar reglas de asignación ni generar notificaciones.

Para actualizar una instalación:

1. Generar y conservar un respaldo completo previo, incluidos los archivos físicos cuando corresponda. Para poder volver a la versión anterior, conservar además un snapshot PostgreSQL con esquema y datos.
2. Detener la versión anterior y aplicar `npm run db:migrate` con la configuración del destino. Para desarrollo local, usar `npm run db:migrate -- --development`.
3. Arrancar la versión nueva y comprobar `/api/health`, cantidades de tickets y asignaciones.

El despliegue debe ser coordinado: no mantener servidores antiguos usando el esquema nuevo. Recuperar la versión anterior requiere restaurar el snapshot PostgreSQL previo, sus archivos físicos y el código anterior. Restaurar un JSON antiguo desde la aplicación nueva lo convierte a v11 y conserva el esquema nuevo.

La validación automatizada incluye `npm test`, `npm run typecheck`, `npm run build`, `npm run test:http`, `npm run test:catalogs:browser`, `npm run test:tickets:browser` y `npm run test:mentions:browser`. Las pruebas de datos usan únicamente `TEST_DATABASE_URL` y esquemas desechables.
