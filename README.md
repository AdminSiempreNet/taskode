# Brote · Proyectos y tareas

Aplicación en español con Next.js, React, TypeScript, shadcn/ui y PostgreSQL mediante Drizzle ORM. Better Auth gestiona el acceso con Google/GitHub y las invitaciones.

La [decisión de arquitectura y sus fases](docs/migracion-sqlite-postgresql.md) documenta las alternativas analizadas. Esta edición usa exclusivamente PostgreSQL y comienza con una base vacía. Los archivos y volúmenes SQLite anteriores se conservan, sin importarlos ni modificarlos.

## Desarrollo local

Requiere Node.js **24.x** y Docker Desktop con Docker Compose. Next.js corre en Windows con Fast Refresh; PostgreSQL 18 con pgvector 0.8.7 corre en un contenedor exclusivo de este proyecto. Desarrollo, producción y Dokploy usan `pgvector/pgvector:0.8.7-pg18-bookworm`, fijada a la última versión estable de pgvector verificada al realizar este cambio. Esta imagen incorpora PostgreSQL 18.6.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run db:up
npm run db:migrate
npm run dev
```

Copia `.env.example` solamente en una instalación nueva: conserva tu `.env.local` si ya contiene credenciales. Completa sus variables antes de arrancar.

- `DATABASE_URL`: conexión obligatoria del servidor. En desarrollo usa `127.0.0.1:5432/brote`.
- `POSTGRES_PASSWORD`: contraseña de inicialización de PostgreSQL.
- `BROTE_DB_PASSWORD`: contraseña del rol `brote`, que **no es superusuario**. Debe coincidir con la contraseña de `DATABASE_URL`.
- `POSTGRES_DB`: `brote` por defecto.
- `TEST_DATABASE_URL`: conexión a `brote_test`; nunca puede apuntar a la base de desarrollo.
- `BACKUP_DIR`: carpeta de respaldos (`./data/backups` por defecto).

Las credenciales de ejemplo son sólo para desarrollo. Para producción genera contraseñas independientes con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Los caracteres base64url permiten utilizarlas en la URL de conexión sin escapes adicionales.

La web abre en **http://localhost:5010**. Si otro servicio ocupa 5010, detenlo antes de ejecutar `npm run dev`.

`npm run db:up` levanta solamente PostgreSQL y espera a que esté saludable. El contenedor publica únicamente `127.0.0.1:5432`, usa el volumen `brote-dev_brote-postgres-dev` y crea también `brote_test`. No reutiliza otras bases del equipo. `npm run db:down` detiene PostgreSQL y conserva el volumen.

Las variables de inicialización sólo se aplican al crear un volumen vacío. Para modificar contraseñas en una base existente hay que modificar el rol y actualizar las conexiones; editar el archivo env no cambia la contraseña guardada en PostgreSQL.

El script de inicialización activa la extensión `vector` en la base de aplicación y en `brote_test`. Lo hace con el usuario de inicialización; `brote` sigue siendo un rol sin privilegios de superusuario. La aplicación conserva sus funciones actuales; las búsquedas vectoriales se podrán incorporar en una fase posterior.

Si el volumen ya existía con PostgreSQL 18 sin pgvector, `npm run db:up` cambia la imagen conservando los datos. Después activa la extensión una vez en cada base:

```powershell
docker compose --env-file .env.local -f compose.dev.yaml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;"'
docker compose --env-file .env.local -f compose.dev.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d brote_test -c 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;'
```

En un despliegue Compose existente, ejecuta el primer comando sin `-f compose.dev.yaml`. Las actualizaciones futuras de pgvector se fijarán explícitamente en los tres Compose; al cambiar de versión de la extensión se deberá ejecutar también `ALTER EXTENSION vector UPDATE` con el usuario administrador en cada base.

Las migraciones activas están en `drizzle/postgresql`. `npm run db:generate` genera cambios futuros y `npm run db:migrate` los aplica explícitamente. El arranque comprueba la versión y no repara esquemas ni ejecuta migraciones automáticamente. La migración inicial contiene todos los campos y catálogos actuales; los catálogos se crean al crear un proyecto. No se vuelve a sembrar un proyecto existente.

La compilación (`npm run build`) no requiere una base disponible. La ejecución sí requiere una conexión y un esquema actualizado.

## Acceso y configuración inicial

Completa en `.env.local` las variables documentadas en `.env.example`: URL pública, secreto de Better Auth, credenciales OAuth de Google y GitHub y credenciales de Resend. Los secretos se utilizan únicamente en el servidor. Sin credenciales de un proveedor, su botón no se muestra; la compilación no requiere secretos reales.

Configura los callbacks autorizados de las aplicaciones OAuth:

- Google: `http://localhost:5010/api/auth/callback/google`.
- GitHub: `http://localhost:5010/api/auth/callback/github`. Usa una OAuth App con acceso al correo (`user:email`).

