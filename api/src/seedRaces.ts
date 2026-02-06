import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "path";
import { pathToFileURL } from "url";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const constantsPath = path.join(process.cwd(), "..", "web", "constants.ts");
  const constantsUrl = pathToFileURL(constantsPath).href;

  const mod: any = await import(constantsUrl);
  const races = mod.RACES_2026 as any[];

  if (!Array.isArray(races)) throw new Error("RACES_2026 not found");

  const withIndex = races.map((r, i) => ({ r, i }));

  for (const { r, i } of withIndex) {
    const round = Number.isFinite(r.round) ? Number(r.round) : i + 1;

    await prisma.race.upsert({
      where: { id: r.id },
      update: {
        name: r.name,
        country: r.country ?? null,
        city: r.city ?? null,
        season: r.season ?? 2026,
        round,
        isSprint: !!r.isSprint,
        qualifyingUtc: r.qualifyingUtc ? new Date(r.qualifyingUtc) : null,
        sprintQualifyingUtc: r.sprintQualifyingUtc
          ? new Date(r.sprintQualifyingUtc)
          : null,
      },
      create: {
        id: r.id,
        name: r.name,
        country: r.country ?? null,
        city: r.city ?? null,
        season: r.season ?? 2026,
        round,
        isSprint: !!r.isSprint,
        qualifyingUtc: r.qualifyingUtc ? new Date(r.qualifyingUtc) : null,
        sprintQualifyingUtc: r.sprintQualifyingUtc
          ? new Date(r.sprintQualifyingUtc)
          : null,
      },
    });
  }

  const count = await prisma.race.count();
  console.log(`Seeded races: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
