CREATE TABLE `sign_in_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`window_start` text NOT NULL,
	`blocked_until` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sign_in_attempts_updated_at_idx` ON `sign_in_attempts` (`updated_at`);