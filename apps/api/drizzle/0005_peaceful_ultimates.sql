CREATE TABLE `agent_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_user_id` text,
	`source_project_id` text,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `agent_lessons_status_idx` ON `agent_lessons` (`status`);