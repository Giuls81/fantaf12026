-- Migration: add user cosmetics infrastructure (Phase 4a)
-- Date:      2026-04-17
-- Reason:    Supports cosmetic IAPs (emblems, helmets, suits, colors) +
--            RevenueCat webhook idempotency.
--
-- Safety:    Fully additive. No DROP, no TRUNCATE, no DELETE.
--            All `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` so re-runs are safe.
--            Mirrors the runtime defensive pattern used by `ensureTeamPenaltyTable`
--            in supabase/functions/fanta-api/index.ts.
--
-- Rollback (only if required):
--   DROP INDEX IF EXISTS "UserCosmetic_user_product_idx";
--   DROP INDEX IF EXISTS "UserCosmetic_user_idx";
--   DROP TABLE IF EXISTS "UserCosmetic";
--   DROP TABLE IF EXISTS "WebhookEvent";
--   ALTER TABLE "Team"
--     DROP COLUMN IF EXISTS "emblemProductId",
--     DROP COLUMN IF EXISTS "helmetProductId",
--     DROP COLUMN IF EXISTS "suitProductId",
--     DROP COLUMN IF EXISTS "colorProductId";

CREATE TABLE IF NOT EXISTS "UserCosmetic" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "productId"   TEXT NOT NULL,
  "category"    TEXT NOT NULL CHECK ("category" IN ('emblem','helmet','suit','color')),
  "purchasedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserCosmetic_user_product_idx"
  ON "UserCosmetic"("userId", "productId");

CREATE INDEX IF NOT EXISTS "UserCosmetic_user_idx"
  ON "UserCosmetic"("userId");

-- Equipped cosmetics live on Team (one team per user per league).
-- Null means "default" (use the constructor color / no emblem / etc.).
ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "emblemProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "helmetProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "suitProductId"   TEXT,
  ADD COLUMN IF NOT EXISTS "colorProductId"  TEXT;

-- Webhook idempotency log. RevenueCat retries on non-2xx; we dedupe by event id.
CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id"         TEXT PRIMARY KEY,
  "source"     TEXT NOT NULL,
  "receivedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);
