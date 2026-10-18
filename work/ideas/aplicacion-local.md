# Aplicación de escritorio

La decisión vigente se documenta en [Migración de SQLite a PostgreSQL](migracion-sqlite-postgresql.md).

- Fase 1: estabilizar la web en PostgreSQL.
- Fase 2: cliente Tauri siempre conectado a la misma web. Una eventual caché local será descartable y no admitirá edición sin conexión.
- Fase 3: edición personal autónoma y monousuario con SQLite. El trabajo podrá trasladarse al servidor mediante exportación e importación explícitas.

La sincronización bidireccional entre una copia local y el servidor queda fuera del alcance elegido.
