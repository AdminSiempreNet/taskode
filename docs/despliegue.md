# Despliegue de producción

La aplicación se ejecuta en **Dokploy** (`https://server.eduinpro.net`), proyecto
**SiempreNet → production**, como la aplicación `taskode-web`, con el dominio
**https://taskode.siempre.net.co**. En el mismo proyecto están PostgreSQL
(`taskode-db`) y el programador de notificaciones (`taskode-notifications`).
GitHub Actions construye la imagen y la publica en
`ghcr.io/adminsiemprenet/taskode`; Dokploy no compila nada, solo descarga la imagen.
Solo `main` despliega; `dev` y los pull requests construyen la imagen sin publicarla.

## Flujo

`.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `dev` y `main`:

1. **Tipos y pruebas**: `npm ci`, `npm run typecheck` y `npm test`, con un PostgreSQL
   pgvector desechable en el runner (`TEST_DATABASE_URL`).
2. **Imagen Docker**: construye el stage `runner` del `Dockerfile` para `linux/amd64`.
   En push a `main` la publica con los tags `sha-<commit>` y `main`.
3. **Desplegar en Dokploy** (solo push a `main`, tras los dos anteriores): llama a
   `.github/workflows/deploy.yml`, que fija `dockerImage` en la aplicación, solicita el
   despliegue, espera a que Dokploy lo marque `done` y comprueba `/api/health`.

Al arrancar, el contenedor ejecuta `scripts/docker-entrypoint.sh`:

1. Con `CHECK_PRODUCTION=true`, valida la configuración (`dist/check-production.cjs`,
   el mismo `scripts/check-production.ts` empaquetado). Si falla, termina sin migrar.
2. Aplica las migraciones pendientes y sus backfills SQL (`dist/migrate.cjs`). La
   migración toma un bloqueo asesor para serializar ejecuciones.
3. Inicia `node server.js` en el puerto 5010.

Swarm actualiza con `start-first` y rollback automático: el contenedor anterior sigue
atendiendo hasta que el nuevo supera el healthcheck de `/api/health`. Ese endpoint
comprueba la versión exacta del esquema, así que una configuración inválida o una
migración fallida nunca reciben tráfico. Una migración aplicada no se revierte: en
cuanto el esquema cambia, el contenedor anterior deja de estar sano hasta que el
nuevo lo reemplaza.

### Rollback

**Actions → Deploy → Run workflow**, con el tag `sha-<commit>` de una imagen anterior.
Solo es seguro si esa versión usa el mismo esquema; para volver a un esquema anterior
hay que seguir el procedimiento de recuperación.

### Configuración de GitHub

- Environment **production**, restringido a `main`:
  - Secret `DOKPLOY_API_KEY`: clave de API de Dokploy para Actions.
  - Variables `DOKPLOY_URL=https://server.eduinpro.net`, `DOKPLOY_APPLICATION_ID`
    (id de `taskode-web`) y `PUBLIC_URL=https://taskode.siempre.net.co`.
- Variable de repositorio `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: se incrusta en el JavaScript
  del cliente durante el build. Es pública; debe coincidir con la de Dokploy.
- El paquete GHCR se publica con el `GITHUB_TOKEN` del workflow. Dokploy lo descarga
  con un usuario y token de `AdminSiempreNet` con `read:packages`, guardados en la
  aplicación.

## Configuración

Las variables reales se guardan en **Dokploy → SiempreNet → production → taskode-web →
Environment**. `.env.production.example` enumera las variables; `.env.production.local`
es una copia privada opcional para operación local, ignorada por Git. No compartir la
base de producción con otros entornos.

- `CHECK_PRODUCTION=true` para validar al arrancar.
- `BETTER_AUTH_URL=https://taskode.siempre.net.co` y un `BETTER_AUTH_SECRET` estable
  de al menos 32 caracteres. Conservar el secreto existente para no invalidar acceso.
- Al menos un proveedor OAuth completo. Sus callbacks son
  `https://taskode.siempre.net.co/api/auth/callback/google` y
  `https://taskode.siempre.net.co/api/auth/callback/github`.
- `DATABASE_URL` apunta al endpoint TLS de PostgreSQL; `DATABASE_SSL=verify-full`,
  `DATABASE_SSL_CA` para la CA privada y `DATABASE_POOL_MAX` (10 por defecto; una sola
  instancia de larga vida). El hostname debe coincidir con el certificado. No añadir
  parámetros SSL a la URL ni desactivar la verificación TLS. El rol de aplicación
  necesita permisos para migrar sus tablas.
