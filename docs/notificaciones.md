# Notificaciones y recordatorios

Taskode conserva asignaciones, tareas compartidas, recordatorios y menciones en PostgreSQL. La campana muestra los diez avisos más recientes y el contador de no leídas. **Ver todas** abre `/notifications`, con filtros y lectura individual o colectiva. El historial inicial no genera toast; los avisos nuevos sí, en la pestaña enfocada.

Asignar un nuevo líder avisa a esa persona. Incorporar participantes avisa únicamente a los nuevos integrantes. Se excluye a quien realiza la acción; guardar sin cambios no vuelve a avisar. La promoción de integrante a líder genera una asignación. Se verifica el acceso actual en el historial, contador, navegación y entrega.

## Preferencias y zonas

**Configuración → Global → Notificaciones** permite escoger hasta tres anticipaciones: 15 minutos, 1 hora, 1 día, 3 días o 1 semana. Inicialmente se seleccionan 1 día y 1 hora. Desmarcar todas desactiva recordatorios. Los destinatarios son el líder y el equipo directo de la tarea.

Una tarea sin hora usa solamente anticipaciones de días completos, a las 08:00 por defecto. Cada usuario puede elegir otra hora. Tanto esta hora como el vencimiento se interpretan en la zona IANA del proyecto. **Configuración → Proyecto → Zona horaria**, para líder y administrador, comienza en `America/Bogota`.

Cambiar zona conserva los valores escritos en las tareas y recalcula trabajos futuros. Los cambios de fecha, participantes, archivo, estado o preferencias cancelan trabajos que dejaron de corresponder. La primera activación y una restauración crean únicamente anticipaciones futuras. Al recuperarse de una interrupción se emite solo el umbral pendiente más reciente por tarea/usuario, mientras la tarea no haya vencido. Las horas inexistentes por horario estacional avanzan al siguiente momento válido; en horas repetidas se usa la primera ocurrencia.

## Push web

Generar un par VAPID distinto por entorno con `npx web-push generate-vapid-keys`. Mantener estable ese par: rotarlo exige volver a activar los dispositivos. Configurar en el servidor:

`npm run setup:notifications` prepara `.env.local`; con `-- --production` prepara `.env.production.local`. Genera el par y el secreto si faltan, conserva los valores existentes y no imprime secretos. Estos archivos están excluidos de Git. Copia las variables del archivo de producción a Vercel y el mismo `NOTIFICATION_WORKER_SECRET` al programador de Dokploy.

```dotenv
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<clave pública>
VAPID_PRIVATE_KEY=<clave privada>
VAPID_SUBJECT=https://taskode.siempre.net.co
NOTIFICATION_WORKER_SECRET=<secreto aleatorio de al menos 32 caracteres>
```

Solo la clave pública puede llegar al navegador. Para desarrollo puede usarse `VAPID_SUBJECT=mailto:admin@example.com`. El mismo secreto del programador debe estar en la aplicación y Dokploy. Las pruebas automatizadas utilizan transportes simulados y nunca necesitan claves reales.

El permiso se solicita al pulsar **Activar notificaciones**. Cada dispositivo se registra por separado y se vincula a la sesión; cerrar sesión elimina su registro en el servidor. El push presenta texto genérico, sin nombres de tareas. Al abrirlo se autoriza de nuevo el aviso y se navega a la tarea, preservando la protección de cambios sin guardar. No se guardan páginas autenticadas en caché.

En iPhone/iPad se requiere Safari con soporte Web Push y añadir Taskode a la pantalla de inicio; el permiso se activa dentro de la aplicación instalada. Los navegadores sin soporte o con permiso bloqueado conservan la campana y el historial. Los endpoints de navegadores admitidos son FCM, Mozilla Push, Apple Web Push y Windows Push; otros destinos se rechazan para evitar solicitudes arbitrarias desde el servidor.

## Procesamiento y despliegue

La aplicación continúa en Vercel. `compose.dokploy.yaml` contiene PostgreSQL y un servicio `notifications` basado en Node 24 que llama cada minuto a:

```text
POST https://taskode.siempre.net.co/api/internal/notifications/process
Authorization: Bearer <NOTIFICATION_WORKER_SECRET>
```

El programador no recibe credenciales de base de datos, no solapa llamadas y rechaza redirecciones. Su healthcheck requiere un procesamiento correcto en los últimos tres minutos. `NOTIFICATION_PROCESS_URL` permite configurar el endpoint HTTPS. `npm run prepare:dokploy` prepara el Compose completo y `.dokploy/notifications.compose.yaml`, un Compose independiente del programador para instalaciones existentes. Ese archivo permite añadir el servicio sin cambiar el Compose, los certificados ni los volúmenes actuales de PostgreSQL.

Aplicar en este orden:

1. Ejecutar `npm run db:migrate` para aplicar todas las migraciones hasta `0014_oauth_mcp`, con las instancias anteriores detenidas durante el cambio de versión de esquema. El orden de llegada y el límite de lectura usan una secuencia de base de datos para conservar los avisos nuevos incluso entre instancias con relojes diferentes.
2. Configurar las variables VAPID, RESEND_API_KEY, RESEND_FROM_EMAIL y el secreto en Vercel; desplegar la aplicación. `npm run check:production` las valida sin conectarse a servicios.
3. Configurar el mismo secreto y la URL en Dokploy; actualizar el Compose conservando el nombre y volumen de PostgreSQL existentes.
4. Revisar el estado de `notifications` y los logs con fecha, recordatorios generados, entregas, fallos y pendientes. Un fallo se reintenta sin perder la notificación persistida. Los recordatorios push caducan al vencer la tarea; las otras entregas caducan en 24 horas.
5. Con dos usuarios, asignar una tarea al segundo, abrirla desde la campana, activar push y comprobar un vencimiento próximo. Probar también pérdida de conexión, retirada de acceso y cierre de sesión.

