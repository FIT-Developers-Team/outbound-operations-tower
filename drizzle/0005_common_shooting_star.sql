CREATE TABLE `destination_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`effective_month` text NOT NULL,
	`destination_code` text NOT NULL,
	`destination_name` text NOT NULL,
	`wave` text NOT NULL,
	`drop_label` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
