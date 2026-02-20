-- Add a case-insensitive unique index to the User table for the displayName column
CREATE UNIQUE INDEX IF NOT EXISTS "User_displayName_lower_idx" ON "User" (LOWER("displayName"));
