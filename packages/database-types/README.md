# Database types

`database.types.ts` is Supabase's generated schema metadata, regenerated from the
production database on 2026-10-26 (JST) with the official Supabase CLI 2.117.0,
after applying the eight reviewed migrations for Issues #275–#300. The trusted
[release run](https://github.com/tsuonosuke-bot/personal-dashboard/actions/runs/40283256215)
verified the migration history, permissions and preservation of existing data.
The export includes `public,graphql_public`; it contains no data rows or credentials.
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

Generated RPC argument and return nullability follows the CLI generator's
conventions. Keep runtime validation and explicit nullable application types
where SQL can return null; do not infer runtime non-null guarantees from these
generated RPC signatures.

App types select the columns their APIs actually return and narrow strings only
where runtime validation enforces a documented vocabulary. Enriched fields such
as `auto_tags` are API fields, not generated database columns. Keep runtime input
and response validation: a TypeScript type does not validate untrusted JSON.
