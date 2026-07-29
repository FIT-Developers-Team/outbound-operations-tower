ALTER TABLE `sync_connector` ADD `warehouse_code` text DEFAULT 'CBT' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_connector` ADD `warehouse_name` text DEFAULT 'CBT - WH Cibitung' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_connector` ADD `warehouse_timezone` text DEFAULT 'Asia/Jakarta' NOT NULL;