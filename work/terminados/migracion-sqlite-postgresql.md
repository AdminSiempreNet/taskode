# Migración de SQLite a PostgreSQL

Fecha de decisión: 16 de octubre de 2026.

Actualización de alojamiento: la preparación Vercel + Dokploy (hoy [docs/despliegue.md](../../docs/despliegue.md), solo Dokploy) sustituye el alojamiento completo en Compose descrito abajo. La aplicación y su API irán en Vercel, PostgreSQL en Dokploy y los respaldos en S3 compatible (R2 o Backblaze B2). Desarrollo continúa con Next.js local y PostgreSQL en Docker Desktop.

## Contexto y alternativas

Taskode comparte una interfaz de gestión de proyectos, módulos, features y tareas.
Se evaluaron las siguientes alternativas para ofrecerlo a desarrolladores
individuales y equipos:

| Alternativa | Decisión |
| --- | --- |
| Sustituir SQLite por PostgreSQL en la web | Adoptada para la fase 1 |
| Elegir SQLite o PostgreSQL mediante variables de entorno | Pospuesta: el servidor web tendrá un único motor activo |
| Escritorio con SQLite y sincronización bidireccional | Fuera del alcance: introduce colas, conflictos y reconciliación |
| Escritorio siempre conectado al servidor | Fase 2; comparte cuentas, permisos y datos con la web |
| Escritorio independiente, monousuario y con SQLite | Fase 3; funciona sin internet ni cuenta cloud |
| Exportar el espacio personal e importarlo en el servidor | Función futura de transición de la edición personal a equipos |
| SQLite como caché del escritorio conectado | Opcional y descartable; no habilita edición sin conexión |

## Decisiones de la fase 1

- PostgreSQL es el único almacenamiento activo de la aplicación web.
- Se comienza con una base vacía. No se trasladan datos, cuentas ni sesiones de
  SQLite. Los archivos y volúmenes anteriores se conservan intactos.
- Se mantienen la interfaz, las funciones y los permisos actuales. La creación
  de organizaciones y nuevos modelos de aislamiento requiere otra fase.
- PostgreSQL 18 con pgvector se ejecuta en Docker Desktop durante el desarrollo.
  Se usa `pgvector/pgvector:0.8.7-pg18-bookworm` en los tres Compose: la última
  versión estable de pgvector verificada para este cambio, con PostgreSQL 18.6.
  Next.js continúa ejecutándose en el equipo con Fast Refresh.
- El despliegue usa Docker Compose: base saludable, migraciones completadas y,
  finalmente, aplicación. La base no publica un puerto en producción.
- Se conserva el panel de respaldos con un formato JSON versionado, validado
  y propio de Taskode. Las copias SQLite anteriores no son restaurables desde
  este panel. `pg_dump` y `pg_restore` complementan los respaldos de aplicación
  como herramientas operativas.
- La aplicación conserva un repositorio común, tipos y reglas de negocio
  reutilizables. La compatibilidad futura con SQLite no implica mantener dos
  implementaciones activas en esta fase.
- La imagen de pgvector sustituye a `postgres:18.6-bookworm`, conservando la
  versión mayor de PostgreSQL, Bookworm y el volumen existente. La extensión
  `vector` se activa mediante el usuario de inicialización; el rol de aplicación
  permanece sin privilegios de superusuario. No se añaden columnas vectoriales
  ni funciones de búsqueda semántica en esta fase.

## Fases posteriores

1. Estabilizar PostgreSQL, autenticación, respaldos, pruebas y despliegue.
2. Publicar un cliente Tauri conectado por HTTPS a la web. La sesión y las
   preferencias pueden persistirse localmente; los datos de trabajo residen
   en el servidor. No hay edición ni sincronización sin conexión.
3. Publicar la edición personal totalmente local con SQLite. Añadir una
   exportación de datos de negocio y una importación al servidor para formar
   equipo. Las copias local y cloud serán independientes después del traslado.

La migración PostgreSQL no implementa Tauri, sincronización ni importación de
archivos SQLite. El despliegue remoto se realiza sólo por instrucción expresa.

## Implementación y validación de la fase 1

- `PostgresRepository` y Better Auth usan PostgreSQL con un pool `pg` y
  contexto transaccional compartido. Las escrituras y restauraciones se
  coordinan mediante bloqueos advisory entre procesos.
- Las migraciones activas están en `drizzle/postgresql`; las anteriores se
  archivaron intactas en `drizzle/legacy-sqlite`. Las migraciones se ejecutan
  explícitamente y el servidor verifica la versión antes de atender datos.
- Los respaldos de aplicación usan `.taskode-backup.json`, versión 1, con
  validación de estructura, tipos, unicidad y referencias. La restauración es
  transaccional y conserva la copia previa, la confirmación y la invalidación
  de sesiones e invitaciones pendientes.
- Se verificaron 71 pruebas unitarias y de integración con PostgreSQL real y
  8 pruebas HTTP sobre el servidor de producción, además de TypeScript y la
  compilación de Next.js en el equipo y en Docker.
- Se comprobó el arranque completo de Compose desde volúmenes nuevos, las
  migraciones repetidas, la persistencia al recrear contenedores y la
  recuperación del healthcheck tras interrumpir PostgreSQL. Un fallo provocado
  de las migraciones impidió iniciar la web, según lo previsto. La compilación
  de las imágenes no requiere conexión ni credenciales de una base.
- Se revisaron visualmente tablero, lista, calendario, detalle de tarea y
  respaldos en escritorio y móvil. Se generó, descargó y restauró una copia
  desde la interfaz, comprobando la copia previa y el nuevo inicio de sesión.
- Se comprobó también la exportación con `pg_dump` y la recuperación con
  `pg_restore` dentro del contenedor, conservando propietarios y permisos.
- La actualización posterior a pgvector 0.8.7 conservó el volumen y los datos
  de desarrollo existentes. Se activó `vector` en las bases de aplicación y
  pruebas, se verificó una operación vectorial con el rol no superusuario y
  volvieron a pasar las 71 pruebas de integración/unitarias y las 8 HTTP.
- Con pgvector se repitieron la instalación nueva en Compose y el respaldo
  operativo. Su restauración usa ahora el usuario de inicialización para
  recrear la extensión y conservar propietarios y permisos de la aplicación.

La instalación inicial se validó con una base vacía. Los archivos y volúmenes SQLite
anteriores no se han modificado. Los artefactos de Dokploy están preparados;
el despliegue remoto sigue pendiente de una instrucción posterior.

## Referencias

- [PostgreSQL y Drizzle](https://orm.drizzle.team/docs/get-started-postgresql).
- [Adaptador Drizzle de Better Auth](https://better-auth.com/docs/adapters/drizzle).
- [Imagen oficial PostgreSQL](https://hub.docker.com/_/postgres).
- [pgvector: imagen Docker y versiones disponibles](https://github.com/pgvector/pgvector#docker).
- [Orden de arranque en Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/).
- [Node como proceso auxiliar de Tauri](https://v2.tauri.app/learn/sidecar-nodejs/).

Las instrucciones de instalación, respaldos y reversión se mantienen en el
README del proyecto.
