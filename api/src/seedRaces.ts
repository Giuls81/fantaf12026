import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "path";
import { pathToFileURL } from "url";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Hardcoded data to avoid import issues
  const races = [
  {
    id: 'r1',
    name: "Gran Premio d'Australia",
    date: '2026-03-08',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-03-07T05:00:00Z',
  },
  {
    id: 'r2',
    name: 'Gran Premio di Cina',
    date: '2026-03-15',
    isSprint: true,
    isCompleted: false,
    sprintQualifyingUtc: '2026-03-13T07:30:00Z',
    qualifyingUtc: '2026-03-14T07:00:00Z',
  },
  {
    id: 'r3',
    name: 'Gran Premio del Giappone',
    date: '2026-03-29',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-03-28T06:00:00Z',
  },
  {
    id: 'r4',
    name: 'Gran Premio del Bahrein',
    date: '2026-04-12',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-04-11T16:00:00Z',
  },
  {
    id: 'r5',
    name: "Gran Premio dell'Arabia Saudita",
    date: '2026-04-19',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-04-18T17:00:00Z',
  },
  {
    id: 'r6',
    name: 'Gran Premio di Miami',
    date: '2026-05-03',
    isSprint: true,
    isCompleted: false,
    sprintQualifyingUtc: '2026-05-01T20:30:00Z',
    qualifyingUtc: '2026-05-02T20:00:00Z',
  },
  {
    id: 'r7',
    name: 'Gran Premio del Canada',
    date: '2026-05-24',
    isSprint: true,
    isCompleted: false,
    sprintQualifyingUtc: '2026-05-22T20:30:00Z',
    qualifyingUtc: '2026-05-23T20:00:00Z',
  },
  {
    id: 'r8',
    name: 'Gran Premio di Monaco',
    date: '2026-06-07',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-06-06T14:00:00Z',
  },
  {
    id: 'r9',
    name: 'Barcelona-Catalunya',
    date: '2026-06-14',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-06-13T14:00:00Z',
  },
  {
    id: 'r10',
    name: "Gran Premio d'Austria",
    date: '2026-06-28',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-06-27T14:00:00Z',
  },
  {
    id: 'r11',
    name: 'Gran Premio di Gran Bretagna',
    date: '2026-07-05',
    isSprint: true,
    isCompleted: false,
    sprintQualifyingUtc: '2026-07-03T15:30:00Z',
    qualifyingUtc: '2026-07-04T15:00:00Z',
  },
  {
    id: 'r12',
    name: 'Gran Premio del Belgio',
    date: '2026-07-19',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-07-18T14:00:00Z',
  },
  {
    id: 'r13',
    name: "Gran Premio d'Ungheria",
    date: '2026-07-26',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-07-25T14:00:00Z',
  },
  {
    id: 'r14',
    name: "Gran Premio d'Olanda",
    date: '2026-08-23',
    isSprint: true,
    isCompleted: false,
    sprintQualifyingUtc: '2026-08-21T14:30:00Z',
    qualifyingUtc: '2026-08-22T14:00:00Z',
  },
  {
    id: 'r15',
    name: "Gran Premio d'Italia",
    date: '2026-09-06',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-09-05T14:00:00Z',
  },
  {
    id: 'r16',
    name: 'Gran Premio di Spagna',
    date: '2026-09-13',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-09-12T14:00:00Z',
  },
  {
    id: 'r17',
    name: "Gran Premio d'Azerbaijan",
    date: '2026-09-26',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-09-25T12:00:00Z',
  },
  {
    id: 'r18',
    name: 'Gran Premio di Singapore',
    date: '2026-10-11',
    isSprint: true,
    isCompleted: false,
    sprintQualifyingUtc: '2026-10-09T12:30:00Z',
    qualifyingUtc: '2026-10-10T13:00:00Z',
  },
  {
    id: 'r19',
    name: "Gran Premio degli Stati Uniti d'America",
    date: '2026-10-25',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-10-24T21:00:00Z',
  },
  {
    id: 'r20',
    name: 'Gran Premio di Città del Messico',
    date: '2026-11-01',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-10-31T21:00:00Z',
  },
  {
    id: 'r21',
    name: 'Gran Premio del Brasile',
    date: '2026-11-08',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-11-07T18:00:00Z',
  },
  {
    id: 'r22',
    name: 'Las Vegas Grand Prix',
    date: '2026-11-22',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-11-21T04:00:00Z',
  },
  {
    id: 'r23',
    name: 'Gran Premio del Qatar',
    date: '2026-11-29',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-11-28T18:00:00Z',
  },
  {
    id: 'r24',
    name: 'Gran Premio di Abu Dhabi',
    date: '2026-12-06',
    isSprint: false,
    isCompleted: false,
    qualifyingUtc: '2026-12-05T14:00:00Z',
  },
];

  const drivers = [
  // Red Bull Racing
  { id: 'ver', name: 'Max Verstappen', constructorId: 'rbr', price: 30.0 },
  { id: 'had', name: 'Isack Hadjar', constructorId: 'rbr', price: 14.0 },
  // Mercedes
  { id: 'rus', name: 'George Russell', constructorId: 'mer', price: 24.0 },
  { id: 'ant', name: 'Andrea Kimi Antonelli', constructorId: 'mer', price: 15.0 },
  // Ferrari
  { id: 'lec', name: 'Charles Leclerc', constructorId: 'fer', price: 26.0 },
  { id: 'ham', name: 'Lewis Hamilton', constructorId: 'fer', price: 28.0 },
  // McLaren
  { id: 'nor', name: 'Lando Norris', constructorId: 'mcl', price: 27.0 },
  { id: 'pia', name: 'Oscar Piastri', constructorId: 'mcl', price: 25.0 },
  // Aston Martin
  { id: 'alo', name: 'Fernando Alonso', constructorId: 'ast', price: 20.0 },
  { id: 'str', name: 'Lance Stroll', constructorId: 'ast', price: 12.0 },
  // Alpine
  { id: 'col', name: 'Franco Colapinto', constructorId: 'alp', price: 11.0 },
  { id: 'gas', name: 'Pierre Gasly', constructorId: 'alp', price: 14.0 },
  // Williams
  { id: 'alb', name: 'Alexander Albon', constructorId: 'wil', price: 14.0 },
  { id: 'sai', name: 'Carlos Sainz', constructorId: 'wil', price: 22.0 },
  // Racing Bulls
  { id: 'lin', name: 'Arvid Lindblad', constructorId: 'rb', price: 10.0 },
  { id: 'law', name: 'Liam Lawson', constructorId: 'rb', price: 11.0 },
  // Haas
  { id: 'bea', name: 'Oliver Bearman', constructorId: 'haa', price: 11.0 },
  { id: 'oco', name: 'Esteban Ocon', constructorId: 'haa', price: 14.0 },
  // Audi
  { id: 'bor', name: 'Gabriel Bortoleto', constructorId: 'sau', price: 10.0 },
  { id: 'hul', name: 'Nico Hülkenberg', constructorId: 'sau', price: 13.0 },
  // Cadillac
  { id: 'per', name: 'Sergio Pérez', constructorId: 'cad', price: 16.0 },
  { id: 'bot', name: 'Valtteri Bottas', constructorId: 'cad', price: 13.5 },
];

  // 1. Seed Drivers
  console.log("Seeding drivers...");
  for (const d of drivers as any[]) {
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
  const withIndex = (races as any[]).map((r, i) => ({ r, i }));

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
