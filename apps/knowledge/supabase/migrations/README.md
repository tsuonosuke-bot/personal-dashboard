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
- `20261005110000_review_grade_hourly.sql` changes the grading job
  (`review-grade-answers`) to run every hour instead of every 15 minutes.
- `20261003100000_review_expected_answer.sql` stores the expected answer with
  each queued question (returned only after answering) and adds
  `discard_review_question` for questions the learner reports as broken.
- `20261004100000_skill_review_queue.sql` adds the knowledge-quiz skill's
  quiz-engine-v2 functions (`direct_quiz_queue_health` / `status` / `pick` /
  `record` / `discard`). The chat skill serves questions from the same review
  queue as the app, grades in the conversation, and records the answer, model
  answer and feedback in `quiz_log` as confirmed. Blank answers and multiple
  choice are corrected in the database as in the app. Integration checks:
  `tests/reviewScheduler.integration.sql`.
- `20261004110000_drop_review_recovery.sql` drops the unused review recovery
  functions (`preview_review_recovery`, `apply_review_recovery`).
- `20261004120000_review_generation_holds.sql` records cards whose generated
  question still failed the checks after one regeneration
  (`review_generation_holds`, `hold_review_generation_failures`). Generation
  candidates skip them for 2 hours, then 6 hours, then 24 hours per consecutive
  failure; a new `content_version` releases them at once and a queued question
  clears the record. `get_review_queue_status` is recreated with
  `generation_held`, and `list_review_generation_holds` lists them.
  Integration checks: `tests/reviewScheduler.integration.sql`.
- `20261004130000_drop_quiz_engine_v1.sql` drops the skill's quiz-engine-v1
  functions and versions `direct_quiz_categories`, which v2 still uses. Apply it
  only after the skill in claude.ai is replaced with the v2 copy in
  `skills/knowledge-quiz/`. The dropped definitions are kept in
  `supabase/archive/quiz_engine_v1.sql`.
- `20261004140000_drop_schedule_backup.sql` drops
  `knowledge_schedule_backup_20260928` (issue #62). It deletes data
  permanently, so the owner runs it.
- `20261004150000_drop_daily_review_queue.sql` drops the fixed per-day review
  queue from `20260920120000` (`daily_review_queues`, `daily_review_queue_items`,
  `pick_daily_review_queue`, `ensure_daily_review_queue`; issue #56). Nothing has
  written the tables since 2026-09-20, and only the quiz-engine-v1 functions
  used them, so it refuses to run until `20261004130000` has been applied.
  `get_daily_review_status` and `daily_review_new_card_ids` stay for the
  dashboard's daily review panel. It deletes data permanently, so the owner runs it. The dropped
  definitions are kept in `supabase/archive/daily_review_queue.sql`.
- `20261005100000_review_batch_health.sql` adds `get_review_batch_health()`
  (issue #61): per batch kind the last successful run, consecutive whole-batch
  failures and the last 24 hours of failed / partially failed runs, plus the
  state of the pg_cron jobs from `cron.job_run_details`. Read-only, service_role
  only. `GET /api/status` returns it as `reviewBatches` (null until applied).

After applying a migration, verify its functions with `pg_get_functiondef` and
verify the new column/trigger through `information_schema` before deploying the
matching Cloudflare Pages build.

- `20261005130000_semantic_embeddings.sql` adds semantic search across
  knowledge, knowledge insights and daily journal entries (issue #45):
  `semantic_embeddings` (one 1024-dim Voyage embedding per source item, with the
  md5 of the embedded text), `semantic_sources()` (the text to embed and what to
  show), `pick_semantic_embedding_targets` / `save_semantic_embeddings` for the
  batch, `search_semantic`, `get_semantic_index_status`, and
  `trigger_embedding_batch()` scheduled hourly at :40 as `semantic-embeddings`
  (same Vault token as the review batches). Without `VOYAGE_API_KEY` the batch
  answers "skipped". The unused `daily_journal.embedding*` columns are kept and
  commented. Service_role only.

- `20261007100000_related_knowledge.sql` adds `related_knowledge(knowledge_id,
  model, per_kind, min_similarity)` for the review answer screen (issue #97):
  the nearest other knowledge, insights on other knowledge and questions, from
  the card's stored embedding (no embedding API call). Read-only; never touches
  quiz_log or the review schedule. Service_role only.

- `20261006100000_question_materials.sql` lets a question (`insight_groups`)
  collect its own materials (issues #94 / #95): `question_embeddings` (the
  guiding question embedded with the semantic-search model, re-made when its
  sha256 changes), `question_material_exclusions` (removed items never return
  for that question), `question_material_state`, `save_question_embedding`,
  `list_question_materials` (nearest items per type, leaving out removed items,
  archived knowledge and insights already added by hand) and
  `list_question_exclusions`. Service_role only.

- `20261005120000_auto_confirm_correct_results.sql` treats correct queue results
  as confirmed when they are recorded (a `BEFORE INSERT OR UPDATE` trigger on
  `quiz_log`, so the instant multiple-choice path and the grading batch are both
  covered) and backfills existing correct results. "未確認の採点結果" then counts
  only 不正解・部分正解, which the dashboard shows as 見直す講評.
