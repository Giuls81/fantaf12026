import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const RACE_ID = 'r1'; // Australian GP

// Mock Quali Results (Grid)
const GRID: Record<string, number> = {
  'ver': 1, 'lec': 2, 'nor': 3, 'ham': 4, 'rus': 5, 
  'pia': 6, 'sai': 7, 'per': 8, 'alo': 9, 'gas': 10,
  'alb': 11, 'hul': 12, 'oco': 13, 'bea': 14, 'law': 15,
  'tsu': 16, 'str': 17, 'bot': 18, 'col': 19, 'bor': 20,
  'ant': 21, 'had': 22
};

// Mock Race Results (Classification)
const CLASSIFICATION: Record<string, number> = {
  'lec': 1,  // +1 pos
  'ver': 2,  // -1 pos
  'nor': 3,  // Same
  'pia': 4,  // +2 pos
  'ham': 5,  // -1 pos
  'rus': 6,  // -1 pos
  'sai': 7,  // Same
  'alo': 8,  // +1 pos
  'per': 9,  // -1 pos
  'hul': 10, // +2 pos
  'alb': 11, // Same
  'oco': 12, // +1 pos
  'gas': 13, // -3 pos
  'bea': 14, // Same
  'str': 15, // +2 pos
  'law': 16, // -1 pos
  'bot': 17, // +1 pos
  'col': 18, // +1 pos
  'ant': 19, // +2 pos
  'bor': 20, // Same
  // DNF: had, tsu
};

// Teammate Map (based on seedRaces.ts)
const TEAMMATES: Record<string, string> = {
  'ver': 'had', 'had': 'ver',
  'rus': 'ant', 'ant': 'rus',
  'lec': 'ham', 'ham': 'lec',
  'nor': 'pia', 'pia': 'nor',
  'alo': 'str', 'str': 'alo',
  'col': 'gas', 'gas': 'col',
  'alb': 'sai', 'sai': 'alb',
  'law': 'tsu', 'tsu': 'law', // Added tsu/tsu-ish mapping
  'bea': 'oco', 'oco': 'bea',
  'bor': 'hul', 'hul': 'bor',
  'per': 'bot', 'bot': 'per'
};

const DEFAULT_RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Compute the BASE fantasy points for a single driver (no captain/reserve).
 * Uses the first league's rules as the "official" scoring.
 */
function computeBaseDriverPoints(
  driverId: string,
  rules: any,
  allDrivers: any[],
  racePosPoints: number[],
  multipliers: Record<string, number>
): number {
  let pts = 0;
  const driverInfo = allDrivers.find(d => d.id === driverId);
  const pos = CLASSIFICATION[driverId];
  const grid = GRID[driverId];

  // 1. Race Position Points
  if (pos && pos <= racePosPoints.length) {
    pts += racePosPoints[pos - 1];
  }

  // 2. Qualifying Bonuses
  if (grid) {
    if (grid === 1) pts += (rules.qualiPole ?? 3);
    if (grid <= 10) pts += (rules.qualiQ3Reached ?? 3);
    else if (grid <= 15) pts += (rules.qualiQ2Reached ?? 1);
    else pts += (rules.qualiQ1Eliminated ?? -3);
  }

  // 3. Overtakes
  if (pos && grid) {
    const diff = grid - pos;
    if (diff > 0) {
      for (let p = grid - 1; p >= pos; p--) {
        pts += (p <= 10 ? (rules.positionGainedPos1_10 || 1) : (rules.positionGainedPos11_Plus || 0.5));
      }
    } else if (diff < 0) {
      for (let p = grid + 1; p <= pos; p++) {
        pts += (p <= 10 ? (rules.positionLostPos1_10 || -1) : (rules.positionLostPos11_Plus || -0.5));
      }
    }
  }

  // 4. Teammate Duel
  const mateId = TEAMMATES[driverId];
  if (mateId && pos) {
    const matePos = CLASSIFICATION[mateId];
    if (matePos) {
      if (pos < matePos) pts += (rules.teammateBeat ?? 2);
      else pts += (rules.teammateLost ?? -2);
    } else {
      pts += (rules.teammateBeatDNF ?? 1);
    }
  }

  // 5. DNF Malus
  if (!pos) {
    pts += (rules.raceDNF ?? -5);
  }

  // 6. Last Place Malus
  const maxPos = Math.max(...Object.values(CLASSIFICATION));
  if (pos === maxPos && maxPos > 10) {
    pts += (rules.raceLastPlaceMalus ?? -3);
  }

  // 7. Constructor Multiplier
  if (driverInfo && multipliers[driverInfo.constructorId] !== undefined) {
    pts = pts * multipliers[driverInfo.constructorId];
  }

  return pts;
}

