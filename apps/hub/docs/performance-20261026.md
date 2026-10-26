# Hub performance changes, 2026-10-26

Scope: C02 #276, C04 #278, C07 #281, C08 #282, C09 #283,
C10 #284, C11 #285, C12 #286, C13 #287, C14 #288, C15 #289, C16 #290.

These are local implementation and synthetic-test results. They do not establish
production latency, deployed SQL state, or a production release.

## Read contracts

- Hub calls `get_hub_local_summary(source,today)` independently for Inbox, Wants,
  Focus, Projects, Writing, and Habits. Counts are calculated in PostgreSQL;
  Inbox returns its oldest three pending rows and Focus its five active rows.
  Finance and Knowledge expose private `GET /api/hub-summary?today=` contracts.
  Journal remains date bounded. Every source has a 6-second response deadline;
  failed sections retain unavailable/null values, and a new request can recover.
- `GET /api/today` shares one request-local ToDo result with Project normalization.
  It reads pending ToDos plus today's completions; no process-global result cache
  is used. Habit loading remains an independent section in the browser.
- `GET /api/scheduled-actions` defaults to `scope=current`. `scope=history` reads
  50 terminal rows per page, with `nextOffset`; `ids=` explicitly reads selected
  rows. Related routes/Wants are fetched only by the selected source IDs.
  Google reads use four workers, a 6-second event deadline, and one bounded
  retry for rate limits/transport failures. Unknown events are unavailable,
  while only 404/410 are missing. A detail action retries one unavailable ToDo.
- `GET /api/projects` returns a selected list page with full-database counts,
  Next Actions, and count/activity metadata. `id=` loads one Project's open
  Actions, milestones, ten terminal Actions, and fifty related Items. History
  and Item offsets can reach the final page. Search includes all Action/Item
  history in PostgreSQL and trims the query as the previous client did.
  Weekly review reads current Actions and this week's completions only.
- Project mutations return `partial:true` and only the affected Project.
  Browser merges retain unrelated Projects, preserve full-query counts, and
  use the database's exact search-match flag after editing a record.
- `GET /api/dashboard` selects Inbox, Wants, or summary data. List pages contain
  fifty rows, separate totals/status/category counts, and compact provenance.
  An Inbox page never transfers Wants or route-history rows. A Want's history
  is loaded in fifty-row detail pages. Current/planned destinations retain the
  existing created-over-planned precedence and legacy `result` fallback.
  Search covers the whole selected dataset. Explicit bulk selection traverses
  all matching pages before enabling all-result selection; this is not an
  initial-page background full fetch. Status updates split snapshots into
  API batches of at most 100, preserving partial results and retry targets.
  Confirmed bulk results and failed-item snapshots are committed before list
  refreshes; an offline later page cannot reselect successful items or lose
  retry keys/original predicates. Refresh errors have a separate message.
- Non-Calendar Idea edits apply the saved row locally. Calendar routes invalidate
  the ToDo view; opening that view synchronizes it. Inbox bulk routes use three
  workers, reuse per-item idempotency keys, and stop launching new items on stop.
  Bulk status updates retain per-item optimistic predicates with four workers.
- Habit saves return a normalized target Habit, its previous-week row, and only
  its currently displayed history period. The browser merges those rows without
  hiding the screen. A late week-save response cannot cancel month navigation;
  a history request predating a save retries the requested period.

## Confirmed Calendar read cache

`project_todo_read_cache` is service-role-only, references a ToDo with delete
cascade, and stores its `updated_at` version, confirmed schedule/date, and read
start time. It never edits the ToDo's original schedule, ETag, or version.
`record_project_todo_read_cache` ignores snapshots of a changed ToDo and refuses
to overwrite a newer read with an older request. Counts consume a cache row only
while the ToDo version still matches. Initial Project reads synchronize all
current next/queued Calendar links through one union of required ToDo IDs; Today
reuses its already-read ToDos. Saving one Project refreshes only its links and
uses database-wide counts for the remainder. If a Google read fails, the selected
Action and count both use the same prior schedule, retain the unavailable marker,
and do not record the failure as a confirmed cache snapshot.

## Local evidence

`tests/performanceReads.test.ts` exercises compact Hub reads, held-source recovery,
request sharing, ToDo/history isolation, bounded Google reads and per-ID retry,
scoped Project refresh and live review counts, search invalidation, linear
milestone classification, empty/tab-specific Idea reads, actual Inbox edit
submissions, mixed-result bulk work, and Habit snapshot/navigation races.
Existing tests retain mutation validation, timestamp precision, ETag conflicts,
Next Action resolution, route idempotency, and Habit history/skip/weekly targets.

| Scenario | Before/reference | New local result |
| --- | --- | --- |
| Eight pending ToDos, one Project link | Two schedule-list reads, 16 Google GETs | One table read, 8 Google GETs |
| One pending, 6 then 106 completed, one skipped | All event IDs synchronized initially | One current row and one Google GET in both cases |
| Eight Google events with 429, held request, failure, missing | Unbounded all-or-nothing read | Maximum four; six usable events, two unknown failures; retry only those two |
| Actions and milestones 100/200/400 | 10,000/40,000/160,000 classifications per side | 100/200/400 per side, unchanged ordering/count semantics |
| Twenty Inbox body edits | Each edit also started a ToDo refresh | Twenty Inbox PATCHes; zero ToDo or Google reads; 409 applies no local success |
| Forty jobs, identical 5ms mock delay | One worker: 616.4ms | Four workers: 153.6ms; API/DB row-write count remains 40 |
| One Habit snapshot refresh | All definitions and a full history refresh | One target definition and one target log-range read |

Queue timing is a Windows/Node synthetic measurement and includes local timer
granularity. It is not Google, Supabase, browser-render, or production latency.
PostgreSQL fixture size/transfer comparisons and PC/phone browser evidence are
recorded by the integration/review work alongside this change.

## Apply order

Apply the three new Hub migrations before deploying the Hub Functions. Apply the
Finance/Knowledge summary contracts before the Hub begins requesting them.
The new functions use invoker security and service-role-only execution. Old
migrations remain unchanged. Production application, data-preservation checks,
and live API/UI verification require the release owner's authorized workflow.
