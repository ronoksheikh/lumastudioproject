ALTER TABLE `uploads` ADD `sent_at` integer;
--> statement-breakpoint
-- uploads that existed before round 2 were already sent (or are in use): never treat them as pending
UPDATE `uploads` SET `sent_at` = `created_at` WHERE `sent_at` IS NULL;
