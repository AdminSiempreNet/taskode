# Tareas compartidas y archivos

Cada tarea tiene un **Líder** y un **Equipo** formado por otros usuarios del proyecto. El autor queda registrado, pero conservar acceso requiere ser líder, miembro del equipo, líder de la feature, módulo o proyecto, o administrador. Los miembros del equipo editan contenido, propiedades ordinarias, estado, checklist y documentos y pueden archivar; el líder y los líderes superiores administran el acceso, el traslado de feature y la eliminación. Cada autor edita sus comentarios; el líder y los líderes superiores pueden eliminar mensajes ajenos.

El filtro **Usuarios** comienza en **Mías**: tareas que lideras o en cuyo equipo participas. Sin selección muestra todas las tareas autorizadas. La preferencia se conserva por cuenta y proyecto. El chat se sincroniza con Ably y conserva el borrador y la posición de lectura. Se desplaza al final solo si ya estabas leyendo los mensajes más recientes; en caso contrario muestra «Mensajes nuevos».

## Comentarios en tiempo real con Ably

PostgreSQL sigue almacenando los mensajes. Ably transporta únicamente avisos con el identificador de tarea y evento, nunca el texto, los archivos ni los permisos del remitente. Cada aviso provoca una lectura autenticada de la conversación. Los envíos usan una API dedicada que devuelve solo la conversación, sin volver a descargar el espacio de trabajo.

