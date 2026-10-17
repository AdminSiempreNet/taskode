# Preparación de producción

Este cambio prepara el código; no crea recursos, cambia DNS, hace push ni despliega.

| Entorno | Aplicación Next.js y API | PostgreSQL | Respaldos |
| --- | --- | --- | --- |
| Desarrollo | `npm run dev`, http://localhost:5010 | Docker Desktop, `compose.dev.yaml`, 127.0.0.1:5432 | Archivos locales; S3 opcional con bucket/prefijo separado |
| Producción | Vercel, workspace `siemprenet`, https://tareas.siempre.net.co | Dokploy, `compose.dokploy.yaml`, TLS obligatorio | Bucket privado S3 compatible: R2 o Backblaze B2 |

## Git y Vercel

`vercel.json` permite despliegues automáticos únicamente desde `main` y desactiva explícitamente `dev`. Un push a `dev` **no crea un deployment**, ni Production ni Preview. Las otras ramas tampoco despliegan automáticamente. Las ejecuciones manuales de Vercel son independientes de ese filtro; el build rechaza Preview y una rama Git distinta de `main` para evitar utilizar la base de producción por accidente.

Al desplegar:

1. Crear o elegir el repositorio remoto y subir el código cuando se autorice. Actualmente este checkout no tiene remoto configurado.
2. Importar el repositorio en el workspace **siemprenet** y crear el proyecto **tareas**. Crear/importar un proyecto puede iniciar un primer despliegue: hacerlo únicamente en la fase de despliegue.
3. Framework **Next.js**, directorio raíz del repositorio, Node.js **24.x**, instalación `npm ci`, build `npm run build:vercel`. No configurar salida estática ni un comando `npm run dev` en Vercel.
4. Seleccionar **main** como Production Branch en la configuración de producción del proyecto. Este ajuste de cuenta no se puede imponer con `vercel.json`. Mantener habilitada la integración Git. Confirmar que `dev` queda deshabilitada por la configuración del repositorio.
5. Completar las variables de `.env.production.example` exclusivamente en **Production**. No copiar `.env.local`, `TEST_DATABASE_URL` ni contraseñas de desarrollo. Ningún secreto usa `NEXT_PUBLIC_`.
6. Añadir `tareas.siempre.net.co` a Domains y crear exactamente el registro DNS que muestre Vercel. No fijar aquí una IP o CNAME asumido. Esperar la emisión HTTPS.

Vercel aloja la interfaz y las rutas API/autenticación de Next.js. Solo el servidor accede a PostgreSQL; el navegador no recibe `DATABASE_URL`.

## PostgreSQL en Dokploy

El Compose de producción contiene solo `postgres`, usa `pgvector/pgvector:0.8.7-pg18-bookworm` y conserva el volumen `taskode-postgres`. La web y el migrador ya no son servicios de Dokploy. El Compose completo `compose.yaml` sigue disponible como alternativa local.

