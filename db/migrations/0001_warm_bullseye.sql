CREATE TABLE "app"."calculated_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"final_score" numeric(10, 4),
	"rank" integer,
	"tie_status" text DEFAULT 'none' NOT NULL,
	"advancement_status" text,
	"entry_status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"round_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_calculated_results_run_entry" UNIQUE("run_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "app"."challenge_starts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"started_by_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_challenge_starts_task_entry" UNIQUE("task_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "app"."challenge_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"allowed_url_types" jsonb DEFAULT '["github_repo"]'::jsonb NOT NULL,
	"allow_http" boolean DEFAULT false NOT NULL,
	"video_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"clock_mode" text DEFAULT 'fixed_window' NOT NULL,
	"time_limit_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."evaluation_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"max_marks" numeric(10, 4) NOT NULL,
	"weight" numeric(8, 6),
	"display_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."evaluation_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"method" text NOT NULL,
	"manual_value" numeric(10, 4),
	"reason" text NOT NULL,
	"resolved_by_user_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."evaluation_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aggregation" text DEFAULT 'mean' NOT NULL,
	"variance_threshold_pct" numeric(5, 2) DEFAULT '20' NOT NULL,
	"min_judges" integer DEFAULT 1 NOT NULL,
	"blind" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rubrics_round" UNIQUE("round_id")
);
--> statement-breakpoint
CREATE TABLE "app"."judge_evaluation_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"marks_awarded" numeric(10, 4) NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_eval_scores_eval_criterion" UNIQUE("evaluation_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE "app"."judge_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"judge_user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."judging_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"judge_user_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_judging_assignment_sub_judge" UNIQUE("submission_id","judge_user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."result_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"run_no" integer NOT NULL,
	"status" text DEFAULT 'dry_run' NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"triggered_by_user_id" uuid,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"superseded_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_result_runs_event_no" UNIQUE("event_id","run_no")
);
--> statement-breakpoint
CREATE TABLE "app"."submission_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"is_draft" boolean DEFAULT true NOT NULL,
	"urls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"is_late" boolean DEFAULT false NOT NULL,
	"submitted_by_participant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_submission_revisions_sub_no" UNIQUE("submission_id","revision_no")
);
--> statement-breakpoint
CREATE TABLE "app"."submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"counted_revision_id" uuid,
	"status" text DEFAULT 'not_started' NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_submissions_task_entry" UNIQUE("task_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "app"."calculated_results" ADD CONSTRAINT "calculated_results_run_id_result_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."result_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calculated_results" ADD CONSTRAINT "calculated_results_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calculated_results" ADD CONSTRAINT "calculated_results_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "app"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."challenge_starts" ADD CONSTRAINT "challenge_starts_task_id_challenge_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."challenge_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."challenge_starts" ADD CONSTRAINT "challenge_starts_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "app"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."challenge_starts" ADD CONSTRAINT "challenge_starts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."challenge_starts" ADD CONSTRAINT "challenge_starts_started_by_participant_id_participants_id_fk" FOREIGN KEY ("started_by_participant_id") REFERENCES "app"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."challenge_tasks" ADD CONSTRAINT "challenge_tasks_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "app"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."challenge_tasks" ADD CONSTRAINT "challenge_tasks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_criteria" ADD CONSTRAINT "evaluation_criteria_rubric_id_evaluation_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "app"."evaluation_rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_criteria" ADD CONSTRAINT "evaluation_criteria_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_resolutions" ADD CONSTRAINT "evaluation_resolutions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_resolutions" ADD CONSTRAINT "evaluation_resolutions_rubric_id_evaluation_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "app"."evaluation_rubrics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_resolutions" ADD CONSTRAINT "evaluation_resolutions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_resolutions" ADD CONSTRAINT "evaluation_resolutions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_rubrics" ADD CONSTRAINT "evaluation_rubrics_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "app"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evaluation_rubrics" ADD CONSTRAINT "evaluation_rubrics_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judge_evaluation_scores" ADD CONSTRAINT "judge_evaluation_scores_evaluation_id_judge_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "app"."judge_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judge_evaluation_scores" ADD CONSTRAINT "judge_evaluation_scores_criterion_id_evaluation_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "app"."evaluation_criteria"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judge_evaluations" ADD CONSTRAINT "judge_evaluations_assignment_id_judging_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "app"."judging_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judge_evaluations" ADD CONSTRAINT "judge_evaluations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judge_evaluations" ADD CONSTRAINT "judge_evaluations_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judge_evaluations" ADD CONSTRAINT "judge_evaluations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judging_assignments" ADD CONSTRAINT "judging_assignments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judging_assignments" ADD CONSTRAINT "judging_assignments_judge_user_id_users_id_fk" FOREIGN KEY ("judge_user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judging_assignments" ADD CONSTRAINT "judging_assignments_rubric_id_evaluation_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "app"."evaluation_rubrics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judging_assignments" ADD CONSTRAINT "judging_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."judging_assignments" ADD CONSTRAINT "judging_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."result_runs" ADD CONSTRAINT "result_runs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."result_runs" ADD CONSTRAINT "result_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submission_revisions" ADD CONSTRAINT "submission_revisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submission_revisions" ADD CONSTRAINT "submission_revisions_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "app"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submission_revisions" ADD CONSTRAINT "submission_revisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submission_revisions" ADD CONSTRAINT "submission_revisions_submitted_by_participant_id_participants_id_fk" FOREIGN KEY ("submitted_by_participant_id") REFERENCES "app"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_task_id_challenge_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."challenge_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "app"."entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculated_results_run_idx" ON "app"."calculated_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "calculated_results_entry_idx" ON "app"."calculated_results" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "challenge_starts_entry_idx" ON "app"."challenge_starts" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "challenge_tasks_round_idx" ON "app"."challenge_tasks" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "eval_criteria_rubric_idx" ON "app"."evaluation_criteria" USING btree ("rubric_id");--> statement-breakpoint
CREATE INDEX "eval_resolutions_submission_idx" ON "app"."evaluation_resolutions" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "rubrics_event_idx" ON "app"."evaluation_rubrics" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "eval_scores_evaluation_idx" ON "app"."judge_evaluation_scores" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "judge_evaluations_assignment_idx" ON "app"."judge_evaluations" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "judge_evaluations_event_idx" ON "app"."judge_evaluations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "judging_assignments_judge_idx" ON "app"."judging_assignments" USING btree ("judge_user_id");--> statement-breakpoint
CREATE INDEX "judging_assignments_event_idx" ON "app"."judging_assignments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "result_runs_event_idx" ON "app"."result_runs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "submission_revisions_submission_idx" ON "app"."submission_revisions" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_entry_idx" ON "app"."submissions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "submissions_event_idx" ON "app"."submissions" USING btree ("event_id");