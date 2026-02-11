import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    try {
        const count = await prisma.race.count();
        console.log(`Race Count: ${count}`);
        
        if (count > 0) {
            const first = await prisma.race.findFirst({ orderBy: { round: 'asc' } });
            console.log("First Race:", first);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