async function main() {
  console.log("Starting simulation for Race:", RACE_ID);

  const race = await prisma.race.findUnique({ where: { id: RACE_ID } });
  if (!race) {
    console.error("Race not found!");
    return;
  }

  // Clear existing results
  await prisma.teamResultDriver.deleteMany({ where: { teamResult: { raceId: RACE_ID } } });
  await prisma.teamResult.deleteMany({ where: { raceId: RACE_ID } });

  const leagues = await prisma.league.findMany();
  const allDrivers = await prisma.driver.findMany();

  // ─── Compute base per-driver fantasy points (using first league's rules) ───
  const firstLeague = leagues[0];
  const baseRules = (firstLeague?.rules as any) || {};
  const baseRacePosPoints = baseRules.racePositionPoints || DEFAULT_RACE_POINTS;
  const baseMults: Record<string, number> = {};
  if (baseRules.constructors) {
    baseRules.constructors.forEach((c: any) => baseMults[c.id] = c.multiplier);
  }

  // All drivers that appeared in GRID or CLASSIFICATION
  const allDriverIds = [...new Set([...Object.keys(GRID), ...Object.keys(CLASSIFICATION)])];
  const driverPoints: Record<string, number> = {};
  for (const dId of allDriverIds) {
    driverPoints[dId] = Math.round(
      computeBaseDriverPoints(dId, baseRules, allDrivers, baseRacePosPoints, baseMults) * 10
    ) / 10; // 1 decimal
  }

  console.log("\n📊 Base Driver Fantasy Points:");
  // Sort by points descending
  const sorted = Object.entries(driverPoints).sort((a, b) => b[1] - a[1]);
  for (const [dId, pts] of sorted) {
    const driver = allDrivers.find(d => d.id === dId);
    const pos = CLASSIFICATION[dId];
    const status = pos ? `P${pos}` : 'DNF';
    console.log(`  ${status.padEnd(4)} ${(driver?.name || dId).padEnd(22)} ${pts > 0 ? '+' : ''}${pts} pts`);
  }
  console.log("");

  // ─── Per-team scoring ─────────────────────────────────────────────────
  for (const league of leagues) {
    console.log(`Processing League: ${league.name}`);
    const rules = (league.rules as any) || {};
    const racePosPoints = rules.racePositionPoints || DEFAULT_RACE_POINTS;
    const multipliers: Record<string, number> = {};
    if (rules.constructors) {
      rules.constructors.forEach((c: any) => multipliers[c.id] = c.multiplier);
    }

    const teams = await prisma.team.findMany({
      where: { leagueId: league.id },
      include: { drivers: true }
    });

    for (const team of teams) {
      let teamPoints = 0;
      const driverPointsList: { driverId: string, points: number }[] = [];

      for (const td of team.drivers) {
        const driverId = td.driverId;
        // Use the base points (already computed), then apply captain/reserve
        const basePts = computeBaseDriverPoints(driverId, rules, allDrivers, racePosPoints, multipliers);

        let finalPts = basePts;
        if (driverId === team.captainId) finalPts *= 1.5;
        if (driverId === team.reserveId) finalPts *= 0.5;

        const storedPts = Math.round(finalPts);
        driverPointsList.push({ driverId, points: storedPts });
        teamPoints += finalPts;
      }

      // Save Team Result
      const tr = await prisma.teamResult.create({
        data: {
          raceId: RACE_ID,
          teamId: team.id,
          points: teamPoints,
          captainId: team.captainId,
          reserveId: team.reserveId,
        }
      });

      // Save Driver Results
      for (const dp of driverPointsList) {
        await prisma.teamResultDriver.create({
          data: {
            teamResultId: tr.id,
            driverId: dp.driverId,
            points: dp.points
          }
        });
      }

      // Update Team Total
      await prisma.team.update({
        where: { id: team.id },
        data: { totalPoints: { increment: teamPoints } }
      });

      console.log(`  Team ${(team as any).name || team.id}: ${teamPoints.toFixed(1)} pts`);
    }
  }

  // Mark race as completed and store results (including driverPoints)
  await prisma.race.update({
    where: { id: RACE_ID },
    data: { 
      isCompleted: true,
      results: {
        quali: GRID,
        race: CLASSIFICATION,
        driverPoints: driverPoints,
      }
    }
  });

  console.log("\n✅ Simulation finished! driverPoints stored in race.results.");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
