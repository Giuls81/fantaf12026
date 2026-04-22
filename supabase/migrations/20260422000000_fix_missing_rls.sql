-- Fix for Supabase advisor CRITICAL alerts raised on 2026-04-19:
--   - rls_disabled_in_public  (table publicly accessible)
--   - sensitive_column_exposed (TeamPenalty + User data via anon API)
--   - function_search_path_mutable (is_lineup_locked)
--
-- Applied to the live DB on 2026-04-22 via Supabase MCP.
-- Committed here for the migration ledger.
--
-- No RLS POLICIES are added: the Edge Function connects via postgres.js
-- using the session pooler at service_role level, which bypasses RLS.
-- Public anon/authenticated API must never hit these tables; enabling RLS
-- with zero policies blocks the anon path while keeping the backend working.

-- TeamPenalty: created on-demand by the backend (ensureTeamPenaltyTable in
-- supabase/functions/fanta-api/index.ts). The CREATE TABLE IF NOT EXISTS
-- helper historically did not enable RLS. Fixed here, and the helper is
-- patched in the same commit so future recreations enable RLS too.
ALTER TABLE "TeamPenalty" ENABLE ROW LEVEL SECURITY;

-- _prisma_migrations: Prisma schema ledger, only used by migration tooling.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- is_lineup_locked(): pin search_path for predictable resolution.
ALTER FUNCTION public.is_lineup_locked() SET search_path = public, pg_temp;
