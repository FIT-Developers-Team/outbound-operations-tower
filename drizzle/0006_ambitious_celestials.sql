CREATE TABLE `command_receipts` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
ALTER TABLE `dataset_snapshots` ADD `source_synced_at` text;--> statement-breakpoint
UPDATE `dataset_snapshots` SET `source_synced_at` = `synced_at` WHERE `source_synced_at` IS NULL;--> statement-breakpoint
ALTER TABLE `dataset_snapshots` ADD `version` integer DEFAULT 1 NOT NULL;
