# Database types

`database.types.ts` is Supabase's generated schema metadata, downloaded from the
project Dashboard on 2026-10-26 (JST). It contains no data rows or credentials.
It is imported with `import type`; the generated runtime `Constants` is unused.

Regenerate after applying a reviewed migration to the intended database:

```sh
node scripts/database-types.mjs
node scripts/database-types.mjs --check
npm run typecheck
```

Set `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` only in your environment
(Management API `database:read`; a database secret key is not this token).
The endpoint is the official [Generate TypeScript types API](https://supabase.com/docs/reference/api/v1-generate-typescript-types).
The scripts never apply SQL. For a Dashboard export, use Data API → Docs →
Tables and Views → Introduction → Generate and download types, then:

```sh
node scripts/database-types.mjs --input /path/to/supabase.ts
node scripts/database-types.mjs --input /path/to/supabase.ts --check
```

Review generated names, enum literals and function signatures before publishing
to this public repository. The importer rejects credentials and URLs; this is
an additional guard, not a replacement for review. No automatic live-schema
job is enabled: pull requests from forks must never receive a management token.
Use `--check` in a trusted, manually invoked environment for live drift detection.
Normal CI typechecks the checked-in snapshot; it cannot attest to a live schema.

App types select the columns their APIs actually return and narrow strings only
where runtime validation enforces a documented vocabulary. Enriched fields such
as `auto_tags` are API fields, not generated database columns. Keep runtime input
and response validation: a TypeScript type does not validate untrusted JSON.
