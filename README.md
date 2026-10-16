# Brote · Proyectos y tareas

Aplicación en español con Next.js, React, TypeScript, componentes shadcn/ui, fondos neutros y temas claro, oscuro y del sistema. Guarda los datos en SQLite mediante Drizzle ORM. El acceso usa Better Auth con Google y GitHub; el registro requiere invitación salvo para el primer administrador.

## Desarrollo local

No necesitas Docker ni una compilación de producción para desarrollar. Requiere Node.js **24 o posterior**. Drizzle usa SQLite local mediante libSQL; los respaldos utilizan la API nativa `node:sqlite`.

```powershell
npm ci
npm run dev
```

Abre **http://localhost:5010** y deja el proceso en ejecución. Los cambios en los componentes y estilos se reflejan automáticamente con Next.js Fast Refresh. `npm ci` solo es necesario al instalar el proyecto o cambiar las dependencias.

Si ya hay un contenedor usando el puerto 5010, detén ese servicio con `docker compose stop brote` antes de ejecutar `npm run dev`. Detén el servidor local con `Ctrl+C`. Para producción sin Docker: `npm run build` y `npm start`.

El archivo por defecto es `data/brote.sqlite`. Las migraciones versionadas de Drizzle se aplican automáticamente al abrir la base. También puedes ejecutarlas con `npm run db:migrate` y generar futuras migraciones con `npm run db:generate`.

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

## Ejecutar con Docker (opcional)

Con Docker Desktop y su motor Linux iniciados:

```powershell
docker compose up -d --build
```

Docker Compose carga las variables de `.env.local` y mantiene `DATABASE_PATH=/app/data/brote.sqlite` dentro del contenedor. Abre **http://localhost:5010**. El volumen `brote-data` conserva la base de datos al recrear el contenedor. `docker compose down` detiene la app y conserva ese volumen; no uses `down -v` si quieres conservar los datos. El archivo SQLite de desarrollo y el volumen Docker son independientes; puedes trasladar datos mediante un respaldo.

La imagen utiliza Node 24, una compilación Next.js standalone, un usuario sin privilegios y un healthcheck. El puerto interno y el publicado son **5010**.

## Despliegue en Dokploy

