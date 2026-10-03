ALTER TABLE `projects` ADD `uid` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_uid_idx` ON `projects` (`uid`);