CREATE TABLE `impacts` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `impact_name` ON `impacts` (`projectId`,"name" collate nocase);--> statement-breakpoint
CREATE TABLE `task_types` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_type_name` ON `task_types` (`projectId`,"name" collate nocase);--> statement-breakpoint
ALTER TABLE `tasks` ADD `typeId` text REFERENCES task_types(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `impactId` text REFERENCES impacts(id);
--> statement-breakpoint
-- Backfill de catálogos para todos los proyectos existentes. Las tareas conservan NULL.
INSERT INTO `task_types` (`id`, `projectId`, `name`, `color`, `position`)
SELECT 'task-type:' || p.id || ':' || defaults.position, p.id, defaults.name, defaults.color, defaults.position
FROM `projects` p CROSS JOIN (
  SELECT 'Sugerencia' AS name, '#3b82f6' AS color, 0 AS position
  UNION ALL SELECT 'Requerimiento', '#8b5cf6', 1
  UNION ALL SELECT 'Falencia', '#f59e0b', 2
  UNION ALL SELECT 'Error', '#ef4444', 3
) defaults;
--> statement-breakpoint
INSERT INTO `impacts` (`id`, `projectId`, `name`, `color`, `position`)
SELECT 'impact:' || p.id || ':' || defaults.position, p.id, defaults.name, defaults.color, defaults.position
FROM `projects` p CROSS JOIN (
  SELECT 'Usuario' AS name, '#64748b' AS color, 0 AS position
  UNION ALL SELECT 'Cliente', '#3b82f6', 1
  UNION ALL SELECT 'Feature', '#0d9488', 2
  UNION ALL SELECT 'Modulo', '#8b5cf6', 3
  UNION ALL SELECT 'Proyecto', '#ef4444', 4
) defaults;
