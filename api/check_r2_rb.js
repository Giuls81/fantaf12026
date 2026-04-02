require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query('SELECT results FROM "Race" WHERE id = \'r2\'');
  const results = res.rows[0].results;
  
  console.log("DNF Drivers:", results.dnfDrivers);
  console.log("Race Classification VER:", results.race.ver);
  console.log("Race Classification HAD:", results.race.had);
  console.log("Breakdown VER:", results.driverBreakdown.ver);
  console.log("Breakdown HAD:", results.driverBreakdown.had);
  
  await client.end();
}
run();
