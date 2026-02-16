import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Cleaning up entire database (wiping users, leagues, teams, results)...");

  try {
    // 1. Delete TeamResultDriver
    const trd = await prisma.teamResultDriver.deleteMany({});
    console.log(`Deleted ${trd.count} TeamResultDriver records.`);

    // 2. Delete TeamResult
    const tr = await prisma.teamResult.deleteMany({});
    console.log(`Deleted ${tr.count} TeamResult records.`);

    // 3. Delete TeamDriver
    const td = await prisma.teamDriver.deleteMany({});
    console.log(`Deleted ${td.count} TeamDriver records.`);

    // 4. Delete Team
    const t = await prisma.team.deleteMany({});
    console.log(`Deleted ${t.count} Team records.`);

    // 5. Delete LeagueMember
    const lm = await prisma.leagueMember.deleteMany({});
    console.log(`Deleted ${lm.count} LeagueMember records.`);

    // 6. Delete League
    const l = await prisma.league.deleteMany({});
    console.log(`Deleted ${l.count} League records.`);

    // 7. Delete User
    const u = await prisma.user.deleteMany({});
    console.log(`Deleted ${u.count} User records.`);

    // 8. Reset Driver points
    const drivers = await prisma.driver.updateMany({
      data: { points: 0 }
    });
    console.log(`Reset points for ${drivers.count} drivers.`);

    // 9. Reset Races
    const races = await prisma.race.updateMany({
      data: {
        isCompleted: false,
        results: {}
      }
    });
    console.log(`Reset ${races.count} races (isCompleted=false, results={}).`);

    console.log("\nDatabase cleanup complete! Fresh start ready.");
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