En producción sustituye localhost por la URL HTTPS configurada en `BETTER_AUTH_URL`. Usa un secreto aleatorio de al menos 32 caracteres; el comando para generarlo está en `.env.example`.

La primera cuenta que complete el acceso será administradora. Después, las nuevas cuentas requieren una invitación válida para su correo verificado. Google y GitHub comparten el mismo usuario cuando coincide el correo verificado; no hay contraseñas ni registro público.

El administrador completa un asistente reanudable: primero crea el proyecto, opcionalmente con ejemplos de desarrollo de una aplicación web, y luego invita a su equipo o termina sin invitaciones. Los ejemplos nunca se cargan automáticamente ni crean usuarios ficticios. El asistente no reaparece al eliminar todos los proyectos.

Desde **Usuarios e invitaciones**, el administrador puede invitar, copiar enlaces, reenviar y revocar. Las invitaciones duran siete días y permiten seleccionar proyectos iniciales. Reenviar genera un enlace nuevo e invalida el anterior. Resend necesita una API key y un remitente de un dominio verificado. Si falta configuración o falla el correo, la invitación sigue disponible para copiar y reenviar.

Cada proyecto pertenece a su creador. Solo el administrador puede cambiar el propietario; el anterior conserva participación. El propietario y el administrador administran el proyecto, sus catálogos y sus participantes registrados. Los participantes trabajan en módulos, features, tareas, checklists y comentarios. El administrador tiene acceso global y es el único que gestiona los respaldos. El resto solo ve sus proyectos y aquellos en los que participa.

El menú de usuario del pie del sidebar reúne **Mi perfil**, **Importar Trello**, **Configuración** y **Cerrar sesión**. Añade las opciones administrativas según los permisos. El perfil muestra los datos del proveedor, el rol y la fecha de registro, con enlaces para gestionar Google o GitHub; no edita la identidad localmente.

## Producción: Vercel + Dokploy + S3

- La aplicación Next.js (interfaz, autenticación y API) se ejecuta en **Vercel**, workspace **siemprenet**, dominio **https://tareas.siempre.net.co**.
- PostgreSQL con pgvector se ejecuta en **Dokploy**, con volumen persistente y conexión TLS verificada desde Vercel.
- Los respaldos usan la interfaz `BackupStorage` y su adaptador S3, configurable para **Cloudflare R2** o **Backblaze B2**. Desarrollo conserva archivos locales por defecto.
- Los push a **`dev` no despliegan**. `main` es la rama de producción prevista; `vercel.json` habilita despliegues automáticos únicamente para `main`.

La [guía de despliegue](docs/despliegue-vercel-dokploy.md) reúne variables, certificados, bucket/CORS, migraciones, DNS y las tareas de cada responsable. `.env.production.example` corresponde a Vercel y `.env.dokploy.example` a PostgreSQL. Ninguno contiene credenciales reales.

`npm run prepare:dokploy` prepara únicamente el Compose de PostgreSQL. El antiguo comando `node scripts/deploy-dokploy.mjs deploy` se ha retirado. La preparación no llama a Vercel ni a Dokploy y no publica nada.

## Docker Compose completo (alternativa local)

Prepara `.env.local` o un archivo de entorno específico de producción con secretos propios, URL pública HTTPS y proveedores OAuth. Luego:

```powershell
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d --build --wait
```

