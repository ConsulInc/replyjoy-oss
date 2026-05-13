CREATE TABLE `draft_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`gmail_draft_id` text,
	`status` text DEFAULT 'drafted' NOT NULL,
	`decision_provider` text,
	`decision_model` text,
	`generation_provider` text,
	`generation_model` text,
	`autodraft_batch_id` text,
	`selection_context_json` text,
	`generated_text` text NOT NULL,
	`source_message_id` text,
	`generated_at` integer NOT NULL,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`gmail_internal_date` integer,
	`direction` text,
	`from_email` text,
	`to_emails` text,
	`cc_emails` text,
	`subject` text,
	`text_body` text,
	`html_body` text,
	`headers_json` text,
	`body_loaded` integer DEFAULT false,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_messages_gmail_message_id_unique` ON `email_messages` (`gmail_message_id`);--> statement-breakpoint
CREATE TABLE `email_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`gmail_history_id` text,
	`subject` text,
	`snippet` text,
	`from_email` text,
	`from_name` text,
	`last_message_at` integer,
	`has_unread` integer DEFAULT false,
	`in_primary` integer DEFAULT true,
	`selection_status` text,
	`selection_reason` text,
	`latest_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_threads_user_thread_unique` ON `email_threads` (`user_id`,`gmail_thread_id`);--> statement-breakpoint
CREATE TABLE `gmail_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`google_email` text,
	`google_sub` text,
	`last_history_id` text,
	`refresh_token_encrypted` text NOT NULL,
	`access_token_encrypted` text,
	`token_expires_at` integer,
	`scopes` text,
	`connected_at` integer NOT NULL,
	`sync_status` text DEFAULT 'connected',
	`last_sync_error` text,
	`initial_sync_started_at` integer,
	`initial_sync_completed_at` integer,
	`last_successful_sync_at` integer,
	`last_sync_attempt_at` integer,
	`last_polled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_accounts_user_id_unique` ON `gmail_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_type` text NOT NULL,
	`window_start` integer,
	`window_end` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`threads_scanned` text DEFAULT '0',
	`threads_selected` text DEFAULT '0',
	`drafts_created` text DEFAULT '0',
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `thread_run_results` (
	`sync_run_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`sync_run_id`, `thread_id`),
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`drafting_rules` text NOT NULL,
	`agent_provider` text DEFAULT 'gemini' NOT NULL,
	`agent_model` text DEFAULT 'gemini-3-flash-preview' NOT NULL,
	`initial_autodraft_lookback` text DEFAULT '1d' NOT NULL,
	`autodraft_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`email` text,
	`first_name` text,
	`last_name` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_id_unique` ON `users` (`clerk_user_id`);