En instalaciones anteriores al cambio de marca, establece `TASKODE_POSTGRES_VOLUME` con el nombre físico del volumen existente y conserva el proyecto Compose, la base y el rol mediante `COMPOSE_PROJECT_NAME`, `POSTGRES_DB` y `TASKODE_DB_USER`. La variable de contraseña ahora es `TASKODE_DB_PASSWORD`. No cambies el volumen por uno vacío; el [README](../README.md#instalaciones-anteriores-al-cambio-de-marca) detalla la compatibilidad.

Preparar sin desplegar:

```powershell
npm run prepare:dokploy
```

Genera `.dokploy/compose.yaml` sin secretos, sin empaquetar código de la aplicación y sin llamadas remotas. El script antiguo rechaza los modos `deploy`, `status` y `logs` para evitar reutilizar el flujo retirado.

En el servidor, antes de arrancar PostgreSQL:

1. Reservar un hostname DNS para la base, por ejemplo `db-tareas.siempre.net.co`, apuntando al servidor sin proxy HTTP. Su valor final debe coincidir con el certificado y con `DATABASE_URL`.
2. Obtener un certificado TLS para ese hostname (CA pública o privada). Colocar la cadena en `server.crt` y la clave en `server.key`, dentro de la ruta absoluta `POSTGRES_TLS_DIR` del servidor. El certificado HTTPS de la web no configura TLS de PostgreSQL.
3. Dar acceso de lectura al usuario `postgres` del contenedor. Para la clave, PostgreSQL admite propietario `postgres` y modo `0600`, o propietario `root`, grupo del usuario PostgreSQL y modo `0640`. Consultar el UID/GID real de la imagen; no asumir el del host. Montar el directorio en solo lectura, renovar los certificados y recargar PostgreSQL antes de que expiren.
4. Crear un servicio **Docker Compose** en Dokploy con `compose.dokploy.yaml`. Completar `.env.dokploy.example` en su entorno, con contraseñas nuevas y un puerto externo libre. No asignar un dominio HTTP/Traefik a PostgreSQL: Vercel conecta por TCP.
5. Configurar el firewall del servidor/proveedor y el acceso saliente de Vercel. El puerto debe ser accesible desde el build y las funciones de Vercel. Si se restringen IP, usar los rangos salientes que correspondan a Static IPs/Secure Compute del proyecto; las IP de salida normales de Vercel son dinámicas. No asumir una IP fija de Vercel.
6. Desplegar la base y verificar TLS, autenticación y `vector`. La configuración `pg_hba` del Compose rechaza TCP sin TLS. El rol `taskode` puede migrar su esquema y no es superusuario; `postgres` solo se usa para administrar e inicializar.

`DATABASE_URL` de Vercel debe usar el hostname y puerto externos, usuario `taskode` y su contraseña (escapada como URL si contiene caracteres especiales). No usar `postgres:5432`, `localhost` ni la IP interna de Docker. Mantener `DATABASE_SSL=verify-full`; si la CA es privada, configurar el PEM en `DATABASE_SSL_CA`. No añadir `sslmode`, `sslrootcert`, `sslcert` o `sslkey` a la URL: sobrescribirían la configuración TLS del driver.

El pool se reutiliza por instancia, se registra con `attachDatabasePool` y usa un máximo inicial de cinco conexiones en Vercel. `DATABASE_POOL_MAX` acepta 3–50. El total crece con las instancias; dimensionar PostgreSQL y reservar conexiones para migraciones y administración. Si se añade PgBouncer, usar modo **session**: el proyecto utiliza bloqueos de sesión y `search_path` por conexión.

No reemplazar a ciegas una instalación anterior: identificar y respaldar su volumen y verificar las credenciales existentes. Las variables de inicialización solo crean roles en un volumen vacío; no rotan contraseñas de un volumen existente. No ejecutar `down -v`.

## Respaldos S3: interfaz intercambiable

`src/server/backup-storage.ts` define `BackupStorage`. `S3BackupStorage` implementa listado paginado, metadatos, lectura, escritura, borrado y transferencias con enlaces firmados. `BackupManager` conserva la validación, coordinación y restauración transaccional, independientemente del proveedor. Para añadir otro adaptador se implementa el contrato y se selecciona en `createBackupStorage`.

En desarrollo `BACKUP_STORAGE=filesystem` mantiene `BACKUP_DIR`. En Vercel se exige `s3`; `/tmp` se usa solo para procesar un archivo durante una operación y se limpia. Para probar S3 localmente, configurar las variables S3 en `.env.local` y usar un bucket separado o `S3_PREFIX=tareas/development/`.

| Variable | Cloudflare R2 | Backblaze B2 |
| --- | --- | --- |
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | `https://s3.<REGION>.backblazeb2.com` |
| `S3_REGION` | `auto` | La región exacta del bucket, por ejemplo `us-west-004` |
| `S3_BUCKET` | Nombre del bucket privado | Nombre del bucket privado |
| `S3_ACCESS_KEY_ID` | Access Key ID del token R2 | Application Key ID con acceso al bucket |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key | Application Key |
| `S3_PREFIX` | `tareas/production/` | `tareas/production/` |
| `S3_FORCE_PATH_STYLE` | `false` por defecto | `false` por defecto |

Cambiar de R2 a B2 requiere cambiar las variables y reiniciar/replegar. Los objetos existentes **no se copian automáticamente**: copiarlos conservando el prefijo y los nombres antes de cambiar si se desea mantener el historial visible.

Crear el bucket privado y una credencial con permisos de listar, leer, escribir y borrar objetos, limitada al bucket/prefijo. No habilitar acceso público. Configurar esta regla CORS (formato S3; cada consola puede mostrarla con otros nombres):

```json
[
  {
    "AllowedOrigins": ["https://tareas.siempre.net.co"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Para probar desde el equipo, añadir `http://localhost:5010` únicamente a la regla del bucket de desarrollo. En Backblaze, si se usa la API B2 de CORS, los equivalentes son `allowedOrigins`, `allowedHeaders`, `exposeHeaders`, `maxAgeSeconds` y operaciones `s3_put`, `s3_get`, `s3_head`.

Los archivos duraderos viven bajo `<S3_PREFIX>backups/`. Las cargas temporales van a `<S3_PREFIX>uploads/`, no se muestran en el panel y se eliminan después de intentar restaurarlas. Configurar una regla de ciclo de vida que elimine las cargas abandonadas de `uploads/` después de un día. Elegir también retención/versionado de las copias definitivas; borrar desde el panel puede dejar versiones antiguas si el proveedor tiene versionado.

Los enlaces PUT/GET expiran en cinco minutos y solo se emiten tras autenticar a un administrador. La subida va directamente del navegador al bucket; el servidor valida el tamaño (hasta 100 MB), el contenido y las referencias antes de restaurar. La descarga también va directamente al bucket. Las credenciales S3 permanecen en el servidor. Las copias previas se completan en el bucket antes de modificar datos; si falla su escritura, la restauración no se aplica.

La limitación HTTP de Vercel sigue aplicando a otras API, como importaciones Trello grandes o espacios cuyo JSON supere 4,5 MB. Los respaldos del panel usan transferencias directas para evitarla. Las restauraciones también deben terminar dentro del tiempo de ejecución y memoria del plan; probar tamaños representativos antes de producción.

Los respaldos de aplicación no sustituyen copias nativas de PostgreSQL. Programar `pg_dump`/respaldo operativo del volumen hacia almacenamiento externo, definir retención y probar una recuperación. No copiar el directorio de datos de una base en ejecución como sustituto de `pg_dump`.

## Variables, autenticación y migraciones

Configurar `BETTER_AUTH_URL=https://tareas.siempre.net.co`, secreto nuevo de al menos 32 caracteres y uno o ambos proveedores OAuth. Registrar:

- Google: `https://tareas.siempre.net.co/api/auth/callback/google`.
- GitHub: `https://tareas.siempre.net.co/api/auth/callback/github`.

Conservar los callbacks de localhost para desarrollo en credenciales separadas cuando el proveedor lo requiera. GitHub OAuth Apps tiene un único callback: usar otra App para producción. Para invitaciones por correo, configurar Resend y un remitente de dominio verificado.

`npm run check:production` valida la configuración sin conectarse a los servicios. `npm run build:vercel` valida, aplica migraciones con `npm run db:migrate` y compila. Un error de configuración o migración falla el build. Las migraciones se coordinan con un bloqueo PostgreSQL; no se ejecutan en cada petición. `npm run build` sigue permitiendo compilar localmente sin base remota ni secretos reales.

**Actualizaciones futuras:** una migración aplicada no se revierte si la compilación o publicación posterior falla. Además, la aplicación comprueba la versión exacta del esquema: una migración nueva puede dejar temporalmente incompatible la versión anterior mientras termina el despliegue. Respaldar, revisar SQL y planificar una ventana de mantenimiento antes de cambios de esquema; no usar el rollback del frontend como rollback de base. La primera publicación debe partir de una base inicializada/migrada y completarse antes de abrir el acceso.

## Orden y responsables al desplegar

### Te corresponde a ti

1. Confirmar el repositorio y dar acceso al workspace **siemprenet**, al servidor Dokploy, al DNS de `siempre.net.co` y al proveedor elegido (R2 o B2).
2. Elegir R2 o B2, región, retención, hostname/puerto de PostgreSQL y los recursos/plan de Vercel necesarios para el acceso de red.
3. Autorizar los accesos OAuth, crear/entregar las credenciales por los gestores de secretos de las plataformas y completar verificaciones de dominio o facturación que requieran tu cuenta.
4. Acceder primero con la cuenta que deba ser administradora; la primera cuenta válida obtiene ese rol.
5. Dar la instrucción de desplegar y, si se trasladan datos existentes, confirmar qué datos y volumen son la fuente definitiva.

### Puedo hacer yo con esos accesos y tu instrucción

1. Configurar el remoto, preparar el commit y las ramas y subir los cambios.
2. Preparar certificados y firewall, configurar/desplegar PostgreSQL en Dokploy y comprobar TLS, roles, extensión y persistencia.
3. Crear/configurar el bucket privado, permisos, CORS y limpieza de cargas temporales en R2 o B2.
4. Configurar el proyecto Vercel en **siemprenet**, variables, integración Git, **main** como Production Branch y **dev sin despliegues automáticos**.
5. Añadir el dominio y los registros DNS mediante los accesos disponibles; si el proveedor exige una acción personal, darte los valores exactos.
6. Ejecutar migraciones y despliegue, verificar HTTPS, `/api/health`, acceso OAuth, permisos, invitaciones, respaldo/descarga/restauración y comportamiento de las ramas. Las pruebas de restauración se hacen en una base de prueba, nunca sobre datos reales sin una instrucción específica.
7. Configurar y probar respaldos operativos y dejar registrado el procedimiento de recuperación.

No se ha realizado ninguna de esas acciones remotas durante esta preparación.

## Validación realizada

- PostgreSQL de desarrollo saludable en Docker Desktop y `/api/health` local con respuesta 200.
- 79 pruebas de aplicación, configuración y S3; 8 pruebas HTTP sobre la compilación.
- TypeScript y compilación con `VERCEL=1` correctos; Compose local y de Dokploy válidos.
- Las pruebas S3 usan un cliente simulado para operaciones y el SDK real para firmar URLs de R2/B2. La conectividad, permisos, CORS y TLS de los servicios remotos se comprobarán al configurar las cuentas; todavía no se ha usado un bucket real ni una base remota.

## Referencias oficiales

- [Filtro Git por rama en Vercel](https://vercel.com/docs/project-configuration/git-configuration).
- [Configuración de Git en Vercel](https://vercel.com/docs/project-configuration/git-settings).
- [Pool de conexiones en Vercel](https://vercel.com/kb/guide/connection-pooling-with-functions).
- [Límites de las funciones](https://vercel.com/docs/functions/limitations).
- [Conexión externa de bases Dokploy](https://docs.dokploy.com/docs/core/databases/connection).
- [TLS en PostgreSQL](https://www.postgresql.org/docs/current/ssl-tcp.html).
- [TLS con node-postgres](https://node-postgres.com/features/ssl).
- [R2 con AWS SDK v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
- [Backblaze B2 con AWS SDK v3](https://www.backblaze.com/docs/cloud-storage-use-the-aws-sdk-for-javascript-v3-with-backblaze-b2).
- [CORS de R2](https://developers.cloudflare.com/r2/buckets/cors/) y [CORS de Backblaze](https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules).
