# Servidor MCP

El catálogo de [aplicaciones por proyecto](aplicaciones.md) también está disponible: `get_project_tree` lo consulta, `upsert_project_option` y `delete_item` aceptan `application`, y `set_links` asigna `applicationIds` a módulos, features y tareas. `create_task` y `update_task` aceptan la selección, y `search_tasks` filtra por aplicaciones o `__unassigned__` para tareas sin aplicación.

Taskode publica un servidor [Model Context Protocol](https://modelcontextprotocol.io) en `https://taskode.siempre.net.co/api/mcp`. Asistentes como Claude, Claude Code o Cursor pueden consultar y gestionar proyectos, tareas, comentarios, documentos, diagramas, archivos, tickets, clientes y avisos en nombre de la persona que autoriza la conexión. Actúan con sus mismos permisos: cada herramienta pasa por los servicios y comprobaciones de acceso que usa la interfaz, y lo que una persona no puede ver ni modificar tampoco lo puede hacer su asistente.

El transporte es Streamable HTTP sin estado, compatible con la revisión 2026-07-28 del protocolo y con clientes de 2025. La autorización es OAuth 2.1 con PKCE, servida por Better Auth (`@better-auth/mcp`, `@better-auth/oauth-provider` y `@better-auth/cimd`, fijados en 1.7.10). Los tokens de acceso son JWT firmados para el recurso `/api/mcp`; no se aceptan cookies de sesión en ese endpoint.

## Conectar un asistente

- **Claude (web, escritorio y móvil):** **Configuración → Conectores → Añadir conector personalizado** con la URL `https://taskode.siempre.net.co/api/mcp`. Claude se identifica con un documento de metadatos (CIMD) y la pantalla de consentimiento muestra su dominio verificado.
- **Claude Code:** `claude mcp add --transport http taskode https://taskode.siempre.net.co/api/mcp` y después `/mcp` para iniciar sesión.
- **Cursor y otros clientes:** usan la misma URL y el registro dinámico de clientes (RFC 7591). La pantalla de consentimiento los marca como **Registrada automáticamente**: confirma que reconoces la aplicación antes de permitirla.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transporte Streamable HTTP y la URL anterior (en desarrollo, `http://localhost:5010/api/mcp`). En modo directo desde el navegador su origen debe figurar en `MCP_ALLOWED_ORIGINS`.

El asistente abre `/login`. Solo pueden autorizar aplicaciones las cuentas que ya existen en Taskode; conectar una aplicación nunca crea cuentas ni consume invitaciones. Tras iniciar sesión con Google o GitHub, `/oauth/consent` muestra la aplicación, adónde devolverá el acceso y los permisos solicitados.

## Permisos

| Permiso | Concede |
|---|---|
| `taskode:read` | Consultar proyectos, tareas, comentarios, documentos, diagramas, archivos, tickets, clientes y avisos. Imprescindible para usar el servidor. |
| `taskode:write` | Crear, modificar, mover, comentar y eliminar con los permisos de la persona. |
| `taskode:admin` | Solo el administrador, y desmarcado por defecto: usuarios, invitaciones, configuración y asistente inicial. Sus tokens caducan a los 15 minutos. |
| `offline_access` | Mantener la conexión hasta 30 días mediante refresh tokens rotativos. |

Los tokens de acceso duran una hora. Cada petición comprueba firma, emisor, audiencia, caducidad, permisos, que la cuenta existe y que la autorización sigue vigente. **Mi perfil → Aplicaciones conectadas** lista las aplicaciones, sus permisos y su último uso; **Revocar acceso** surte efecto en la siguiente petición e invalida sus refresh tokens. Las herramientas que un token no puede usar ni siquiera aparecen en su lista.

## Herramientas

- **Consulta:** `get_me`, `list_projects`, `get_project_tree` (módulos, features, estados, prioridades, tipos, impactos, etiquetas y personas con sus ids), `search_tasks` (proyecto, módulo, feature, texto sin acentos, estado, terminadas, responsable, prioridad, tipo, impacto, etiquetas, cliente, ticket, fechas, vencidas y archivadas), `get_task`, `get_entity`, `get_document`, `get_diagram`, `get_file`, `search_catalog` (clientes, tickets y ciudades), `get_ticket`, `get_mention_options` y `list_notifications`.
- **Tareas:** `create_task` (con checklist opcional), `update_task` (solo los campos indicados; `expectedUpdatedAt` evita pisar cambios), `move_task`, `archive_task`, `upsert_checklist`, `add_comment` y `edit_comment`.
- **Estructura y catálogos:** `create_entity`, `update_entity`, `set_assignment`, `set_links`, `reorder`, `upsert_project_option`, `upsert_client` y `upsert_ticket`.
- **Contenido:** `save_document` (con la revisión leída; una revisión antigua falla), `save_diagram` (formas, textos y flechas sencillas o una escena Excalidraw completa), `share_diagram` y `upload_file`.
- **Avisos:** `mark_notifications_read` y `update_notification_preferences`.
- **Administración:** `admin_list_users`, `admin_get_user_projects`, `admin_update_user_projects`, `admin_invite`, `admin_revoke_invitation`, `admin_update_settings` y `admin_onboarding`. Los enlaces de invitación nunca salen por MCP.
- **Eliminación:** `delete_item` elimina proyectos, módulos, features, tareas, comentarios, documentos, diagramas, archivos, checklists, ítems, opciones del proyecto, clientes y tickets.

Los respaldos y la importación de Trello no están disponibles por MCP.

Además hay recursos de solo lectura (`taskode://projects/{id}`, `taskode://tasks/{id}` y `taskode://documents/{id}`) y los prompts `resumen_diario`, `planificar_sprint` y `revisar_tarea`.

## Eliminaciones y acciones sensibles

`delete_item` exige `confirm` con el nombre, título o número exacto del elemento (para comentarios, su id); si no coincide no elimina nada y no revela el valor esperado. Lo mismo ocurre al publicar un diagrama (`share_diagram`), al revocar una invitación o al retirar proyectos a un usuario (con su correo). Las herramientas destructivas se anuncian con `destructiveHint`, de modo que los clientes piden aprobación a la persona. La confirmación evita equivocaciones de destino; no sustituye a revisar lo que el asistente propone.

## Seguridad

Las descripciones, comentarios, documentos y textos de diagramas llegan al modelo delimitados con `<contenido_usuario>` y las instrucciones del servidor indican que son datos, nunca órdenes. Un cierre del delimitador dentro del texto se neutraliza. El endpoint valida el encabezado `Origin` para evitar ataques de DNS rebinding y solo responde CORS a `BETTER_AUTH_URL` y `MCP_ALLOWED_ORIGINS`; los metadatos OAuth, el token y el registro admiten CORS público sin credenciales. Login y consentimiento no se pueden incrustar en marcos y no envían referer.

Cada cambio se limita a 60 por minuto y usuario (300 consultas por minuto, por instancia) y queda registrado en `mcp_activity` con la herramienta, el tipo e id del elemento, la aplicación y el resultado, nunca con su contenido. El programador de notificaciones limpia cada 15 minutos los clientes registrados automáticamente que nadie autorizó en 24 horas, los clientes CIMD sin uso en 30 días, los tokens vencidos o revocados hace más de 7 días y la auditoría de más de 90 días.

Las claves de firma se guardan cifradas con `BETTER_AUTH_SECRET` en la tabla `jwks`: cambiar ese secreto obliga a volver a conectar todas las aplicaciones. Restaurar un respaldo retira las aplicaciones conectadas y conserva las claves.

## Despliegue

1. `npm run db:migrate` aplica las migraciones pendientes, incluida `0014_oauth_mcp`, que crea las tablas OAuth, `jwks` y `mcp_activity`, y `0015_applications`, con su backfill de aplicaciones. `build:vercel` las ejecuta después de compilar y antes de publicar.
2. No hay variables obligatorias nuevas: issuer, recurso y metadatos derivan de `BETTER_AUTH_URL`.
3. Variables opcionales:

```dotenv
MCP_ENABLED=true
MCP_ALLOWED_ORIGINS=https://inspector.example.com
MCP_JWKS_URL=http://127.0.0.1:5010/api/auth/jwks
```

`MCP_ENABLED=false` desactiva el endpoint y los metadatos. `MCP_JWKS_URL` solo hace falta cuando el servidor no puede llegar a su propia URL pública; `compose.yaml` la apunta al propio contenedor. `npm run check:production` valida estos valores.

4. Comprueba los metadatos públicos:

```text
GET https://taskode.siempre.net.co/.well-known/oauth-protected-resource/api/mcp
GET https://taskode.siempre.net.co/.well-known/oauth-authorization-server/api/auth
```

Una petición sin token a `/api/mcp` debe responder 401 con `WWW-Authenticate` y `resource_metadata`.

## Verificación

`npm test` cubre el flujo OAuth completo (registro dinámico, CIMD, login social, consentimiento, PKCE, refresh y revocación), la negativa a crear cuentas, los metadatos, los permisos por scope y rol, el Origin, las herramientas por dominio, las confirmaciones, el contenido delimitado, la auditoría, la limpieza y la restauración. `npm run test:mcp:http` levanta `next start` y verifica el endpoint, los metadatos y una llamada real con token después de `npm run build`.