Las entregas se crean en la transacción del cambio y se intentan después del commit mediante `after()`. La cola persistente reintenta fallos con espera exponencial; las reservas caducan para recuperar trabajadores interrumpidos. Cada dispositivo tiene su propio trabajo. Los identificadores estables deduplican reintentos en Ably y en las notificaciones del sistema.

## Respaldos

Los JSON nuevos usan versión 12 e incluyen zonas, preferencias e historial, con destinos de menciones en proyectos, módulos, features, tareas y documentos. Siguen admitiendo versiones 1–11. Suscripciones push, sesiones y colas operativas no se exportan. Restaurar limpia esas tablas, no reproduce avisos históricos y permite al programador reconstruir los recordatorios futuros. Los dispositivos deben iniciar sesión de nuevo.

Las menciones nuevas de usuarios en comentarios, descripciones y contenido de documentos generan avisos exclusivamente in-app. Solo aparecen usuarios con acceso; el servidor vuelve a comprobarlo al guardar y abrir el aviso. Repetir al mismo usuario en el contenido genera un solo aviso; guardar otros cambios no lo repite y las automenciones no notifican. Eliminar y volver a añadir una mención en guardados distintos genera un nuevo aviso. Al borrar el comentario, documento o entidad de origen se eliminan sus avisos. La migración `0011_mentions` conserva los avisos anteriores de tareas y amplía sus destinos.

## Verificación

`npm test` ejecuta las pruebas de dominio, API, cliente y service worker con reloj y transportes simulados. `npm run build` genera la aplicación y `npm run test:http` comprueba las rutas reales, incluida la lectura entre dos usuarios y los recursos PWA.

`npm run test:notifications:live` es una prueba explícita con la clave Ably del entorno de desarrollo. Publica únicamente identificadores de prueba en canales de usuarios aleatorios inexistentes y verifica que el JWT no permita suscribirse a otros usuarios.

Para las pruebas de interfaz, instalar los navegadores con `npx playwright install chromium firefox webkit` y ejecutar `npm run test:notifications:browser` después del build. La suite utiliza una base de pruebas aislada, genera capturas en `test-results/` y comprueba Chromium, Firefox y WebKit en escritorio y móvil. Los permisos push se simulan para comprobar consentimiento, rechazo y falta de soporte sin enviar avisos externos. La instalación y recepción de push en un iPhone/iPad físico se comprueban al activar producción.

## Usuarios, invitaciones y accesos

**Menú → Usuarios e invitaciones** abre `/users`, una vista exclusiva del administrador. La pestaña Usuarios muestra los accesos efectivos y distingue líderes e integrantes; el administrador accede automáticamente a todos los proyectos. En escritorio muestra tres cards por fila. **Gestionar proyectos** abre un modal con desplazamiento interno y conserva la posición de la lista al cerrarlo. La pestaña Invitaciones muestra proyectos, enlaces, vencimiento y estado del correo. Usa el mismo ancho de página, con formulario e historial en columnas que se apilan en pantallas pequeñas. El formulario reconoce correos registrados y asigna los proyectos elegidos directamente, conservando sus demás accesos.

Retirar un proyecto muestra cuántas tareas, módulos y features deben transferirse. Se elige un reemplazo con acceso al proyecto, que también asume el liderazgo del proyecto si corresponde. Las tareas terminadas y archivadas están incluidas. La reasignación, la limpieza de equipos, la retirada y los avisos se guardan en una sola transacción. Si cambiaron los accesos o responsabilidades desde la revisión, el servidor devuelve un conflicto y exige recargar el resumen. Los enlaces pendientes anteriores del usuario se revocan al gestionar directamente sus permisos.

Una concesión o retirada efectiva genera un aviso para la persona afectada, por proyecto, con campana, contador y toast en la pestaña enfocada; también encola email y push para los dispositivos habilitados. Al aceptar una invitación se avisa al administrador que la creó, incluso si no tenía proyectos. Las invitaciones a personas sin cuenta se entregan por email; al aceptar reciben los avisos de sus proyectos. Guardar sin cambios no repite avisos. Las reglas de tareas y menciones permanecen iguales.

Las retiradas son avisos personales que siguen disponibles después de perder acceso; abren `/projects`. Las concesiones comprueban el acceso al abrir y usan `/projects` como alternativa si se retiró después. La aceptación abre la ficha del usuario en `/users`. El texto push sigue siendo genérico. El email nunca incluye contenido de tareas.

Los correos forman parte de la misma cola duradera que Ably y push, con claves de idempotencia en Resend y reservas por trabajador. Los errores de correo dejan el acceso guardado y se reintentan. La página muestra Correo en cola, Correo enviado o No se pudo enviar; se reintentará. El enlace sigue disponible para copiar. Los correos de invitación se descartan si el enlace se revocó, aceptó o venció; las invitaciones caducan en siete días y los demás avisos en 24 horas. En producción deben estar configuradas RESEND_API_KEY y RESEND_FROM_EMAIL, con un remitente autorizado en Resend.

La migración conserva el historial sin generar avisos de asignaciones antiguas. Retoma los correos pendientes o fallidos de invitaciones todavía vigentes a personas sin cuenta; los correos ya enviados no se reproducen. Los respaldos versión 12 incluyen los avisos de cuenta; la restauración no reproduce correos, revoca invitaciones pendientes y limpia las colas operativas.

`npm run test:users:browser` comprueba las rutas y permisos, la vista en escritorio/móvil, reemplazos, asignación directa, invitaciones, contador, toast y navegación en Chromium, Firefox y WebKit. Usa una base aislada y no envía correos ni push reales.