El proyecto **SiempreNet**, entorno **production**, contiene el servicio Compose **tareas** en [Dokploy](https://server.eduinpro.net/dashboard/project/BuobBokCir8Qcvw2rSInN/environment/fb29iaagt1aM2R0fwD4Oh/services/compose/pqfvH9IlEdtXcVZMT-KhC). La URL pública es **https://tareas.eduinpro.net**; Dokploy dirige el tráfico HTTPS al puerto interno 5010. `compose.dokploy.yaml` define las variables de ejecución y el volumen persistente `brote-data`, sin publicar puertos del servidor.

Para actualizar desde este equipo, con Node 24, Docker, Git, tar y la CLI de Dokploy instalada:

```powershell
node scripts/deploy-dokploy.mjs deploy
node scripts/deploy-dokploy.mjs status
node scripts/deploy-dokploy.mjs logs
```

El script lee `DOKPLOY_API_KEY` y las credenciales de la aplicación desde `.env.local`. Autentica el cliente de la CLI mediante variables de entorno del proceso y utiliza los endpoints REST de Dokploy. No guarda la clave en la configuración global ni la envía al contenedor. Solo transfiere las variables de aplicación indicadas en el Compose, con `BETTER_AUTH_URL=https://tareas.eduinpro.net` y `DATABASE_PATH=/app/data/brote.sqlite`.

Como este despliegue usa código local, el script empaqueta una lista explícita de archivos de aplicación, verifica su SHA-256 y los envía mediante File Mounts a `../files/build/<sha256>/`. Genera un Compose con `dockerfile_inline` que conserva las etapas del Dockerfile existente. Los archivos `.env`, bases locales, dependencias y pruebas quedan fuera del paquete. Los artefactos locales se guardan en `.dokploy/`, excluido de Git y de Docker. `prepare` permite generar y validar el paquete sin cambiar el servidor.

El DNS debe tener un registro **A**, nombre **tareas**, valor **147.93.3.216**. El dominio está configurado con HTTPS y Let's Encrypt. Configura en los proveedores OAuth los callbacks de producción:

- Google: `https://tareas.eduinpro.net/api/auth/callback/google`.
- GitHub: `https://tareas.eduinpro.net/api/auth/callback/github`.

La base de producción empieza vacía y se conserva entre despliegues mediante el volumen. La primera cuenta que acceda será administradora. Los datos de desarrollo pueden trasladarse desde la función de respaldos de la aplicación.

Consulta la [configuración de Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose) y su [gestión de dominios](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Uso

- Cambia de proyecto desde el selector desplegable en la parte superior del sidebar. Muestra el icono y nombre del proyecto actual y permite crear uno nuevo con «Nuevo proyecto». Puedes navegar por las opciones con el teclado o escribir el nombre para saltar a un proyecto. Cada proyecto tiene su propia URL `/projects/<projectId>`; puedes abrirla directamente, recargarla y usar Atrás/Adelante. `/` abre el primer proyecto disponible o la pantalla de creación si el espacio está vacío. Los enlaces antiguos `/?project=<id>` redirigen a la nueva ruta; un identificador inexistente muestra una página 404.
- La barra superior reúne las vistas, la búsqueda y el filtro por estados. El filtro permite marcar varios estados sin cerrar el menú y muestra las tareas de cualquiera de ellos en las tres vistas. La selección se guarda por proyecto en este navegador y se recupera al recargar, cambiar de proyecto o volver del detalle de una tarea. «Todos los estados» o «Limpiar filtros» restablecen la vista completa; desmarcar el último estado también muestra todos. Crea tareas desde el «+» de una columna, la lista o un espacio del calendario. La creación abre un modal con título, descripción y propiedades. **Crear** es la acción por defecto y cierra el modal; **Crear y editar** abre el detalle de la tarea guardada. Las etiquetas, checklists y comentarios se añaden desde ese detalle. El menú de tres puntos permite editar el proyecto, consultar su descripción y acceder a las tareas archivadas.
- Crea features con el «+» superior de la barra lateral. El módulo es opcional y se puede cambiar al editar la feature; sin módulo aparece en **General**. Al editarla, las flechas permiten subirla o bajarla dentro de su módulo y guardan el orden al pulsarlas, igual que en los módulos. «Todas las features» reúne las tareas del proyecto; selecciona una para concentrarte en ella.
- «Crear módulo», al final del listado, permite añadir módulos con nombre y descripción. Cada módulo es una sección contraíble, expandida por defecto, con código de al menos dos dígitos (01, 02, …). Su menú permite editarlo, cambiar el orden con las flechas o eliminarlo; al eliminar un módulo, sus features pasan a General y conservan sus tareas.
- Usa «Buscar features…» para filtrar por número, nombre o descripción de la feature o su módulo, sin distinguir mayúsculas ni tildes. Los resultados se expanden al buscar. La selección se resalta con fondo y una marca lateral. Las features tienen números de al menos dos dígitos (01, 02, …), independientes por módulo y por proyecto; General tiene su propia secuencia. El número se guarda en SQLite y se conserva al editar, fijar o reordenar. Al crear una feature o cambiarla de módulo recibe el primer número libre del destino desde 01, reutilizando los huecos. Al eliminar un módulo, sus features reciben números libres de General. La actualización renumera las features existentes según su orden dentro de cada módulo. La chincheta añade un acceso en el grupo superior de fijadas: admite hasta **5 por proyecto**, guardadas en SQLite. Desfija una para liberar espacio. Arrastra una fila para reordenar dentro de su módulo o entre las fijadas; la búsqueda conserva la posición de las features ocultas. También puedes reordenar con Espacio y las flechas.
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
- **Historial** muestra la fecha de última actualización de la tarea y los cambios de estado más recientes primero, con fecha y hora de Bogotá y los estados anterior y nuevo. Se registra tanto al guardar desde el detalle como al mover una tarjeta entre columnas, sin duplicar entradas al guardar el mismo estado o reordenar en una columna. Conserva los nombres y colores que tenían los estados al cambiar. El registro comienza con esta actualización; los cambios anteriores no se reconstruyen.
- Un separador encima de «Importar Trello» delimita las acciones del pie del sidebar. **Configuración** abre un modal con dos grupos: **Proyecto** (Estados, Prioridades y Etiquetas) y **Global** (Apariencia). Los encabezados y formularios de creación permanecen fijos: solo se desplazan las listas de estados, prioridades y etiquetas. El tema se recuerda en este navegador y Sistema sigue los cambios del dispositivo. Estados permite añadir, renombrar, colorear, reordenar y eliminar estados por proyecto. Marca los que cuentan como finalizados para identificar las tareas completadas. Para eliminar un estado hay que mover antes sus tareas, incluidas las archivadas. Siempre queda al menos un estado.
- En Configuración puedes crear, renombrar y colorear prioridades y etiquetas. Las prioridades en uso, incluidas las de tareas archivadas, no se eliminan. Renombrar una etiqueta actualiza sus tareas; eliminarla la retira de ellas.
- Cada tarea admite un solo checklist. Puedes renombrarlo y editar sus elementos, marcar pasos completados y consultar el porcentaje de progreso. El **+** junto a Eliminar abre el campo de nuevo ítem con foco; Enter lo guarda y oculta el campo, y Escape o la X cancelan. Solo se desplaza la lista de ítems: el encabezado, el progreso y el formulario, cuando está abierto, permanecen visibles. La actualización une las listas anteriores de cada tarea, conserva el título de la primera y todos los ítems con sus marcas de completado. Los comentarios permiten añadir, editar y eliminar notas. El checklist, el historial de estados y los comentarios se guardan en SQLite y se incluyen en los respaldos.
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

El botón **Respaldo** abre un modal con dos pestañas:

- **Copias de respaldo**: genera una copia SQLite en el servidor, muestra su fecha, tamaño y origen, y permite descargarla o eliminarla con confirmación. Las copias se conservan en la carpeta `backups` junto a `DATABASE_PATH` (por defecto `data/backups`); en Docker quedan dentro del volumen `brote-data`.
- **Restaurar**: permite seleccionar una copia del servidor o adjuntar una exportación SQLite de Brote de hasta 100 MB. Antes de restaurar hay que escribir exactamente **RESTAURAR**. La opción de crear un respaldo de los datos actuales viene activada por defecto; si esa copia falla, se cancela la restauración.

Cada respaldo incluye usuarios, cuentas OAuth, propiedad y participantes, estado del asistente y todos los proyectos, módulos, features, estados, prioridades, etiquetas y tareas (también las archivadas), con sus checklists, comentarios e historial de estados. Usa la API de respaldo de SQLite para incluir escrituras que todavía estén en el WAL.

La restauración comprueba la integridad, la estructura y las referencias del respaldo antes de modificar la base. Solo admite respaldos de esta versión con autenticación; los anteriores se rechazan. Tras restaurar, se invalidan todas las sesiones y las invitaciones pendientes; vuelve a acceder con una cuenta contenida en el respaldo. Los datos se reemplazan en una transacción sobre la conexión existente, sin sustituir el archivo SQLite en uso y sin reiniciar el servidor; si falla la transacción, se conservan los datos actuales. Al terminar, **Volver al espacio** recarga la aplicación con los datos recuperados. Las copias guardadas en el servidor se conservan después de restaurar.

No ejecutes dos instancias con archivos de base distintos si esperas que compartan datos. La configuración está orientada a una sola instancia con un volumen local.

La aplicación es single tenant: una instalación comparte usuarios y administración, con acceso separado por proyecto. Los permisos se comprueban en el servidor en cada consulta y comando.

## Arquitectura y comprobaciones

- `src/lib/types.ts`: modelos compartidos; `src/lib/validation.ts`: validación de comandos y exportaciones de Trello.
- `src/server/repository.ts`: contrato `WorkspaceRepository`, independiente de SQLite.
- `src/server/sqlite.ts`: implementación con Drizzle sobre SQLite, claves foráneas, transacciones e importación. `src/server/schema.ts` declara el esquema y `drizzle/` conserva las migraciones versionadas. Para usar otra base, implementa el contrato y sustituye la fábrica de `src/server/index.ts`.
- `GET /api/workspace`: datos; `POST /api/workspace`: comandos validados; `GET /api/backup`: descarga directa compatible con versiones anteriores.
- `GET/POST /api/backups`: listar y generar copias del servidor; `GET/DELETE /api/backups/<id>`: descargar y eliminar una copia; `POST /api/backups/restore`: restaurar desde una copia del servidor o un archivo adjunto, con confirmación y respaldo previo opcional.
- `src/components`: interfaz y componentes shadcn/ui. Los cambios se confirman en el servidor antes de actualizar la interfaz.

```powershell
npm test
npm run typecheck
npm run build
docker compose config --quiet
```

Con la app en ejecución en el puerto 5010, `npm run test:http` comprueba además las rutas HTTP, los archivos JS/CSS, el ciclo de vida completo de una tarea, la importación y la descarga del respaldo. Crea un proyecto temporal y lo elimina al terminar. `TEST_BASE_URL` permite usar otra URL.

Las pruebas cubren CRUD, límites entre proyectos, movimiento y orden, archivo, protección de estados, borrado en cascada, importación y duplicados, rollback, validación de fechas y horas, respaldo con WAL, persistencia al reiniciar, migración de bases anteriores y el límite de cinco features fijadas por proyecto. También comprueban meses bisiestos, semanas entre años, navegación y distribución de tareas con horarios superpuestos. Las pruebas HTTP comprueban rutas `/projects/<projectId>`, redirecciones, proyectos inexistentes o eliminados y conservación de horas en el archivo y el respaldo.

Las pruebas de respaldo también verifican restauración desde servidor y archivo adjunto, confirmación escrita, copia previa opcional, migración de copias antiguas, rechazo de archivos dañados o incompatibles, operaciones simultáneas y recuperación ante fallos sin perder datos.

Fuentes de implementación: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [shadcn/ui](https://ui.shadcn.com/docs/installation/next), [SQLite de Node.js](https://nodejs.org/api/sqlite.html), [Docker y Next.js](https://docs.docker.com/guides/nextjs/).
