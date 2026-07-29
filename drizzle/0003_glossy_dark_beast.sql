PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_connector` (
	`id` text PRIMARY KEY DEFAULT 'primary' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`so_slice_id` text DEFAULT '' NOT NULL,
	`staff_slice_id` text DEFAULT '' NOT NULL,
	`path_template` text DEFAULT '/api/v1/chart/{sliceId}/data/?format=json&type=full&force=true' NOT NULL,
	`refresh_interval_minutes` integer DEFAULT 5 NOT NULL,
	`warehouse_code` text DEFAULT 'CBT' NOT NULL,
	`warehouse_name` text DEFAULT 'CBT - WH Cibitung' NOT NULL,
	`warehouse_timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`sync_locked_until` text,
	`sync_lock_token` text,
	`cookie_ciphertext` text,
	`cookie_iv` text,
	`cookie_expires_at` text,
	`cookie_updated_at` text,
	`health` text DEFAULT 'NOT_CONFIGURED' NOT NULL,
	`last_message` text,
	`last_verified_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sync_connector`("id", "base_url", "so_slice_id", "staff_slice_id", "path_template", "refresh_interval_minutes", "warehouse_code", "warehouse_name", "warehouse_timezone", "sync_locked_until", "sync_lock_token", "cookie_ciphertext", "cookie_iv", "cookie_expires_at", "cookie_updated_at", "health", "last_message", "last_verified_at", "updated_at") SELECT "id", "base_url", "so_slice_id", "staff_slice_id", CASE WHEN "path_template" = '/api/v1/chart/{sliceId}/data/?format=csv&force=true' THEN '/api/v1/chart/{sliceId}/data/?format=json&type=full&force=true' ELSE "path_template" END, "refresh_interval_minutes", "warehouse_code", "warehouse_name", "warehouse_timezone", "sync_locked_until", "sync_lock_token", "cookie_ciphertext", "cookie_iv", "cookie_expires_at", "cookie_updated_at", "health", "last_message", "last_verified_at", "updated_at" FROM `sync_connector`;--> statement-breakpoint
DROP TABLE `sync_connector`;--> statement-breakpoint
ALTER TABLE `__new_sync_connector` RENAME TO `sync_connector`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