El Compose incluye `postgres`, `migrate` y `brote`: espera el healthcheck de PostgreSQL y la finalización correcta de las migraciones antes de iniciar la web. Un error de migración bloquea el arranque. Las migraciones tienen una imagen independiente con su ejecutable y dependencias, sin necesitar archivos del equipo al ejecutarse.

PostgreSQL no publica puertos. La aplicación conecta al servicio `postgres:5432`; el puerto web es 5010. El volumen `brote-postgres` se monta en `/var/lib/postgresql` (ubicación de la imagen oficial a partir de PostgreSQL 18). `brote-backups` conserva los respaldos en `/app/backups`. `docker compose down` conserva ambos volúmenes; `down -v` los elimina y no forma parte del procedimiento normal.

`/api/health` responde 200 sólo si la conexión y el esquema están disponibles; de lo contrario responde 503. Las escrituras se serializan inicialmente mediante un bloqueo transaccional de PostgreSQL, también entre procesos. Las lecturas de espacios y respaldos usan snapshots consistentes. El despliegue incluye una instancia web y un volumen compartido de respaldos.

La primera cuenta que acceda a la base nueva será administradora y realizará el asistente inicial.

## Uso

- Cambia de proyecto desde el selector desplegable en la parte superior del sidebar. Muestra el icono y nombre del proyecto actual y permite crear uno nuevo con «Nuevo proyecto». Puedes navegar por las opciones con el teclado o escribir el nombre para saltar a un proyecto. Cada proyecto tiene su propia URL `/projects/<projectId>`; puedes abrirla directamente, recargarla y usar Atrás/Adelante. `/` abre el primer proyecto disponible o la pantalla de creación si el espacio está vacío. Los enlaces antiguos `/?project=<id>` redirigen a la nueva ruta; un identificador inexistente muestra una página 404.
- La barra superior reúne las vistas, la búsqueda y el filtro por estados. El filtro permite marcar varios estados sin cerrar el menú y muestra las tareas de cualquiera de ellos en las tres vistas. La selección se guarda por proyecto en este navegador y se recupera al recargar, cambiar de proyecto o volver del detalle de una tarea. «Todos los estados» o «Limpiar filtros» restablecen la vista completa; desmarcar el último estado también muestra todos. Crea tareas desde el «+» de una columna, la lista o un espacio del calendario. La creación abre un modal con título, descripción y propiedades. **Crear** es la acción por defecto y cierra el modal; **Crear y editar** abre el detalle de la tarea guardada. Las etiquetas, checklists y comentarios se añaden desde ese detalle. El menú de tres puntos permite editar el proyecto, consultar su descripción y acceder a las tareas archivadas.
- El dropdown «Nuevo» de la barra lateral permite crear módulos, features y tareas. Para crear una tarea se elige su tipo; el modal permite elegir la feature. Al crear una feature se debe elegir su módulo, incluido **General**. Al editarla, las flechas permiten subirla o bajarla dentro de su módulo y guardan el orden al pulsarlas, igual que en los módulos. «Todas las features» reúne las tareas del proyecto; selecciona una para concentrarte en ella.
- «Nuevo → Módulo» permite añadir módulos con nombre y descripción. Cada módulo es una sección contraíble, expandida por defecto, con código de al menos dos dígitos (01, 02, …). Su menú permite editarlo, cambiar el orden con las flechas o eliminarlo; al eliminar un módulo, sus features pasan a General y conservan sus tareas.
- Usa «Buscar features…» para filtrar por número, nombre o descripción de la feature o su módulo, sin distinguir mayúsculas ni tildes. Los resultados se expanden al buscar. La selección se resalta con fondo y una marca lateral. Las features tienen números de al menos dos dígitos (01, 02, …), independientes por módulo y por proyecto; General tiene su propia secuencia. El número se guarda en PostgreSQL y se conserva al editar, fijar o reordenar. Al crear una feature o cambiarla de módulo recibe el primer número libre del destino desde 01, reutilizando los huecos. Al eliminar un módulo, sus features reciben números libres de General. La chincheta añade un acceso en el grupo superior de fijadas: admite hasta **5 por proyecto**, guardadas en PostgreSQL. Desfija una para liberar espacio. Arrastra una fila para reordenar dentro de su módulo o entre las fijadas; la búsqueda conserva la posición de las features ocultas. También puedes reordenar con Espacio y las flechas.
- En pantallas de hasta 800 px, el sidebar permanece oculto y el botón de menú superior abre un panel flotante con nombres, búsqueda y acciones completas. Se cierra con la X, Escape, al tocar fuera o al seleccionar una feature o proyecto. En escritorio, pasar el puntero por el borde ilumina una línea verde y muestra una flecha para contraerlo a media altura, sin desplazar las features ni reducir el ancho del selector de proyectos. Con el sidebar oculto, el borde izquierdo de la pantalla permite expandirlo con un clic y muestra la flecha al pasar el puntero. Los controles también aparecen al enfocarlos con el teclado y están disponibles en el detalle de una tarea. Conserva su ancho ajustable y recuerda la preferencia en este navegador.
- El tablero es la vista inicial. Arrastra una tarjeta desde cualquier punto para cambiarla de columna o reordenarla. El puntero determina la columna destino y la mitad superior o inferior de una tarjeta determina la inserción antes o después; los huecos entre columnas y el exterior del tablero cancelan el drop. Un clic o Enter abre su detalle. Con el teclado, enfoca la tarjeta y pulsa Espacio, flechas y Espacio para moverla; Escape cancela. En pantallas táctiles, mantén pulsada la tarjeta un instante para arrastrarla; deslizar normalmente permite recorrer la lista.
- El tablero ocupa el área disponible, con una separación izquierda que alinea la primera columna con el selector de vistas (12 px; 8 px en pantallas pequeñas). El tablero conserva margen a ambos lados y reparte el ancho entre un número entero de columnas visibles. Cuando hay más estados, el desplazamiento se alinea por columnas completas; durante un arrastre se permite el desplazamiento libre y se recupera la alineación al soltar. Las columnas usan 280 px como ancho mínimo de referencia (se ajustan en pantallas más estrechas), cabecera fija con un botón «+» para crear tareas, y desplazamiento vertical independiente para sus tarjetas, sin barra visible. La barra horizontal también está oculta: usa **Ctrl + rueda** sobre el tablero para recorrer los estados. También funcionan el gesto horizontal del trackpad y el deslizamiento táctil; con el tablero enfocado, las flechas izquierda/derecha avanzan una columna y las teclas Inicio/Fin van a los extremos. El fondo del sidebar cubre todo su espacio; solo los controles tienen separación interior.
- La lista agrupa las tareas por feature y muestra estado, prioridad y fecha. La búsqueda encuentra texto en título, descripción y etiquetas; el filtro por estado funciona en las tres vistas.
- El calendario permite alternar entre **Mes** y **Semana**. El mes se ajusta al alto disponible; «+N más» abre las tareas que no caben en una celda. La semana muestra las 24 horas con desplazamiento dentro del calendario, encabezados fijos y una fila de «Todo el día» para tareas sin hora. Las tareas que coinciden en horario se muestran lado a lado.
- Haz clic en el espacio libre de un día para crear una tarea con esa fecha; en la semana, haz clic en una franja de media hora para completar también la hora. «Tareas sin fecha» abre el listado de tareas pendientes de programar.
- Cada tarea tiene una página propia en `/projects/<projectId>/tasks/<taskId>` y un botón para volver al tablero. **Guardar cambios** está en la esquina superior derecha, junto a Archivar y Eliminar; un punto amarillo indica cambios pendientes. La descripción empieza con un cuarto del alto disponible y crece automáticamente con su contenido hasta la mitad, tanto al leer como al editar; solo aparece scroll si el contenido supera ese máximo. Las pestañas aprovechan todo el espacio restante y alternar entre **Propiedades**, **Checklist** e **Historial** no modifica la altura de la descripción. Los controles de Propiedades se alinean en dos filas: feature, estado y prioridad; inicio y entrega. En pantallas pequeñas se adaptan al ancho disponible.
- El título se edita directamente y se guarda al pulsar Enter o salir del campo; Escape cancela la edición. Las etiquetas con selección múltiple y búsqueda están debajo del título, antes de la descripción. Haz clic en el texto para editar la descripción con títulos, negrita, cursiva, listas, citas, código y enlaces; con el teclado, enfoca la descripción y pulsa Enter o F2. Al terminar o hacer clic fuera, se muestra el contenido renderizado sin un textarea. El formato se guarda con el botón de la cabecera y se conserva en Markdown; abrir y cerrar el editor no marca cambios.
- Los comentarios llegan hasta el borde derecho; en móvil se abren con **Chat**. El historial de mensajes tiene desplazamiento y el composer permanece fijo abajo; Enter envía y Mayús + Enter inserta una nueva línea. Las horas corresponden a la hora local del calendario y se guardan sin conversión de zona horaria. El archivo es independiente del estado «Terminado» y conserva la vista seleccionada (tablero, lista o calendario), incluido el periodo y el desplazamiento del calendario semanal. Abre una tarea archivada para restaurarla.
- Al crear o editar una tarea, **Feature** es un combobox con búsqueda por nombre, descripción, código o módulo, sin distinguir mayúsculas ni tildes. Agrupa las opciones en **General** y los módulos del proyecto, mostrando el número de cada feature dentro de su módulo. Usa las flechas y Enter para seleccionar con el teclado.
- **Estado, Prioridad, Tipo e Impacto** son comboboxes con búsqueda, navegación con flechas y selección con Enter. Muestran el color tanto en las opciones como en el valor seleccionado. Tipo e Impacto conservan las opciones **Sin tipo** y **Sin impacto**.
- **Ticket** es un campo de texto opcional al crear o editar una tarea. Conserva ceros iniciales y admite referencias como `ABC-001234`; puede quitarse dejando el campo vacío. La búsqueda general también encuentra por ticket, sin distinguir mayúsculas, en tablero, lista, calendario y tareas archivadas. El ticket se incluye en los respaldos.
- **Historial** muestra la fecha de última actualización de la tarea y los cambios de estado más recientes primero, con fecha y hora de Bogotá y los estados anterior y nuevo. Se registra tanto al guardar desde el detalle como al mover una tarjeta entre columnas, sin duplicar entradas al guardar el mismo estado o reordenar en una columna. Conserva los nombres y colores que tenían los estados al cambiar.
- Un separador encima de «Importar Trello» delimita las acciones del pie del sidebar. **Configuración** abre un modal con dos grupos: **Proyecto** (Estados, Prioridades y Etiquetas) y **Global** (Apariencia). Los encabezados y formularios de creación permanecen fijos: solo se desplazan las listas de estados, prioridades y etiquetas. El tema se recuerda en este navegador y Sistema sigue los cambios del dispositivo. Estados permite añadir, renombrar, colorear, reordenar y eliminar estados por proyecto. Marca los que cuentan como finalizados para identificar las tareas completadas. Para eliminar un estado hay que mover antes sus tareas, incluidas las archivadas. Siempre queda al menos un estado.
- En Configuración puedes crear, renombrar y colorear prioridades y etiquetas. Las prioridades en uso, incluidas las de tareas archivadas, no se eliminan. Renombrar una etiqueta actualiza sus tareas; eliminarla la retira de ellas.
- **Configuración → Proyecto → Tipos / Impactos** permite crear, renombrar, colorear y eliminar opciones de cada catálogo. Solo el propietario y el administrador pueden configurarlos. Tipo e Impacto se eligen al crear o editar una tarea y pueden volver a **Sin tipo** y **Sin impacto**. No se pueden eliminar opciones usadas por tareas, incluidas las archivadas; los catálogos opcionales pueden quedar vacíos. Ambos valores se muestran en las tarjetas y en la lista y se incluyen en los respaldos.
- Los filtros de **estados, tipos e impactos** funcionan en tablero, lista y calendario, también con tareas archivadas. Cada categoría permite seleccionar varios valores y Tipo e Impacto incluyen **Sin tipo** y **Sin impacto**. Se muestran las tareas que coinciden con algún valor dentro de cada categoría y con todas las categorías activas. La selección se recuerda por proyecto en este navegador; **Limpiar filtros** restablece las tres categorías y la búsqueda.
- Cada tarea admite un solo checklist. Puedes renombrarlo y editar sus elementos, marcar pasos completados y consultar el porcentaje de progreso. El **+** junto a Eliminar abre el campo de nuevo ítem con foco; Enter lo guarda y oculta el campo, y Escape o la X cancelan. Solo se desplaza la lista de ítems: el encabezado, el progreso y el formulario, cuando está abierto, permanecen visibles. Los comentarios permiten añadir, editar y eliminar notas. El checklist, el historial de estados y los comentarios se guardan en PostgreSQL y se incluyen en los respaldos.
- La fecha y hora de inicio son opcionales. Con inicio y entrega, el calendario semanal muestra la duración real, recortada por día, y reparte el ancho cuando hay solapamientos. El mes muestra la tarea en todos los días que ocupa. Sin horas se considera un intervalo de días completos; una sola hora sin intervalo mantiene el bloque de 30 minutos. Una entrega a medianoche no ocupa el día siguiente. Se rechaza una entrega anterior o igual a un inicio con hora.
- Eliminar un proyecto o una feature elimina sus tareas y requiere confirmación. Las eliminaciones son permanentes.