En [el panel de Ably](https://ably.com/dashboard), crea una aplicación de desarrollo y otra de producción, o como mínimo claves separadas con sus restricciones de canales. En **API Keys → Create new API key**, marca solo **Publish** y **Subscribe**; limita los canales al patrón que corresponde al entorno. History, Presence, administración y revocación de tokens no son necesarios para esta integración.

| Configuración | Desarrollo (`.env.local`) | Vercel (Production) |
| --- | --- | --- |
| Restricción de canales de la clave | `taskode-development:*` | `taskode-production:*` |
| `ABLY_CHANNEL_NAMESPACE` | `taskode-development` | `taskode-production` |
| `ABLY_API_KEY` | Clave completa de desarrollo | Otra clave completa para producción |

Las claves tienen formato `appId.keyId:secret`; guárdalas solo en archivos de entorno ignorados por Git o en el gestor de variables de Vercel. No uses `NEXT_PUBLIC_` ni envíes la clave al navegador. El servidor entrega JWT de diez minutos, limitados a Subscribe en el canal exacto de la tarea y el usuario. Revalida sesión y permisos antes de emitir o renovar cada token.

El servidor calcula los destinatarios actuales antes de publicar. Los canales son diferentes para cada tarea y usuario: al retirar acceso, esa persona deja de recibir los avisos siguientes y las API rechazan nuevas lecturas, escrituras y renovaciones. Un token ya emitido puede seguir conectado hasta caducar, pero su canal deja de recibir avisos de la tarea; no se publica contenido sensible en él.

La migración `0004_comment_realtime` añade una cola operativa y un trigger. Crear, editar o eliminar un comentario registra el aviso dentro de la misma transacción. La cola agrupa cambios por tarea; los procesos reclaman avisos con una concesión temporal y confirman su generación exacta para no perder cambios simultáneos. Si falla Ably, el mensaje permanece guardado y el aviso queda pendiente con espera progresiva. Los endpoints de comentarios drenan la cola después de responder usando `after()` de Next.js; las consultas de seguridad de los chats activos reintentan avisos pendientes. Sin clientes activos, la entrega pendiente se retoma cuando se vuelve a consultar un chat; no requiere un worker o cron adicional. La cola no se exporta en los respaldos y se reinicia al restaurar.

El navegador vuelve a leer el estado al suscribirse, reconectar, recuperar Internet o volver a la pestaña. Como comprobación de seguridad consulta cada 60 segundos mientras está visible; si falta Ably o se desconecta, utiliza consultas cada cinco segundos. Así también detecta cambios de acceso y recupera avisos que pudieron perderse. Los reintentos de creación conservan el mismo identificador y las respuestas antiguas no sobrescriben mensajes recientes. Cada pestaña abre una sola conexión para la conversación activa y la cierra al salir de la tarea.

Para desarrollo, después de guardar la clave:

```powershell
npm run db:migrate -- --development
npm run check:ably
npm run dev
```

La opción `--development` carga `.env.local` y exige que PostgreSQL sea local. `check:ably` prueba un JWT de lectura, una suscripción y una publicación reales con identificadores sintéticos, sin revelar la clave ni enviar comentarios existentes. Si Next.js ya estaba abierto, reinícialo si no recoge las nuevas variables.

Para producción, agrega ambas variables a **Vercel → tareas → Settings → Environment Variables → Production** y despliega el código actualizado. `build:vercel` valida las variables y aplica las migraciones. La validación exige `taskode-production`; una clave de desarrollo no debe reutilizarse como clave de producción. Se puede verificar una configuración local de producción mediante `npm run check:ably -- --production`, usando el archivo privado `.env.production.local`.

Pruebas:

```powershell
npm test
npm run build
npm run test:http
npm run test:realtime:live
```

La última prueba es optativa y usa la clave real de desarrollo con dos sesiones HTTP y Ably. Verifica mensajes, ediciones, borrados y retirada de acceso en un esquema desechable de `TEST_DATABASE_URL`; nunca usa la base de desarrollo o producción para los mensajes de prueba. La suite normal desactiva Ably y utiliza publicadores simulados.

Referencias: [tokens JWT](https://ably.com/docs/auth/token/jwt), [capacidades por canal](https://ably.com/docs/auth/capabilities) y [recuperación de conexiones](https://ably.com/docs/connect/states).

## Migración y despliegue

La migración `0005_entity_details` amplía comentarios y archivos a proyectos, módulos y features, conserva las asociaciones de tareas existentes y actualiza el trigger y el outbox de comentarios. Debe aplicarse antes de arrancar la nueva versión. En desarrollo utiliza `npm run db:migrate -- --development`; en otros entornos utiliza la conexión y el procedimiento de despliegue correspondiente.

Los detalles nuevos se abren desde Editar. Incluyen Descripción, Propiedades, Documentos y la lista de módulos, features o tareas. General es una vista virtual de features sin módulo. Los participantes pueden comentar y leer documentos; los líderes del elemento, sus superiores y el administrador pueden editar y gestionar documentos. El equipo propio del módulo o feature también puede editar su nombre, descripción y documentos; gestionar usuarios, mover y eliminar sigue reservado a los líderes. Las imágenes de los comentarios se autorizan como parte de comentar y se vinculan únicamente a esa conversación. Los permisos de tareas siguen siendo específicos de cada tarea.

Los endpoints `/api/entities/{kind}/{id}`, `/comments` y `/comments/token` comparten la autorización y la lógica de comentarios con los endpoints de tareas existentes. Los canales de tareas mantienen sus nombres; los otros niveles tienen canales separados por tipo, identificador y usuario. Los avisos nuevos contienen tipo e identificador de entidad y evento, sin texto. La cola agrupa cambios por entidad.

Los archivos con `scopeType = null` son temporales; un documento de proyecto tiene `scopeType = project` aunque no tenga `taskId`. La limpieza respeta esa distinción. Borrar un módulo elimina su conversación y documentos propios, y traslada sus features a General conservando los archivos y comentarios de esas features. Al eliminar una entidad se retira el acceso a sus archivos; los objetos privados sin referencia conservan la política de retención descrita abajo.

La migración `0002_task_sharing` es aditiva. Asigna tareas, módulos y features existentes al propietario del proyecto, deja desconocida la autoría histórica y no agrega miembros del equipo automáticamente. El líder de las nuevas tareas es su creador por defecto. Las importaciones Trello registran como autor y líder a quien importa.

La migración `0003_task_leader_and_team` renombra `tasks.assigneeId` a `tasks.leaderId` y la tabla `task_collaborators` a `task_team_members`, junto con sus índices y restricciones. Conserva las filas, las relaciones y los permisos. El código utiliza `leaderId`, `teamMemberIds` y `task.assignment.update`. Las solicitudes con los nombres anteriores se normalizan en la entrada para conservar las selecciones de pestañas abiertas antes del cambio.

Antes de actualizar, conserva el respaldo JSON y la copia física del almacenamiento. Detén las escrituras y las instancias de la versión anterior durante el cambio de permisos. Ejecuta `npm run db:migrate` con la conexión del entorno correspondiente y despliega la aplicación nueva antes de reabrir acceso. No mantengas instancias antiguas atendiendo solicitudes: su código desconoce la privacidad por tarea. El arranque comprueba la versión del esquema y no ejecuta migraciones automáticamente.

Al retirar un miembro hay que reasignar previamente las tareas que lidera y sus propiedades; su pertenencia a los equipos se retira en la misma transacción. Las acciones administrativas conservan las restricciones de proyecto existentes.

## Almacenamiento

- Desarrollo: `ATTACHMENT_STORAGE=filesystem`, `ATTACHMENT_DIR=./data/attachments`. En Docker Compose, el volumen `taskode-attachments` conserva los archivos en `/app/attachments`.
- Vercel: `ATTACHMENT_STORAGE=s3`. Reutiliza `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, credenciales y `S3_PREFIX` de los respaldos. Los objetos se guardan bajo `<S3_PREFIX>attachments/`, separados de `backups/` y de las cargas de respaldos.
- El bucket debe ser privado. Autoriza lectura, escritura, consulta y eliminación de objetos en ese prefijo a la cuenta del servidor. No publiques el bucket ni expongas credenciales al navegador.
- Agrega a CORS los orígenes exactos de la aplicación y desarrollo que utilicen S3, métodos `PUT`, `GET`, `HEAD` y cabeceras `Content-Type` y `x-amz-*`. Ejemplo AWS compatible: `AllowedHeaders: ["*"]`, con `AllowedOrigins` limitado a tus dominios. Conserva las reglas existentes de respaldos.
- Las cargas S3 van directamente al almacenamiento con una URL válida durante cinco minutos. El servidor valida tamaño y contenido antes de publicar bytes validados en una clave diferente. Las lecturas se autorizan de nuevo y generan URLs firmadas de 60 segundos; una URL ya emitida conserva esa vigencia tras revocar acceso.
- Configura también una regla de ciclo de vida de un día únicamente para `<S3_PREFIX>attachments/pending/`. Así se retiran temporales que pudieran quedar tras fallos de red o reutilización de una URL de carga. Mantén una política independiente para los archivos publicados.

**Configuración → Global → General**, disponible al administrador, permite elegir entre 1 y 100 MB por archivo; comienza en 10 MB. Se aplica a documentos e imágenes pegadas y no elimina archivos existentes al reducirlo. Se admiten DOC/DOCX, XLS/XLSX, PDF, JPEG, PNG, GIF, WebP y AVIF. Las imágenes se guardan como referencias Markdown a rutas autenticadas, nunca como base64. Los videos YouTube se conservan como enlaces estándar y se representan con reproductor sin reproducción automática.

Las cargas sin asociar caducan a las 24 horas. Al gestionar cargas se limpian hasta 50 temporales caducados o eliminaciones pendientes. Los fallos al borrar físicamente un documento no restituyen su acceso y se reintentan después. Al eliminar tareas, features o proyectos se retiran sus referencias; pueden quedar objetos privados sin referencia en el almacenamiento. Se conservan para permitir recuperación independiente y deben contemplarse en la política de retención del bucket o directorio.

## Respaldos y restauración

Los nuevos JSON usan la versión 12 e incluyen documentos, menciones, diagramas con imágenes, zonas horarias, notificaciones con sus destinos, líderes y equipos de proyectos, módulos, features y tareas, autores, límite global, metadatos de archivos y las asociaciones de comentarios y documentos con su proyecto, módulo, feature o tarea. Los JSON anteriores de Taskode y Brote, versiones 1–11, siguen admitidos con validadores históricos. La versión 5 renombra los líderes y el equipo del proyecto y deja vacíos los equipos nuevos de módulos y features. La versión 4 recibe las asociaciones de tarea; la versión 3 también convierte los nombres anteriores conservando las asignaciones; las versiones 1 y 2 reciben los mismos valores iniciales que la migración. Las asociaciones inválidas o entre proyectos distintos se rechazan antes de modificar los datos.

Los JSON contienen las imágenes de los diagramas, que se restauran privados. No contienen los demás archivos físicos. Copia por separado el directorio completo `ATTACHMENT_DIR` o el prefijo `<S3_PREFIX>attachments/`, conservando los nombres de objeto. Mantén copias con fechas compatibles con los JSON y retención suficiente para recuperar documentos eliminados. Los respaldos del bucket de JSON, por sí solos, no incluyen los documentos.

Para restaurar, recupera el JSON mediante el flujo habitual y restaura los objetos en el directorio o prefijo configurado, sin cambiar sus identificadores. Si falta un objeto, la descarga informa que se requiere restaurar también el almacenamiento. Las sesiones se invalidan como en las restauraciones existentes.

La migración `0006_entity_leaders_and_teams` renombra `ownerId` a `leaderId` en proyectos, módulos y features, y `project_members` a `project_team_members`. Conserva sus asignaciones y crea `module_team_members` y `feature_team_members` vacíos. Se aplica después de `0005_entity_details`, antes de arrancar la aplicación. Solo el administrador transfiere el liderazgo del proyecto; el líder anterior conserva acceso como miembro del equipo. Al quitar a alguien del proyecto se eliminan sus asignaciones de equipo en módulos, features y tareas, pero primero deben reasignarse los elementos que lidera.

La cabecera **Usuarios** permite consultar líder y equipo en los cuatro niveles. Los cambios se guardan al aceptar, independientemente del borrador de descripción o propiedades. Los equipos de módulo y feature no heredan asignaciones de su padre ni acceso a tareas privadas. El sidebar recuerda los grupos abiertos en la sesión del usuario y los reinicia cuando cambia de proyecto.
