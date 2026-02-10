
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const NAME = "Giuls";
  const LEAGUE_CODE = "SJ6G69";

  console.log(`Searching for users named '${NAME}' in league '${LEAGUE_CODE}'...`);

  const league = await prisma.league.findUnique({
    where: { joinCode: LEAGUE_CODE },
    include: {
      members: {
        where: {
          user: {
            displayName: NAME
          }
        },
        include: {
          user: true
        }
      }
    }
  });

  if (!league) throw new Error("League not found");

  const users = league.members.map(m => ({
    memberId: m.id,
    userId: m.userId,
    role: m.role,
    authToken: m.user.authToken,
    createdAt: m.createdAt
  }));

  console.log("Found users:", users);

  if (users.length !== 2) {
    console.log("Expected exactly 2 users named Giuls (1 Admin, 1 Member). Found:", users.length);
    return;
  }

  const admin = users.find(u => u.role === "ADMIN");
  const member = users.find(u => u.role === "MEMBER");

  if (!admin || !member) {
    console.log("Could not distinguish Admin vs Member.");
    return;
  }

  console.log(`\nDETECTED:\n- OLD ADMIN (to keep): ${admin.userId} [${admin.createdAt}]\n- NEW MEMBER (to drop): ${member.userId} [${member.createdAt}]\n`);
  
  const newToken = member.authToken;
  console.log(`Swapping token: Giving NEW token (${newToken}) to OLD ADMIN...`);

  // 1. Free up the token from the New User (to avoid Unique Constraint)
  await prisma.user.update({
    where: { id: member.userId },
    data: { authToken: `DELETED_${member.authToken}` } 
  });

  // 2. Update Admin with New Token
  await prisma.user.update({
    where: { id: admin.userId },
    data: { authToken: newToken }
  });

  // 3. Delete New User (Cascades to Member/Team)
  console.log(`Deleting New User ${member.userId}...`);
  await prisma.user.delete({
    where: { id: member.userId }
  });

  console.log("\nSUCCESS! User 'Giuls' should now be Admin again with the current device session.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
