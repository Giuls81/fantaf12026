
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const TARGET_LEAGUE_CODE = "SJ6G69";
  
  console.log(`Inspecting users in league '${TARGET_LEAGUE_CODE}'...`);
  
  const league = await prisma.league.findUnique({
    where: { joinCode: TARGET_LEAGUE_CODE },
    include: {
      members: {
        include: {
          user: true
        }
      }
    }
  });

  if (!league) {
    console.log("League not found.");
    return;
  }

  console.log(`Found ${league.members.length} members:`);
  league.members.forEach(m => {
    console.log(`- User: ${m.user.displayName} (ID: ${m.user.id}) | Role: ${m.role} | AuthToken: ${m.user.authToken}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
