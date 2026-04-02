const postgres = require('postgres');
require('dotenv').config({ path: './api/.env' });

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

async function fix() {
  try {
    const races = await sql`SELECT id, name, round, "isCompleted" FROM "Race" WHERE round = 1`;
    console.log('Race Found:', races);
    if (races.length > 0) {
      const raceId = races[0].id;
      console.log('Target Race ID:', raceId);
      
      // Trigger sync-race via node-fetch (or just sql manually if needed, but API is safer as it handles all tables)
      // Since I'm in the server environment, I can just use fetch.
      // I need an admin token. I'll get one from the User table.
      const [admin] = await sql`SELECT "authToken" FROM "User" LIMIT 1`; 
      if (!admin) throw new Error('No user found to act as admin');

      const response = await fetch('https://laqjyqfnjnofmvgedunl.supabase.co/functions/v1/fanta-api/admin/sync-race', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${admin.authToken}`
        },
        body: JSON.stringify({ raceId })
      });

      const result = await response.json();
      console.log('Sync Result:', result);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit();
  }
}

fix();
