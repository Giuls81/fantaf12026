-- FantaF1 2026: Row Level Security & Lineup Lock Policies
-- Run this script in the Supabase SQL Editor

-- 1. Enable RLS on all relevant tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "League" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeagueMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamDriver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Race" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Driver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamResultDriver" ENABLE ROW LEVEL SECURITY;


-- 2. Create the Lineup Lock check function
-- This function returns TRUE if the next incomplete race's qualifying has started.
CREATE OR REPLACE FUNCTION is_lineup_locked()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_race_qualifying_utc TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Find the qualifying time of the next race that hasn't been completed yet
  SELECT "qualifyingUtc" INTO next_race_qualifying_utc
  FROM "Race"
  WHERE "isCompleted" = false
  ORDER BY "date" ASC
  LIMIT 1;

  -- If no future races or no qualifying time set, default to NOT locked (return false)
  IF next_race_qualifying_utc IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Lock if current time in UTC is past the qualifying time
  RETURN now() > next_race_qualifying_utc;
END;
$$;

-- ==========================================
-- POLICIES
-- ==========================================

-- --- User Table ---
-- Anyone can read basic user info (needed for standings)
CREATE POLICY "Users can read all users" ON "User" FOR SELECT USING (true);
-- Users can only update their own profile
CREATE POLICY "Users can update own profile" ON "User" FOR UPDATE USING (auth.uid()::text = id) WITH CHECK (auth.uid()::text = id);

-- --- League & LeagueMember ---
CREATE POLICY "Anyone can read leagues" ON "League" FOR SELECT USING (true);
CREATE POLICY "Anyone can read league members" ON "LeagueMember" FOR SELECT USING (true);
-- Authenticated users can insert into LeagueMember (when joining)
CREATE POLICY "Users can join leagues" ON "LeagueMember" FOR INSERT WITH CHECK (auth.uid()::text = "userId");

-- --- Team Table ---
CREATE POLICY "Anyone can read teams" ON "Team" FOR SELECT USING (true);
-- Insert: User must own the team
CREATE POLICY "Users can create their own teams" ON "Team" FOR INSERT WITH CHECK (auth.uid()::text = "userId");
-- Update: User must own the team AND lineup must not be locked
CREATE POLICY "Users can update their own teams if unlocked" ON "Team" FOR UPDATE 
USING (auth.uid()::text = "userId" AND NOT is_lineup_locked()) 
WITH CHECK (auth.uid()::text = "userId" AND NOT is_lineup_locked());
-- Note: 'totalPoints' updates are bypassed by Edge Functions using the service_role key, so this RLS only blocks frontend updates.
-- Delete: User must own the team
CREATE POLICY "Users can delete their own teams" ON "Team" FOR DELETE USING (auth.uid()::text = "userId");

-- --- TeamDriver Table (Lineups) ---
CREATE POLICY "Anyone can read team drivers" ON "TeamDriver" FOR SELECT USING (true);
-- To modify a lineup, the user must own the Team, AND the lineup must not be locked.
CREATE POLICY "Users can manage their team drivers if unlocked" ON "TeamDriver"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "Team" 
    WHERE "Team".id = "TeamDriver"."teamId" 
    AND "Team"."userId" = auth.uid()::text
  )
  AND NOT is_lineup_locked()
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "Team" 
    WHERE "Team".id = "TeamDriver"."teamId" 
    AND "Team"."userId" = auth.uid()::text
  )
  AND NOT is_lineup_locked()
);

-- --- Read-Only Tables (Managed by Admins/Edge Functions) ---
-- These tables can be read by everyone, but modified by nobody via the frontend API key.
-- (Service_role API keys in Edge Functions bypass RLS automatically)
CREATE POLICY "Anyone can read races" ON "Race" FOR SELECT USING (true);
CREATE POLICY "Anyone can read drivers" ON "Driver" FOR SELECT USING (true);
CREATE POLICY "Anyone can read team results" ON "TeamResult" FOR SELECT USING (true);
CREATE POLICY "Anyone can read team result drivers" ON "TeamResultDriver" FOR SELECT USING (true);


-- End of script
