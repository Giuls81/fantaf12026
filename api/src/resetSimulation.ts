import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Resetting simulation data...");

  // 1. Delete TeamResultDriver
  const trd = await prisma.teamResultDriver.deleteMany({});
  console.log(`Deleted ${trd.count} TeamResultDriver records.`);

  // 2. Delete TeamResult
  const tr = await prisma.teamResult.deleteMany({});
  console.log(`Deleted ${tr.count} TeamResult records.`);

  // 3. Reset Team totalPoints
  const teams = await prisma.team.updateMany({
    data: { totalPoints: 0 }
  });
  console.log(`Reset totalPoints for ${teams.count} teams.`);

  // 4. Reset Driver points
  const drivers = await prisma.driver.updateMany({
    data: { points: 0 }
  });
  console.log(`Reset points for ${drivers.count} drivers.`);

  // 5. Reset Races
  const allRaces = await prisma.race.findMany();
  for (const race of allRaces) {
    await prisma.race.update({
      where: { id: race.id },
      data: { 
        isCompleted: false,
        results: {} // Set to empty object instead of null for Json if needed
      }
    });
  }
  console.log(`Reset ${allRaces.length} races (isCompleted=false, results={}).`);

  console.log("\nReset complete!");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
