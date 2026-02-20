require('dotenv').config();
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  try {
    const duplicateUserId = '2b268c82-1c44-421e-9f1c-08184f6e8aba'; // MaxKaiser86
    console.log(`Starting cleanup for user ID: ${duplicateUserId}`);

    // 1. Delete associated data
    await client.query('DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN (SELECT id FROM "TeamResult" WHERE "teamId" IN (SELECT id FROM "Team" WHERE "userId" = $1))', [duplicateUserId]);
    await client.query('DELETE FROM "TeamResult" WHERE "teamId" IN (SELECT id FROM "Team" WHERE "userId" = $1)', [duplicateUserId]);
    await client.query('DELETE FROM "TeamDriver" WHERE "teamId" IN (SELECT id FROM "Team" WHERE "userId" = $1)', [duplicateUserId]);
    await client.query('DELETE FROM "Team" WHERE "userId" = $1', [duplicateUserId]);
    await client.query('DELETE FROM "LeagueMember" WHERE "userId" = $1', [duplicateUserId]);
    await client.query('DELETE FROM "User" WHERE id = $1', [duplicateUserId]);
    
    console.log('User deleted successfully.');

    // 2. Create the unique index
    console.log('Creating unique case-insensitive index...');
    await client.query('CREATE UNIQUE INDEX "User_displayName_lower_idx" ON "User" (LOWER("displayName"))');
    console.log('Unique index created successfully.');

  } catch (err) {
    console.error('Error during cleanup/index creation:', err);
  } finally {
    await client.end();
  }
}

run();
