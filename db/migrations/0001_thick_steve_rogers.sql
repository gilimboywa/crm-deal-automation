CREATE TABLE `fathom_transcripts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recording_id` integer NOT NULL,
	`title` text NOT NULL,
	`meeting_url` text,
	`scheduled_start` text,
	`scheduled_end` text,
	`recording_start` text,
	`recording_end` text,
	`transcript` text NOT NULL,
	`eisen_speakers` text,
	`is_sales_call` integer DEFAULT false NOT NULL,
	`sales_person` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`deal_id` integer,
	`error_message` text,
	`pulled_at` text NOT NULL,
	`processed_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fathom_transcripts_recording_id_unique` ON `fathom_transcripts` (`recording_id`);