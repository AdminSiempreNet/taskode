# Catálogo geográfico de Colombia

`divipola.json` es una copia fija del conjunto **DIVIPOLA - Códigos municipios**, publicado por el Departamento Administrativo Nacional de Estadística (DANE).

- Fuente: [Datos Abiertos Colombia, gdxc-w37w](https://www.datos.gov.co/Mapas-Nacionales/DIVIPOLA-C-digos-municipios/gdxc-w37w).
- Descarga: 17 de octubre de 2026; la URL de consulta está registrada en el JSON.
- Contenido: 33 grupos departamentales (Bogotá tiene código propio) y 1.122 unidades territoriales.
- Se conservan nombres, clasificación original y códigos DIVIPOLA como texto de dos y cinco caracteres.
- Mapeo: `cod_dpto → department.id`, `dpto → department.name`, `cod_mpio → city.id`, `nom_mpio → city.name`, `tipo_municipio → city.kind`.

La migración `0001_global_clients.sql` incluye estos mismos registros para instalaciones nuevas y actualizaciones sin acceso a Internet. El JSON también proporciona la geografía al importar respaldos versión 1, que no contenían estas tablas. Los respaldos versión 2 transportan su propio catálogo.

Una actualización futura del catálogo requiere revisar una nueva copia y crear otra migración, conservando las referencias existentes. La aplicación no sincroniza ni sobrescribe ubicaciones automáticamente.