## Importar desde Trello

1. En el tablero de Trello, abre **Imprimir y exportar → Exportar como JSON**.
2. En Brote, pulsa **Importar Trello** y selecciona el `.json` (hasta 12 MB, 10.000 tarjetas y 200 listas).
3. Revisa el resumen y elige crear un proyecto o importar al proyecto actual.

Cada lista se convierte en un estado, reutilizando nombres existentes sin distinguir mayúsculas. Las tarjetas se agrupan en una feature con el nombre del tablero. Se conservan títulos, descripciones, fechas de entrega (día UTC de la fecha de Trello), etiquetas y archivo; las tarjetas de listas archivadas también quedan archivadas. Las listas importadas no se marcan automáticamente como finalizadas: puedes hacerlo en Configuración → Estados.

La importación es transaccional. Volver a importar el mismo tablero **en el mismo proyecto** omite las tarjetas con identificadores ya importados y no sobrescribe cambios locales. Adjuntos, comentarios, miembros y checklists no se importan. No requiere credenciales ni conexión a la API de Trello.

Referencia: [Exportar datos desde Trello](https://support.atlassian.com/trello/docs/exporting-data-from-trello/).

## Respaldo y restauración

El administrador conserva el panel **Respaldo**: permite listar, generar, descargar, eliminar y restaurar desde una copia del servidor o un archivo adjunto.

- Formato: `.brote-backup.json`, con identificador `brote-backup`, versión 1, fecha y una lista explícita de tablas.
- Incluye usuarios, cuentas OAuth vinculadas, propietarios, participantes, configuración inicial, invitaciones y todos los datos de negocio, incluidas tareas archivadas, comentarios, checklist e historial.
- Excluye sesiones, verificaciones temporales y metadatos de migraciones. El archivo puede contener información sensible de las cuentas y debe conservarse protegido.
- La exportación lee un snapshot consistente y la carpeta se configura con `BACKUP_DIR`.
- La restauración exige escribir **RESTAURAR**, admite hasta 100 MB y mantiene activada por defecto la copia previa. Si esta copia falla, no cambia ningún dato.
- Se validan versión, tablas, columnas, tipos, unicidad, administrador y referencias antes de modificar datos. El archivo contiene datos: no se ejecuta SQL procedente de él.
- La sustitución completa y el reajuste de identidad del historial se confirman en una transacción. Una restauración fallida conserva el estado anterior.
- Las operaciones de respaldo se coordinan entre procesos. Durante la restauración se rechazan nuevas escrituras con estado 409. Las lecturas ven un estado consistente.
- Se invalidan las sesiones y se revocan las invitaciones pendientes al restaurar. Accede de nuevo con una cuenta incluida en el respaldo.

Los archivos `.sqlite` anteriores se rechazan con un mensaje de incompatibilidad. Se conservan como respaldo de la edición anterior; esta fase no los convierte. La futura importación de la edición personal será una función diferente.

La instalación mantiene el modelo actual de usuarios globales y permisos por proyecto; esta fase no incorpora organizaciones independientes.

### Respaldos operativos PostgreSQL

Estos comandos se ejecutan sobre un despliegue propio; no forman parte del panel. Exportan una copia nativa dentro del contenedor y luego la copian al equipo, evitando redirigir archivos binarios con PowerShell:

```powershell
docker compose --env-file .env.local exec -T postgres sh -c 'PGPASSWORD="$BROTE_DB_PASSWORD" pg_dump -h 127.0.0.1 -U brote -d "$POSTGRES_DB" -Fc -f /tmp/brote.dump'
docker compose --env-file .env.local cp postgres:/tmp/brote.dump ./brote.dump
```

Para recuperar una copia nativa de confianza, detén la aplicación y usa las herramientas de la misma versión PostgreSQL. La restauración operativa usa el usuario de inicialización para recrear `vector` y conservar los propietarios y permisos del respaldo; el rol `brote` debe existir, como sucede tras ejecutar el script de inicialización:

```powershell
docker compose --env-file .env.local stop brote
docker compose --env-file .env.local cp ./brote.dump postgres:/tmp/brote.dump
docker compose --env-file .env.local exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U postgres -d "$POSTGRES_DB" --clean --if-exists --exit-on-error --single-transaction /tmp/brote.dump'
docker compose --env-file .env.local up -d --wait
```

`pg_dump` incluye las sesiones; antes de reabrir acceso tras una restauración operativa invalida sesiones y verificaciones y revoca invitaciones pendientes. El panel de Brote realiza esa invalidación automáticamente.

## Arquitectura y comprobaciones

- La interfaz conserva sus contratos y tipos de negocio. `PostgresRepository` implementa los comandos y consultas mediante Drizzle y un pool `pg`.
- La autenticación, las invitaciones y el asistente comparten las transacciones y los bloqueos del repositorio.
- `GET/POST /api/workspace` conserva sus respuestas. Las rutas `/api/backup`, `/api/backups`, `/api/backups/<id>` y `/api/backups/restore` conservan sus operaciones y parámetros; los archivos usan el nuevo formato JSON.
- Las migraciones SQLite se conservan en `drizzle/legacy-sqlite` como referencia histórica, sin ejecutarse.

```powershell
npm run db:up
npm run db:migrate
npm test
npm run typecheck
npm run build
npm run test:http
```

Las pruebas persistentes exigen `TEST_DATABASE_URL` apuntando a una base dedicada cuyo nombre termine en `_test`, diferente de `DATABASE_URL`. Crean un esquema único por fixture, usan pools limitados y eliminan exclusivamente esos esquemas al terminar. La prueba HTTP levanta su propio servidor y su propio esquema; no utiliza la base de desarrollo ni una sesión real del usuario.

Se comprueban CRUD, permisos, OAuth, invitaciones, asistente, numeración, concurrencia entre instancias, ordenamientos, archivo, catálogos, calendario, checklist, comentarios e historial. Los respaldos cubren corrupción, restauración, copia previa, rollback, secuencias e invalidación de acceso. También se comprueban instalación vacía, idempotencia de migraciones y healthcheck.

## Reversión

1. Conserva la versión de código anterior, sus archivos `data/*.sqlite`, sus respaldos y el volumen Docker SQLite anterior. Esta migración no los modifica ni elimina.
2. Antes de sustituir un despliegue PostgreSQL en uso, detén sus escrituras y guarda un respaldo de aplicación y uno operativo.
3. Ejecuta la versión SQLite anterior en un checkout separado y con su configuración y volumen originales. Detén primero la web PostgreSQL si ambos usan el puerto 5010.
4. Comprueba el acceso y los datos anteriores. Los datos creados después del cambio a PostgreSQL permanecen en sus respaldos y volumen PostgreSQL: no existe una conversión inversa automática.

El código nuevo comienza vacío en PostgreSQL; volver al código anterior no convierte ni copia datos entre motores. La fase de estabilización debe completarse antes de un despliegue remoto real.
