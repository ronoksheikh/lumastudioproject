ALTER TABLE `render_boosts` ADD `provider` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `render_boosts` ADD `invoice_number` text;--> statement-breakpoint
ALTER TABLE `render_boosts` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `render_boosts` ADD `return_to` text;--> statement-breakpoint
CREATE UNIQUE INDEX `render_boosts_invoice_idx` ON `render_boosts` (`invoice_number`);