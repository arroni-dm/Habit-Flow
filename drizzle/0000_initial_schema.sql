CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "week_start_preference" integer DEFAULT 1 NOT NULL,
  "onboarding_completed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique_idx" ON "users" ("email");

CREATE TABLE IF NOT EXISTS "user_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "theme" text DEFAULT 'dark' NOT NULL,
  "locale" text DEFAULT 'en-US' NOT NULL,
  "default_date_range" text DEFAULT '30d' NOT NULL,
  "notification_preferences" jsonb DEFAULT '{"inAppEnabled":true,"browserPushEnabled":false,"dailyDigestEnabled":true,"streakMilestonesEnabled":true}'::jsonb NOT NULL,
  "reminder_preferences" jsonb DEFAULT '{"remindersEnabled":true,"quietHoursStart":"22:30","quietHoursEnd":"06:30","defaultReminderTime":"08:00"}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_user_id_unique_idx" ON "user_settings" ("user_id");

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "csrf_token" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "user_sessions_expires_at_idx" ON "user_sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_unique_idx" ON "password_reset_tokens" ("token_hash");

CREATE TABLE IF NOT EXISTS "habits" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "category" text DEFAULT 'Personal Development' NOT NULL,
  "icon" text DEFAULT 'CheckCircle2' NOT NULL,
  "color" text DEFAULT '#C6FF00' NOT NULL,
  "habit_type" text DEFAULT 'boolean' NOT NULL,
  "schedule_type" text DEFAULT 'daily' NOT NULL,
  "schedule_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "target_value" double precision DEFAULT 1 NOT NULL,
  "target_unit" text,
  "start_date" text NOT NULL,
  "end_date" text,
  "reminder_time" text,
  "completion_deadline" text,
  "priority" text DEFAULT 'medium' NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "archived_local_date" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "habits_user_status_idx" ON "habits" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "habits_user_order_idx" ON "habits" ("user_id", "display_order");

CREATE TABLE IF NOT EXISTS "habit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "habit_id" integer NOT NULL REFERENCES "habits"("id") ON DELETE CASCADE,
  "local_date" text NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "numeric_value" double precision,
  "duration_seconds" integer,
  "notes" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "habit_logs_user_habit_date_unique_idx" ON "habit_logs" ("user_id", "habit_id", "local_date");
CREATE INDEX IF NOT EXISTS "habit_logs_user_date_idx" ON "habit_logs" ("user_id", "local_date");
CREATE INDEX IF NOT EXISTS "habit_logs_habit_date_idx" ON "habit_logs" ("habit_id", "local_date");

CREATE TABLE IF NOT EXISTS "goals" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "habit_id" integer REFERENCES "habits"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "goal_type" text NOT NULL,
  "target_value" double precision NOT NULL,
  "target_unit" text,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "goals_user_status_idx" ON "goals" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "habit_id" integer REFERENCES "habits"("id") ON DELETE SET NULL,
  "dedupe_key" text,
  "type" text DEFAULT 'reminder' NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "scheduled_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "status" text DEFAULT 'unread' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_unique_idx" ON "notifications" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at");
