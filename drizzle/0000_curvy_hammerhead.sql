CREATE TABLE `dataset_snapshots` (
	`id` text PRIMARY KEY DEFAULT 'current' NOT NULL,
	`source_date` text NOT NULL,
	`month` text NOT NULL,
	`dataset_key` text NOT NULL,
	`fallback_payload` text,
	`so_rows` integer DEFAULT 0 NOT NULL,
	`staff_rows` integer DEFAULT 0 NOT NULL,
	`synced_at` text NOT NULL,
	`run_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_connector` (
	`id` text PRIMARY KEY DEFAULT 'primary' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`so_slice_id` text DEFAULT '' NOT NULL,
	`staff_slice_id` text DEFAULT '' NOT NULL,
	`path_template` text DEFAULT '/api/v1/chart/{sliceId}/data/?format=csv&force=true' NOT NULL,
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
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`triggered_by` text NOT NULL,
	`month` text NOT NULL,
	`so_rows` integer DEFAULT 0 NOT NULL,
	`staff_rows` integer DEFAULT 0 NOT NULL,
	`dataset_key` text,
	`message` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_at_idx` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `sync_runs_status_idx` ON `sync_runs` (`status`);