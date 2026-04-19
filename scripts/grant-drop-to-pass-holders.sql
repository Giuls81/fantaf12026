-- grant-drop-to-pass-holders.sql
--
-- Purpose: backfill new race-weekend cosmetic drops to every user who
-- already owns the Season Aesthetic Pass 2026 but wasn't granted the new
-- item by the webhook (because it didn't exist yet at pass-purchase time).
--
-- How to run: paste this whole file into Supabase Dashboard → SQL Editor,
-- EDIT the `new_products` section to list the new drop SKUs + their
-- category, then press Run. Safe to re-run — ON CONFLICT makes it a no-op
-- for users who already own the items.
--
-- Also safe if no one owns the pass yet (0 rows affected).
--
-- Example: you just launched a Monaco-themed emblem + helmet:
--     ('fantaf1.cosmetic.drop.monaco.goldhelmet', 'helmet'),
--     ('fantaf1.cosmetic.drop.monaco.medallion',  'emblem');
--
-- Compatible with the UserCosmetic CHECK constraint which only accepts
-- category ∈ {emblem, helmet, suit, color}.

WITH new_products(product_id, category) AS (
  VALUES
    -- ↓↓↓ EDIT THIS BLOCK ↓↓↓  ( product_id TEXT , category TEXT )
    ('fantaf1.cosmetic.drop.example.item1', 'emblem'),
    ('fantaf1.cosmetic.drop.example.item2', 'helmet')
    -- ↑↑↑ EDIT THIS BLOCK ↑↑↑
),
pass_holders AS (
  SELECT DISTINCT "userId"
  FROM "UserCosmetic"
  WHERE "productId" = 'fantaf1.cosmetic.pass.season2026'
)
INSERT INTO "UserCosmetic" ("id", "userId", "productId", "category", "purchasedAt")
SELECT
  gen_random_uuid()::text,
  ph."userId",
  np.product_id,
  np.category,
  NOW()
FROM pass_holders ph
CROSS JOIN new_products np
ON CONFLICT ("userId", "productId") DO NOTHING;

-- After running, verify with:
--   SELECT "productId", COUNT(*) AS holders
--   FROM "UserCosmetic"
--   WHERE "productId" IN (SELECT product_id FROM (VALUES
--     ('fantaf1.cosmetic.drop.example.item1'),
--     ('fantaf1.cosmetic.drop.example.item2')
--   ) AS t(product_id))
--   GROUP BY "productId";
