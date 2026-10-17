ALTER TABLE `tasks` ADD `ticketNumber` text;
--> statement-breakpoint
-- Solo renombra valores que aún tienen el nombre original. Conserva IDs, colores y personalizaciones.
-- Si ya existe la opción con emoji en el proyecto, conserva ambas sin provocar un conflicto.
WITH defaults(oldName, newName) AS (VALUES
  ('Sugerencia', '💡 Sugerencia'),
  ('Requerimiento', '📋 Requerimiento'),
  ('Falencia', '⚠️ Falencia'),
  ('Error', '🐛 Error')
)
UPDATE `task_types` AS current
SET name = (SELECT newName FROM defaults WHERE oldName = current.name)
WHERE current.name IN (SELECT oldName FROM defaults)
AND NOT EXISTS (
  SELECT 1 FROM `task_types` other JOIN defaults ON other.name = defaults.newName COLLATE NOCASE
  WHERE other.projectId = current.projectId AND defaults.oldName = current.name
);
--> statement-breakpoint
WITH defaults(oldName, newName) AS (VALUES
  ('Usuario', '👤 Usuario'),
  ('Cliente', '🏢 Cliente'),
  ('Feature', '✨ Feature'),
  ('Modulo', '🧩 Modulo'),
  ('Proyecto', '🚀 Proyecto')
)
UPDATE `impacts` AS current
SET name = (SELECT newName FROM defaults WHERE oldName = current.name)
WHERE current.name IN (SELECT oldName FROM defaults)
AND NOT EXISTS (
  SELECT 1 FROM `impacts` other JOIN defaults ON other.name = defaults.newName COLLATE NOCASE
  WHERE other.projectId = current.projectId AND defaults.oldName = current.name
);
