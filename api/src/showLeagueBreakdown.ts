import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const JOIN_CODE = 'C44L04';

async function main() {
  const league = await prisma.league.findFirst({ where: { joinCode: JOIN_CODE } });
  if (!league) { console.log('League not found with code', JOIN_CODE); return; }
  console.log(`\nLega: ${league.name} (code: ${JOIN_CODE})\n`);

  const race = await prisma.race.findUnique({ where: { id: 'r1' } });
  if (!race) { console.log('Race r1 not found'); return; }
  const results = (race as any).results || {};
  const driverPts: Record<string, number> = results.driverPoints || {};
  const driverRacePts: Record<string, number> = results.driverRacePoints || {};
  const driverQualiPts: Record<string, number> = results.driverQualiPoints || {};

  const teamResults = await (prisma as any).teamResult.findMany({
    where: { raceId: 'r1', team: { leagueId: league.id } },
    include: {
      drivers: { include: { driver: true } },
      team: { include: { user: { select: { displayName: true } }, drivers: { include: { driver: true } } } }
    }
  });

  for (const tr of teamResults) {
    console.log('═'.repeat(60));
    console.log(`👤 ${tr.team.user.displayName}`);
    console.log(`   Captain: ${tr.captainId} | Reserve: ${tr.reserveId}`);
    console.log(`   TOTALE TEAM: ${tr.points.toFixed(1)} pts`);
    console.log('─'.repeat(60));
    console.log(`${'Pilota'.padEnd(22)} ${'Gara'.padStart(6)} ${'Quali'.padStart(6)} ${'Base'.padStart(6)} ${'Ruolo'.padStart(9)} ${'Finale'.padStart(7)}`);
    console.log('─'.repeat(60));

    let sum = 0;
    for (const d of tr.drivers) {
      const base = driverPts[d.driverId] || 0;
      const rP = driverRacePts[d.driverId] || 0;
      const qP = driverQualiPts[d.driverId] || 0;
      const isCpt = d.driverId === tr.captainId;
      const isRes = d.driverId === tr.reserveId;
      
      let role = '   —    ';
      let mult = 1;
      
      if (isRes) {
        // Reserve is insurance: only scores if a starter DNFed
        const classification = results.race || {};
        const starters = tr.drivers.filter((x: any) => x.driverId !== tr.reserveId);
        const anyStarterDNF = starters.some((x: any) => !classification[x.driverId]);
        if (!anyStarterDNF) {
          role = 'RES 🪑  ';
          mult = 0; // bench
        } else {
          role = 'RES ✅  ';
          mult = 1; // enters at full points
        }
      } else if (isCpt) {
        role = 'CPT ×2.0';
        mult = 2.0;
      }
      
      const final = Math.round(base * mult * 10) / 10;
      sum += final;
      console.log(
        `${(d.driver.name || d.driverId).padEnd(22)} ${rP.toString().padStart(6)} ${qP.toString().padStart(6)} ${base.toString().padStart(6)} ${role.padStart(9)} ${(final > 0 ? '+' : '') + final.toString().padStart(6)}`
      );
    }
    console.log('─'.repeat(60));
    console.log(`${''.padEnd(22)} ${''.padStart(6)} ${''.padStart(6)} ${''.padStart(6)} ${'TOTALE'.padStart(9)} ${(sum > 0 ? '+' : '') + sum.toFixed(1).padStart(6)}`);
    console.log('');
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => { pool.end(); process.exit(); });
