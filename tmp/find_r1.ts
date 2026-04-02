// @ts-nocheck
import postgres from 'npm:postgres';

const sql = postgres('postgresql://postgres.laqjyqfnjnofmvgedunl:CVLdrgHDcpjP3uOf@aws-1-eu-central-1.pooler.supabase.com:5432/postgres', { ssl: 'require' });

async function find() {
  const races = await sql`SELECT id, name FROM "Race" WHERE round = 1`;
  console.log(JSON.stringify(races));
  process.exit(0);
}

find();


