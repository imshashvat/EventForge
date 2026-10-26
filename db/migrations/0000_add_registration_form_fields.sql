CREATE TABLE "app"."attempt_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	"option_seed" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_attempt_questions_attempt_q" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "app"."entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"participant_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_entries_event_participant" UNIQUE("event_id","participant_id"),
	CONSTRAINT "uq_entries_event_team" UNIQUE("event_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "app"."event_counters" (
	"event_id" uuid NOT NULL,
	"counter_key" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_counters_event_id_counter_key_pk" PRIMARY KEY("event_id","counter_key")
);
--> statement-breakpoint
CREATE TABLE "app"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"registration_mode" text DEFAULT 'open' NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"max_participants" integer,
	"team_mode" text DEFAULT 'individual' NOT NULL,
	"min_team_size" integer DEFAULT 1 NOT NULL,
	"max_team_size" integer DEFAULT 1 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_events_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"score_watermark" uuid,
	"score_seq" bigint,
	"payload" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"etag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"participant_no" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"form_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"form_id" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_note" text,
	CONSTRAINT "uq_participants_event_user" UNIQUE("event_id","user_id"),
	CONSTRAINT "uq_participants_event_no" UNIQUE("event_id","participant_no")
);
--> statement-breakpoint
CREATE TABLE "app"."question_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"option_text" text NOT NULL,
	"option_image_url" text,
	"is_correct" boolean NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."question_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"stem" text NOT NULL,
	"stem_image_url" text,
	"marks" numeric(10, 4) DEFAULT '1' NOT NULL,
	"neg_marks" numeric(10, 4) DEFAULT '0' NOT NULL,
	"accepted_answers" text[],
	"normalize_case" boolean DEFAULT true NOT NULL,
	"normalize_spaces" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_qv_question_version" UNIQUE("question_id","version_no")
);
--> statement-breakpoint
CREATE TABLE "app"."questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"bank_id" uuid NOT NULL,
	"question_type" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"started_by_participant_id" uuid,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"shuffle_seed" bigint NOT NULL,
	"scored_at" timestamp with time zone,
	"score_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_quiz_attempts_round_entry" UNIQUE("round_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "app"."quiz_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"attempt_question_id" uuid NOT NULL,
	"selected_option_ids" uuid[] DEFAULT '{}' NOT NULL,
	"text_answer" text,
	"client_seq" bigint DEFAULT 0 NOT NULL,
	"answered_by_participant_id" uuid,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_correct" boolean,
	"review_status" text DEFAULT 'auto_graded',
	CONSTRAINT "uq_quiz_responses_attempt_question" UNIQUE("attempt_question_id")
);
--> statement-breakpoint
CREATE TABLE "app"."registration_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"scope_type" text DEFAULT 'global' NOT NULL,
	"event_id" uuid,
	"round_id" uuid,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."round_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"pinned_version_id" uuid,
	"pool_tag" text,
	"pool_draw_n" integer,
	"display_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_round_questions_round_q" UNIQUE("round_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "app"."rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"name" text NOT NULL,
	"round_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"duration_ms" bigint,
	"eligibility" text DEFAULT 'all' NOT NULL,
	"advancement_mode" text DEFAULT 'all' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rounds_event_no" UNIQUE("event_id","round_no")
);
--> statement-breakpoint
CREATE TABLE "app"."score_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"source" text NOT NULL,
	"raw_score" numeric(10, 4) NOT NULL,
	"normalised_score" numeric(10, 4),
	"penalty" numeric(10, 4) DEFAULT '0' NOT NULL,
	"final_score" numeric(10, 4) NOT NULL,
	"superseded_by" uuid,
	"inputs_hash" text,
	"source_ref_id" uuid,
	"computed_by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "app"."score_records_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "app"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"team_no" bigint NOT NULL,
	"status" text DEFAULT 'forming' NOT NULL,
	"captain_participant_id" uuid,
	"join_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_teams_event_name" UNIQUE("event_id","name"),
	CONSTRAINT "uq_teams_event_no" UNIQUE("event_id","team_no"),
	CONSTRAINT "uq_teams_event_code" UNIQUE("event_id","join_code")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_uid" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email_hash" text NOT NULL,
	"avatar_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_users_auth_uid" UNIQUE("auth_uid")
);
--> statement-breakpoint
ALTER TABLE "app"."attempt_questions" ADD CONSTRAINT "attempt_questions_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."quiz_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."attempt_questions" ADD CONSTRAINT "attempt_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "app"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."attempt_questions" ADD CONSTRAINT "attempt_questions_version_id_question_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."question_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entries" ADD CONSTRAINT "entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entries" ADD CONSTRAINT "entries_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "app"."participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entries" ADD CONSTRAINT "entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."event_counters" ADD CONSTRAINT "event_counters_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."participants" ADD CONSTRAINT "participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."participants" ADD CONSTRAINT "participants_form_id_registration_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "app"."registration_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."participants" ADD CONSTRAINT "participants_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."question_banks" ADD CONSTRAINT "question_banks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."question_banks" ADD CONSTRAINT "question_banks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."question_options" ADD CONSTRAINT "question_options_version_id_question_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "app"."question_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."question_versions" ADD CONSTRAINT "question_versions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "app"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."questions" ADD CONSTRAINT "questions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."questions" ADD CONSTRAINT "questions_bank_id_question_banks_id_fk" FOREIGN KEY ("bank_id") REFERENCES "app"."question_banks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "app"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "app"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_started_by_participant_id_participants_id_fk" FOREIGN KEY ("started_by_participant_id") REFERENCES "app"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_responses" ADD CONSTRAINT "quiz_responses_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "app"."quiz_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_responses" ADD CONSTRAINT "quiz_responses_attempt_question_id_attempt_questions_id_fk" FOREIGN KEY ("attempt_question_id") REFERENCES "app"."attempt_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quiz_responses" ADD CONSTRAINT "quiz_responses_answered_by_participant_id_participants_id_fk" FOREIGN KEY ("answered_by_participant_id") REFERENCES "app"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."registration_forms" ADD CONSTRAINT "registration_forms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."round_questions" ADD CONSTRAINT "round_questions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "app"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."round_questions" ADD CONSTRAINT "round_questions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."round_questions" ADD CONSTRAINT "round_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "app"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."round_questions" ADD CONSTRAINT "round_questions_pinned_version_id_question_versions_id_fk" FOREIGN KEY ("pinned_version_id") REFERENCES "app"."question_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rounds" ADD CONSTRAINT "rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rounds" ADD CONSTRAINT "rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."score_records" ADD CONSTRAINT "score_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."score_records" ADD CONSTRAINT "score_records_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "app"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."score_records" ADD CONSTRAINT "score_records_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "app"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."score_records" ADD CONSTRAINT "score_records_computed_by_user_id_users_id_fk" FOREIGN KEY ("computed_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."teams" ADD CONSTRAINT "teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_questions_attempt_idx" ON "app"."attempt_questions" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "entries_event_idx" ON "app"."entries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "app"."events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "app"."events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "lb_snapshots_event_scope_idx" ON "app"."leaderboard_snapshots" USING btree ("event_id","scope","version");--> statement-breakpoint
CREATE INDEX "participants_event_idx" ON "app"."participants" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "participants_user_idx" ON "app"."participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "participants_status_idx" ON "app"."participants" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "question_banks_event_idx" ON "app"."question_banks" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "question_options_version_idx" ON "app"."question_options" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "question_versions_question_idx" ON "app"."question_versions" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "questions_bank_idx" ON "app"."questions" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "questions_event_idx" ON "app"."questions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_round_idx" ON "app"."quiz_attempts" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_entry_idx" ON "app"."quiz_attempts" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_status_idx" ON "app"."quiz_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quiz_responses_attempt_idx" ON "app"."quiz_responses" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "app"."role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_event_idx" ON "app"."role_assignments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "round_questions_round_idx" ON "app"."round_questions" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "rounds_event_idx" ON "app"."rounds" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "rounds_status_idx" ON "app"."rounds" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "score_records_round_entry_idx" ON "app"."score_records" USING btree ("round_id","entry_id");--> statement-breakpoint
CREATE INDEX "score_records_event_idx" ON "app"."score_records" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "teams_event_idx" ON "app"."teams" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "users_auth_uid_idx" ON "app"."users" USING btree ("auth_uid");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "app"."users" USING btree ("status");