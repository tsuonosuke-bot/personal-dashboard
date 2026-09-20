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

After applying a migration, verify its functions with `pg_get_functiondef` and
verify the new column/trigger through `information_schema` before deploying the
matching Cloudflare Pages build.
