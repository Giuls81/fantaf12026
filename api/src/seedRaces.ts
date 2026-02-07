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
  const drivers = mod.DRIVERS as any[];

  if (!Array.isArray(races)) throw new Error("RACES_2026 not found");
  if (!Array.isArray(drivers)) throw new Error("DRIVERS not found");

  // 1. Seed Drivers
  console.log("Seeding drivers...");
  for (const d of drivers) {
    await prisma.driver.upsert({
      where: { id: d.id },
      update: {
        name: d.name,
        constructorId: d.constructorId,
        price: d.price,
      },
      create: {
        id: d.id,
        name: d.name,
        constructorId: d.constructorId,
        price: d.price,
      },
    });
  }

  // 2. Seed Races
  console.log("Seeding races...");
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
        date: new Date(r.date),
        isCompleted: !!r.isCompleted,
      } as any,
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
        date: new Date(r.date),
        isCompleted: !!r.isCompleted,
      } as any,
    });
  }

  const raceCount = await prisma.race.count();
  const driverCount = await prisma.driver.count();
  console.log(`Seeded ${raceCount} races and ${driverCount} drivers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
