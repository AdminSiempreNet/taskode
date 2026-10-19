# Diagramas

Proyectos, módulos, features y tareas guardadas tienen una pestaña **Diagramas**. Cada diagrama tiene título y descripción; se abre dentro del detalle, en pantalla completa o en otra pestaña. General es una agrupación virtual y no guarda diagramas propios.

El lienzo usa Excalidraw 0.18.1, con fuentes locales. `predev` y `prebuild` preparan las fuentes desde la dependencia instalada, sin depender de un CDN. Solo se descarga al abrir un diagrama. El listado consulta metadatos y no descarga escenas ni imágenes.

## Guardado y permisos

**Guardar** persiste el título, la descripción, las figuras y las imágenes en PostgreSQL, independientemente del formulario del proyecto o tarea. La revisión incremental impide sobrescribir un guardado más reciente de otro usuario o pestaña. Ante un conflicto, el borrador permanece visible y se puede recargar la versión guardada después de confirmar su descarte.

El límite es de **3.000.000 bytes** por documento serializado en UTF-8, incluidas las imágenes en base64. Las imágenes compatibles son PNG, JPEG, GIF, WebP y AVIF. El tamaño se valida también en el servidor; un rechazo no altera el documento anterior. El zoom, la selección y el desplazamiento no requieren guardado.

Los permisos se heredan del elemento: quien pueda verlo consulta sus diagramas; `canEdit` permite crearlos, modificarlos y eliminarlos. No existe un equipo separado por diagrama. Eliminar el elemento elimina sus diagramas. Al eliminar un módulo, los diagramas de las features que pasan a General se conservan.

## Enlaces públicos

Solo quienes administran el acceso (`canManageAccess`) pueden activar o revocar un enlace desde **Compartir**. Antes deben guardar los cambios pendientes. Los diagramas comienzan privados.

El enlace muestra únicamente el título, la descripción y el lienzo de solo lectura, sin iniciar sesión ni cargar el workspace. Siempre consulta la última versión guardada al abrir o recargar; no actualiza automáticamente una página ya abierta. Desactivar el enlace impide las siguientes lecturas; volver a activarlo crea un enlace nuevo. El contenido ya descargado no puede retirarse del dispositivo de quien lo consultó.

Las respuestas públicas no se almacenan en caché y las páginas no se indexan. Los adjuntos privados existentes de Taskode no se vuelven públicos. No se admiten incrustaciones externas en los diagramas.

## Migración y respaldos

La migración `0009_diagrams` añade la tabla y sus restricciones. Aplicar antes de iniciar la versión nueva:

```powershell
npm run db:migrate -- --development
```

En producción se usa `npm run db:migrate` con la configuración del despliegue. La migración local ya se aplica por separado; no se ejecuta automáticamente desde la interfaz.

Los respaldos nuevos usan la versión **11** e incluyen escenas e imágenes. Se mantiene compatibilidad con versiones 1–10; las anteriores a la versión 8 se normalizan sin diagramas. El límite global de respaldo sigue siendo 100 MB. Los tokens públicos no se exportan y todos los diagramas restaurados quedan privados.

Pruebas específicas: `node --import tsx --test tests/diagrams.test.ts` y `npm run test:diagrams:browser`. Las pruebas HTTP generales incluyen guardado, conflictos, origen, tamaño y compartición anónima. Las pruebas de navegador guardan capturas en `test-results/diagrams-*.png`.
