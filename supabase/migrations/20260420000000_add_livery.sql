-- Migration: add 'livery' (car paint scheme) as a 5th cosmetic category.
-- Date:      2026-04-20
-- Additive:  one new Team column, CHECK constraint widened. Safe to re-run.

-- 1) Add liveryProductId column on Team
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "liveryProductId" TEXT;

-- 2) Widen the UserCosmetic.category CHECK constraint to accept 'livery'.
--    The original constraint was created anonymously inline inside the
--    CREATE TABLE — find its real name in pg_constraint and drop it.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname
    INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public."UserCosmetic"'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%category%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public."UserCosmetic" DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE "UserCosmetic"
  ADD CONSTRAINT "UserCosmetic_category_check"
  CHECK ("category" IN ('emblem','helmet','suit','color','livery'));

-- Rollback (only if required):
--   ALTER TABLE "Team" DROP COLUMN IF EXISTS "liveryProductId";
--   ALTER TABLE "UserCosmetic" DROP CONSTRAINT IF EXISTS "UserCosmetic_category_check";
--   ALTER TABLE "UserCosmetic" ADD CONSTRAINT "UserCosmetic_category_check"
--     CHECK ("category" IN ('emblem','helmet','suit','color'));
