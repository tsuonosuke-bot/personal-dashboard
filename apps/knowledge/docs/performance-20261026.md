# Knowledge performance checks, 2026-10-26

This change implements #275, #279, #280 and #296–#300. Production data and
production timing are not part of these local results. New SQL must be reviewed
and applied before deploying the dependent app. Existing migrations are unchanged.

`node apps/knowledge/scripts/measure-performance-reads.mjs` reproduces the
synthetic measurements in [performance-measurements-20261026.json](performance-measurements-20261026.json).
The run uses Node v24.19.0 on Windows x64, one warm-up followed by five samples,
and reports the median. API fetches return in-memory JSON: times include the
actual client parsing/validation, but no real network latency or database time.

| Check | Before | After |
| --- | --- | --- |
| Initial read, 1,000 active + 500 archived cards, 1,000 logs | 4 requests, 2,737,651 bytes, 52.67 ms | 3 requests, 791,132 bytes, 18.51 ms |
| Same cards, 5,000 logs | 9 requests, 8,961,466 bytes, 164.17 ms | 3 requests, 791,276 bytes, 17.09 ms |
| Same cards, 10,000 logs | 14 requests, 16,741,186 bytes, 232.00 ms | 3 requests, 791,280 bytes, 11.21 ms |
| Today filter, 1,000 cards | 63.48 ms, 1,000 formatter constructions | 0.23 ms, zero formatter constructions |
| Today filter, 5,000 cards | 374.52 ms, 5,000 formatter constructions | 2.05 ms, zero formatter constructions |
| Card mastery, 100 other cards with 31 events each | 3,131 rows, 380,493 bytes | 10 events + one predecessor, 1,353 bytes |
| Card mastery, 1,000 other cards with 31 events each | 31,031 rows, 3,832,355 bytes | 10 events + one predecessor, 1,353 bytes |

The new initial path transfers zero quiz-log bodies and zero archived-card
bodies. Its third request is the dashboard aggregate; active-list readiness does
not wait for that request. The comparison covers these three read operations,
not unrelated queue/insight requests that were present before and after.

The original weekly graph recalculated the whole log on every mouse move. In
the local function model, ten recalculations cost 170.88 ms at 10,000 logs and
2,251.89 ms at 100,000 logs. Current chart components accept only aggregates;
hover changes tooltip state and has no access to log bodies. The microbenchmark
for aggregate access is not a browser render, event latency or long-task result.
PC/mobile interaction and browser long tasks must be recorded separately.

`tests/performanceReads.test.ts` covers the actual new API/client boundaries:

- A 30-body page and a 1,098-ID snapshot remain separate. The confirmation
  coordinator freezes that set, posts 200 IDs per chunk, shares its synchronous
  lock with individual confirmation, and reconciles only those IDs after partial
  failure. The test confirms 400, fails the next chunk, then verifies/retries the
  remaining 698 without reading other history bodies or adding a new result.
- State-read truncation is a failed read, not evidence that omitted rows were
  deleted. A failed reload also prevents verified completion.
- A card's mastery query requests its UUID and at most 11 rows; the predecessor
  supplies the value before the last visible event. Card/answer hooks discard old
  requests on close, card change, reload and retry.
- Twenty memberships use one browser request and one DB RPC instead of twenty
  browser requests and up to eighty DB requests. The group timestamp is checked
  under its lock; success/failed IDs and the final timestamp come back together.
- Thirty grades use one DB RPC instead of thirty serial DB requests. Existing
  per-answer scheduling, archive/stale-answer disposal and idempotency remain in
  `record_review_grade`. Per-item errors are released inside the same RPC;
  an unknown HTTP outcome uses one batch release, without another AI request.
- A deliberately blocked generation path proves the grading HTTP response is
  returned before generation finishes. `waitUntil` receives exactly one server
  continuation. A second grading request does not save those grades or claim the
  running generation again. Persistent jobs/run state support cron recovery.

The theme SQL keeps manual/automatic tags, tagged insights, exclusions, the 0.65
threshold and per-kind bounds in one implementation. Its one-theme path now
applies `p_tag` before the embedding cross join/window functions. Real-vector
PostgreSQL EXPLAIN ANALYZE, old/new result ordering and DB concurrency checks
are independent integration evidence and are not represented by the Node timings.

Local verification: Knowledge typecheck, all 320 tests, Vite production build
and the Wrangler Pages Functions build passed. Sandbox process restrictions
required the ordinary build/test commands to run with permission to spawn their
local helper processes. No production deployment or data mutation was performed.