- `BACKUP_STORAGE=s3` y `ATTACHMENT_STORAGE=s3`, con las variables `S3_*` de la
  plantilla. El contenedor no tiene volúmenes: el almacenamiento local se perdería
  en cada despliegue. El bucket es privado y debe permitir CORS desde el dominio de
  producción para cargas y descargas directas.
- `ABLY_API_KEY` exclusiva de producción, con Publish y Subscribe para
  `taskode-production:*`; `ABLY_CHANNEL_NAMESPACE=taskode-production`.
- `RESEND_API_KEY` y `RESEND_FROM_EMAIL` con un remitente verificado.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT=https://taskode.siempre.net.co` y `NOTIFICATION_WORKER_SECRET`
  de al menos 32 caracteres. Solo la clave pública puede llegar al navegador.
  Conservar el par VAPID existente entre despliegues.
- MCP funciona con el mismo origen. `MCP_JWKS_URL=http://127.0.0.1:5010/api/auth/jwks`
  verifica tokens sin salir del contenedor. `MCP_ENABLED=false` lo desactiva;
  `MCP_ALLOWED_ORIGINS` solo admite orígenes HTTPS adicionales de clientes de navegador.

`npm run setup:notifications -- --production` genera VAPID y el secreto si faltan,
sin reemplazar los existentes. No crea la clave de Ably ni publica variables.
`npm run check:production` valida sin migrar ni conectarse a servicios. La operación
local puede leer valores de `.env.local` si faltan en los archivos de producción;
para verificar una configuración aislada, definir explícitamente las variables del
destino en el proceso o ejecutar en un checkout sin `.env.local`.

## Preparación de una versión

1. Incluir en Git el código, todos los SQL de `drizzle/postgresql` y sus metadatos.
   No editar migraciones ya aplicadas.
2. Ejecutar `npm test`, `npm run typecheck`, `npm run build`, `npm run test:http`
   y `npm run test:mcp:http`. Las pruebas de datos usan `TEST_DATABASE_URL`,
   con esquemas desechables, nunca la base de producción. El CI repite tipos y pruebas.
3. Probar las migraciones pendientes sobre una restauración aislada de producción.
4. Para un cambio de esquema incompatible, coordinar una ventana de mantenimiento y
   pausar el programador. El código anterior no debe continuar atendiendo tráfico con
   el esquema nuevo. Bloquear temporalmente el acceso externo antes del respaldo final
   y permitir terminar solicitudes activas.
5. Crear el respaldo final con `npm run db:backup:production`. Requiere Docker en
   el equipo operador y conexión TLS a PostgreSQL. Lee `.env.production.local`
   y variables del proceso, sin recurrir a `.env.local`. Genera un archivo binario
   `.dump` y un manifiesto SHA-256 en `data/backups/`, ignorados por Git. Copiarlos
   a almacenamiento privado fuera del equipo; conservar también el código anterior
   y los archivos físicos o versiones de objetos de S3.

El respaldo usa `pg_dump` de PostgreSQL 18, formato custom, con esquema y datos
de la aplicación. No incluye roles globales ni la configuración del servidor.
Verificar su integridad con el SHA-256 del manifiesto y `pg_restore --list`; una
restauración de ensayo es la comprobación necesaria antes de un cambio incompatible.

## Publicación

Hacer merge de la versión verificada de `dev` a `main` y `git push origin main`. El CI
publica la imagen y la despliega. Revisar el job **Desplegar en Dokploy** y los logs de
la aplicación en Dokploy, que deben mostrar «Migraciones PostgreSQL de Taskode
aplicadas.» antes de que Next.js arranque.

Las migraciones manuales usan `npm run db:migrate` con las variables de producción
explícitas; `-- --development` queda reservado para una base local. Repetir la
ejecución no vuelve a aplicar las entradas ya registradas. Nunca ejecutar semillas
de ejemplos en producción.

## Programador en Dokploy

`npm run prepare:dokploy` prepara `.dokploy/notifications.compose.yaml`, un Compose
independiente que contiene solo el programador (servicio `taskode-notifications`), con:

- `NOTIFICATION_PROCESS_URL=https://taskode.siempre.net.co/api/internal/notifications/process`.
- `NOTIFICATION_WORKER_SECRET` idéntico al de `taskode-web`.

