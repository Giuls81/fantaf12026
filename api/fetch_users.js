require('dotenv').config();
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  try {
    const res = await client.query(`
      SELECT u."displayName", t.name as team_name, u.id as user_id, t.id as team_id
      FROM "User" u
      JOIN "Team" t ON u.id = t."userId"
      JOIN "League" l ON t."leagueId" = l.id
      WHERE l."joinCode" = 'C44L04'
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
