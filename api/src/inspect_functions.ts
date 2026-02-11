import "dotenv/config";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ 
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    try {
        const res = await pool.query(`
            SELECT routine_name, routine_definition 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
            AND routine_type = 'FUNCTION'
        `);
        console.log("Functions found:");
        res.rows.forEach(r => console.log(`- ${r.routine_name}`));
        
        // Check for specific function content if found
        const compute = res.rows.find(r => r.routine_name === 'compute_weekend');
        if (compute) {
            console.log("\nDefinition of compute_weekend:");
            console.log(compute.routine_definition);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
