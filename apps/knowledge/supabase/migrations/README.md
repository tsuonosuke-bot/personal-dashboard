# Supabase migrations

These migrations target the `knowledge-db` Supabase project
(`plwlxwidpqbunugfxjhp`). Apply them in filename order before deploying an app
build that depends on them.

- `20260920080000_version_quiz_functions.sql` records the pre-existing quiz
  functions that were previously present only in production.
- `20260920090000_review_fixes.sql` adds optimistic concurrency, atomic
  once-per-day answer recording, per-card note retrieval, and one-time SSO
  handoff consumption.
- `20260920100000_knowledge_priority.sql` adds five per-card review-priority
  levels, treats the previous cadence as `高`, preserves an unscaled base
  interval, adjusts scheduled dates, and prefers higher-priority cards within
  the same quiz pool.
- `20260921130000_speaking_practice.sql` adds an idempotent speaking-practice
  log and write RPC. These records never update `quiz_log`, mastery, or the
  review schedule.
- `20260923090000_knowledge_mastery_history.sql` records every mastery change
  (plus one baseline row per existing card) so mastery counts can be charted
  over time. The trigger function is `SECURITY DEFINER` so every writer of
  `knowledge` can append history without direct table rights.
- `20260924100000_knowledge_insights.sql` stores personal takeaways by knowledge
  entry, independently of quiz selection, grading, and review scheduling.
- `20260925100000_insight_groups.sql` stores user-curated questions and
  many-to-many links to existing insights. Group or membership deletion never
  deletes an insight; deleting an insight removes its memberships. Organizing
  groups does not change quiz history or the review schedule. It updates
  `dashboard_schema_versions` and reloads the PostgREST schema cache.

- `20260928100000_review_pacing.sql` grows strong due recalls faster (q4
  2 days / x2.0, q5 4 days / x2.8), scales the next interval by priority
  (never the stored stability), reschedules on priority-only edits from the new
  `scheduled_from_at` anchor, applies priority once to already-scheduled cards
  (only in each priority's direction), and caps never-asked cards entering the
  daily queue at 10 per JST day. `get_daily_review_status` gains `new_limit` and
  `new_held`. Integration checks: `tests/reviewScheduler.integration.sql`.

- `20260928110000_direct_quiz_count_new_cap.sql` makes the knowledge-quiz
  skill's `direct_quiz_count('daily')` return `get_daily_review_status.remaining`,
  so held-back new cards are not counted. `direct_quiz_*` functions were created
  outside this repository; only this one is versioned here.

- `20261002100000_review_queue.sql` adds the review question/answer queue
  (`review_queue`), batch run records (`review_batch_runs`), history columns on
  `quiz_log`, and the functions for generation candidates, enqueueing (200-item
  limit), serving, answering, grading claims, exactly-once recording from the
  answer time, and status. `record_answer` gains `p_answered_at`.
  Integration checks: `tests/reviewScheduler.integration.sql`.
- `20261002110000_review_batch_trigger.sql` enables `pg_net` and adds
  `trigger_review_batch(kind)`, which calls the app's batch endpoints with the
  Vault secret `review_batch_token`. Cron schedules are added separately.
- `20261002120000_review_batch_schedule.sql` schedules question generation
  every 30 minutes and grading every 15 minutes through pg_cron. Without the
  Vault secret the jobs only log a warning.
- `20261003100000_review_expected_answer.sql` stores the expected answer with
  each queued question (returned only after answering) and adds
  `discard_review_question` for questions the learner reports as broken.
- `20261004120000_review_generation_holds.sql` records cards whose generated
  question still failed the checks after one regeneration
  (`review_generation_holds`, `hold_review_generation_failures`). Generation
  candidates skip them for 2 hours, then 6 hours, then 24 hours per consecutive
  failure; a new `content_version` releases them at once and a queued question
  clears the record. `get_review_queue_status` is recreated with
  `generation_held`, and `list_review_generation_holds` lists them.
  Integration checks: `tests/reviewScheduler.integration.sql`.

After applying a migration, verify its functions with `pg_get_functiondef` and
verify the new column/trigger through `information_schema` before deploying the
matching Cloudflare Pages build.
