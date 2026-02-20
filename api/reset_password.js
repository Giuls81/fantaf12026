require('dotenv').config();
const { Client } = require('pg');
const crypto = require('crypto');

const client = new Client({ connectionString: process.env.DATABASE_URL });

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function run() {
  await client.connect();
  try {
    const displayName = 'Maxkaiser86';
    const newPassword = '12345678';
    const hashed = hashPassword(newPassword);
    
    // We use LOWER() just in case, although names should match now
    const res = await client.query('UPDATE "User" SET "password" = $1 WHERE LOWER("displayName") = LOWER($2) RETURNING id, "displayName"', [hashed, displayName]);
    
    if (res.rowCount > 0) {
      console.log(`Password reset successfully for user: ${res.rows[0].displayName} (ID: ${res.rows[0].id})`);
    } else {
      console.log(`User not found: ${displayName}`);
    }
  } catch (err) {
    console.error('Error resetting password:', err);
  } finally {
    await client.end();
  }
}

run();