El servicio usa Node 24, llama cada minuto por POST, rechaza redirecciones y no
necesita acceso a la base ni credenciales S3 o VAPID. Mantener intactos el Compose,
los certificados y los volúmenes del PostgreSQL existente. El `compose.yaml`
general es una alternativa de alojamiento local.

## Verificación y recuperación

- El job **Desplegar en Dokploy** termina en verde y Dokploy muestra el despliegue `done`.
- `GET /api/health` debe devolver 200 y `{"status":"ok"}`; valida conexión y esquema.
- Login y los callbacks OAuth deben usar el dominio canónico. Probar acceso,
  lectura/escritura y carga/descarga de un archivo con una cuenta autorizada.
- `/sw.js`, `/manifest.webmanifest` y los iconos PWA deben servirse correctamente.
- Las API privadas sin sesión deben rechazar acceso. Los metadatos MCP deben
  anunciar el origen de producción y `/api/mcp` debe exigir autorización.
- Reanudar o desplegar el programador y revisar `failed` y `pending`, además de
  su healthcheck. Un HTTP 200 del procesador puede contener entregas fallidas.
- Probar push en un dispositivo real. En iPhone/iPad debe estar instalada en la
  pantalla de inicio; las pruebas de navegador simulan permisos y recepción.
- Retirar la protección temporal de mantenimiento tras verificar la versión.

Volver a una imagen anterior no revierte PostgreSQL. Para una migración
incompatible, mantener el mantenimiento, detener procesos, restaurar el snapshot
previo mediante `pg_restore` y recuperar los archivos asociados y la imagen
anterior. Preparar y ensayar la restauración con los permisos adecuados; preservar
la extensión `vector` y la configuración TLS del servidor. Un JSON de respaldo
de la aplicación restaura datos sobre el esquema actual y no deshace migraciones.

## Infraestructura existente

PostgreSQL está en `dbtaskode.siempre.net.co:5440`, con base y rol `taskode`,
imagen `pgvector/pgvector:0.8.7-pg18-bookworm` y extensión `vector` activada.
La CA privada se carga como certificado en `DATABASE_SSL_CA`; su clave privada
permanece fuera de Dokploy. El certificado del servidor debe incluir ese hostname.
PostgreSQL usa sus propios certificados TLS, independientes del HTTPS de la web.

Conservar el servicio `taskode-db`, el nombre físico de su volumen y sus montajes
de certificados. Las variables de inicialización solo crean usuarios sobre un
volumen vacío; no cambian la contraseña de un rol existente. No ejecutar `down -v`.
Las referencias históricas `brote-dev` del entorno local identifican recursos
existentes y no deben renombrarse mediante sustituciones de texto.

El puerto de PostgreSQL es TCP, sin proxy HTTP/Traefik, y solo acepta conexiones
con TLS verificado. El rol de aplicación no es superusuario. Renovar los certificados
antes de que expiren y mantener la clave del servidor legible por PostgreSQL con
permisos adecuados, montada en solo lectura.

Reservar conexiones para administración y migraciones; durante un despliegue
`start-first` conviven brevemente dos contenedores con su pool. Si se incorpora
PgBouncer, usar modo **session** por los bloqueos de sesión y el `search_path` del
proyecto.

El bucket S3/R2 es privado, con credenciales limitadas para listar, leer, escribir
y borrar objetos. El prefijo de esta instalación es `taskode/production/`; cambiar
el proveedor o el prefijo no mueve los objetos existentes. Su regla CORS permite
el origen `https://taskode.siempre.net.co`, métodos `GET`, `PUT` y `HEAD`, todos
los encabezados de solicitud y exposición de `ETag`.

Los respaldos de aplicación van en `backups/`, las cargas temporales en `uploads/`,
los archivos en `attachments/` y los snapshots operativos en `release-snapshots/`,
siempre bajo el prefijo. Aplicar retención a los snapshots y limpieza de cargas
abandonadas; no borrar objetos definitivos usados por la aplicación. Conservar
versiones o copias de archivos si se requiere recuperar un momento anterior.

El DNS de `taskode.siempre.net.co` está en Cloudflare y apunta al servidor de Dokploy;
Traefik emite el certificado HTTPS con Let's Encrypt. Los callbacks OAuth deben
conservar el dominio canónico ya verificado.
