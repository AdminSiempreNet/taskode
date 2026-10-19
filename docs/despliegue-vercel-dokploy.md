# Despliegue de producción

La aplicación está en el proyecto **siemprenet/tareas** de Vercel, con el dominio
**https://taskode.siempre.net.co**. PostgreSQL y el programador de notificaciones
se ejecutan en Dokploy. Solo `main` despliega automáticamente; `dev` no publica.

## Configuración

Usar Node.js 24 y `npm ci`. Las variables reales se guardan en **Vercel → tareas →
Settings → Environment Variables → Production**. `.env.production.example` enumera
las variables; `.env.production.local` es una copia privada opcional para operación
local, ignorada por Git. Las variables de Development o Preview no sustituyen las
de Production. No compartir la base de producción con Preview.

- `BETTER_AUTH_URL=https://taskode.siempre.net.co` y un `BETTER_AUTH_SECRET` estable
  de al menos 32 caracteres. Conservar el secreto existente para no invalidar acceso.
- Al menos un proveedor OAuth completo. Sus callbacks son
  `https://taskode.siempre.net.co/api/auth/callback/google` y
  `https://taskode.siempre.net.co/api/auth/callback/github`.
- `DATABASE_URL` apunta al PostgreSQL externo de Dokploy; `DATABASE_SSL=verify-full`,
  `DATABASE_SSL_CA` para la CA privada y `DATABASE_POOL_MAX=5`. El hostname debe
  coincidir con el certificado. No añadir parámetros SSL a la URL ni desactivar
  la verificación TLS. El rol de aplicación necesita permisos para migrar sus tablas.
- `BACKUP_STORAGE=s3` y `ATTACHMENT_STORAGE=s3`, con las variables `S3_*` de la
  plantilla. El bucket es privado y debe permitir CORS desde el dominio de producción
  para cargas y descargas directas. No usar almacenamiento local en Vercel.
- `ABLY_API_KEY` exclusiva de producción, con Publish y Subscribe para
  `taskode-production:*`; `ABLY_CHANNEL_NAMESPACE=taskode-production`.
- `RESEND_API_KEY` y `RESEND_FROM_EMAIL` con un remitente verificado.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT=https://taskode.siempre.net.co` y `NOTIFICATION_WORKER_SECRET`
  de al menos 32 caracteres. Solo la clave pública puede llegar al navegador.
  Conservar el par VAPID existente entre despliegues.
- MCP funciona con el mismo origen. `MCP_ENABLED=false` lo desactiva;
  `MCP_ALLOWED_ORIGINS` solo admite orígenes HTTPS adicionales de clientes de navegador.

`npm run setup:notifications -- --production` genera VAPID y el secreto si faltan,
sin reemplazar los existentes. No crea la clave de Ably ni publica variables.
`npm run check:production` valida sin migrar ni conectarse a servicios. La operación
local puede leer valores de `.env.local` si faltan en los archivos de producción;
para verificar una configuración aislada, definir explícitamente las variables del
destino en el proceso o ejecutar en un checkout sin `.env.local`.

## Preparación de una versión

1. Incluir en Git el código, todos los SQL de `drizzle/postgresql` y sus metadatos.
   No editar migraciones ya aplicadas. La versión actual llega a `0014_oauth_mcp`.
2. Ejecutar `npm test`, `npm run typecheck`, `npm run build`, `npm run test:http`
   y `npm run test:mcp:http`. Las pruebas de datos usan `TEST_DATABASE_URL`,
   con esquemas desechables, nunca la base de producción.
3. Probar las migraciones pendientes sobre una restauración aislada de producción.
4. Coordinar una ventana de mantenimiento y pausar el programador si ya existe.
   La aplicación comprueba la versión exacta del esquema: el código anterior no
   debe continuar atendiendo tráfico con el esquema nuevo. Bloquear temporalmente
   el acceso externo antes del respaldo final y permitir terminar solicitudes activas.
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

Hacer merge de la versión verificada a `main` y `git push origin main`.
Vercel ejecuta `npm run build:vercel` en este orden:

1. Validar variables de Production.
2. Compilar Next.js.
3. Ejecutar las migraciones pendientes mediante `npm run db:migrate`.
4. Publicar el resultado si todos los pasos terminaron correctamente.

Así una compilación fallida no cambia el esquema. La migración toma un bloqueo
asesor para serializar ejecuciones. Esto no detiene las escrituras de la web ni
convierte el cambio de esquema y la publicación en una única transacción.
Si falla la publicación después de migrar, mantener el mantenimiento y resolver
el despliegue o ejecutar el procedimiento de recuperación.

Las migraciones manuales usan `npm run db:migrate` con las variables de producción
explícitas; `-- --development` queda reservado para una base local. Repetir la
ejecución no vuelve a aplicar las entradas ya registradas. Nunca ejecutar semillas
de ejemplos en producción.

## Programador en Dokploy

`npm run prepare:dokploy` prepara `.dokploy/notifications.compose.yaml`, un Compose
independiente que contiene solo el programador. Crear un servicio Compose de tipo
Raw en el entorno de producción existente y copiar ese archivo, con:

- `NOTIFICATION_PROCESS_URL=https://taskode.siempre.net.co/api/internal/notifications/process`.
- `NOTIFICATION_WORKER_SECRET` idéntico al de Vercel.

El servicio usa Node 24, llama cada minuto por POST, rechaza redirecciones y no
necesita acceso a la base ni credenciales S3 o VAPID. Mantener intactos el Compose,
los certificados y los volúmenes del PostgreSQL existente. El `compose.yaml`
general es una alternativa de alojamiento local; no es el despliegue Vercel/Dokploy.

La protección de Vercel debe permitir llamadas al dominio de producción. El Bearer
del programador no sustituye los mecanismos de protección propios de Vercel. La
configuración habitual deja accesible el dominio personalizado y protege las URLs
de despliegues; si se cambia, revisar el acceso del programador.

## Verificación y recuperación

- Vercel debe mostrar el commit publicado en estado **Ready**.
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

Volver al despliegue anterior de Vercel no revierte PostgreSQL. Para una migración
incompatible, mantener el mantenimiento, detener procesos, restaurar el snapshot
previo mediante `pg_restore` y recuperar los archivos asociados y el código
anterior. Preparar y ensayar la restauración con los permisos adecuados; preservar
la extensión `vector` y la configuración TLS del servidor. Un JSON de respaldo
de la aplicación restaura datos sobre el esquema actual y no deshace migraciones.
