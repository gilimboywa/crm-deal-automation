CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hubspot_contact_id` text,
	`first_name` text NOT NULL,
	`last_name` text,
	`email` text,
	`phone` text,
	`company` text,
	`title` text,
	`linkedin_url` text,
	`association_reason` text,
	`first_seen_date` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deal_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`role` text DEFAULT 'secondary' NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hubspot_deal_id` text,
	`company_name` text NOT NULL,
	`amount` real,
	`close_date` text,
	`pipeline` text DEFAULT '[NEW] Sales Pipeline' NOT NULL,
	`deal_stage` text DEFAULT '0' NOT NULL,
	`deal_source_person` text,
	`primary_deal_source` text,
	`deal_source_details` text,
	`deal_description` text,
	`icp` text,
	`deal_type` text,
	`create_date` text NOT NULL,
	`last_contacted` text,
	`deal_owner` text,
	`forecast_probability` real,
	`num_customer_accounts` integer,
	`num_state_reports` text,
	`num_due_diligence_letters` integer,
	`contract_term` text,
	`disbursement_pricing` text,
	`escheatment_pricing` text,
	`match_result` text,
	`matched_deal_id` integer,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`synced_to_hubspot` integer DEFAULT false NOT NULL,
	`last_synced_at` text,
	`raw_input_data` text,
	`claude_reasoning` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workflow_type` text NOT NULL,
	`status` text NOT NULL,
	`deal_id` integer,
	`triggered_by` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`error_message` text,
	`metadata` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
