ALTER TABLE `sync_connector` ADD `refresh_interval_minutes` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_connector` ADD `sync_locked_until` text;--> statement-breakpoint
ALTER TABLE `sync_connector` ADD `sync_lock_token` text;