require('dotenv').config();
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  try {
    const res = await client.query('SELECT id, name FROM "Race" WHERE round = 1');
    const raceId = res.rows[0]?.id;
    console.log('RACE_DATA:', JSON.stringify(res.rows));
    
    if (raceId) {
      const verifyRes = await client.query('SELECT results FROM "Race" WHERE id = $1', [raceId]);
      const results = verifyRes.rows[0]?.results;
      console.log('FULL_RESULTS:', JSON.stringify(results, null, 2));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
