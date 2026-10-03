CREATE TABLE `shared_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`file` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source_user_id` text,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shared_assets_status_idx` ON `shared_assets` (`status`);--> statement-breakpoint
CREATE INDEX `shared_assets_sha_idx` ON `shared_assets` (`sha256`);