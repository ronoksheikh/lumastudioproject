CREATE TABLE `render_boosts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`seconds` integer NOT NULL,
	`used_seconds` integer DEFAULT 0 NOT NULL,
	`price_bdt` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_ref` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `render_boosts_user_idx` ON `render_boosts` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `render_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`max_jobs` integer DEFAULT 1 NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `render_workers_token_hash_unique` ON `render_workers` (`token_hash`);--> statement-breakpoint
ALTER TABLE `render_jobs` ADD `pool` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `render_jobs` ADD `worker_id` text;--> statement-breakpoint
ALTER TABLE `render_jobs` ADD `lease_until` integer;--> statement-breakpoint
ALTER TABLE `render_jobs` ADD `boost_id` text;