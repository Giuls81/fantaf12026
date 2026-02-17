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
 * Returns a full breakdown per component.
 */
interface DriverBreakdown {
  racePosition: number;
  overtakes: number;
  teammate: number;
  dnf: number;
  lastPlace: number;
  qualiPole: number;
  qualiSession: number;
  constructorMult: number; // the multiplier applied
  race: number;   // sum of race components × mult
  quali: number;  // sum of quali components × mult
  total: number;
}

function computeBaseDriverPoints(
  driverId: string,
  rules: any,
  allDrivers: any[],
  racePosPoints: number[],
  multipliers: Record<string, number>
): DriverBreakdown {
  let racePosition = 0, overtakes = 0, teammate = 0, dnf = 0, lastPlace = 0;
  let qualiPole = 0, qualiSession = 0;
  const driverInfo = allDrivers.find(d => d.id === driverId);
  const pos = CLASSIFICATION[driverId];
  const grid = GRID[driverId];

  // ── RACE COMPONENTS ──

  // 1. Race Position Points
  if (pos && pos <= racePosPoints.length) {
    racePosition = racePosPoints[pos - 1] || 0;
  }

  // 2. Overtakes (positions gained/lost)
  if (pos && grid) {
    const diff = grid - pos;
    if (diff > 0) {
      for (let p = grid - 1; p >= pos; p--) {
        overtakes += (p <= 10 ? (rules.positionGainedPos1_10 || 1) : (rules.positionGainedPos11_Plus || 0.5));
      }
    } else if (diff < 0) {
      for (let p = grid + 1; p <= pos; p++) {
        overtakes += (p <= 10 ? (rules.positionLostPos1_10 || -1) : (rules.positionLostPos11_Plus || -0.5));
      }
    }
  }

  // 3. Teammate Duel
  const mateId = TEAMMATES[driverId];
  if (mateId && pos) {
    const matePos = CLASSIFICATION[mateId];
    if (matePos) {
      if (pos < matePos) teammate = (rules.teammateBeat ?? 2);
      else teammate = (rules.teammateLost ?? -2);
    } else {
      teammate = (rules.teammateBeatDNF ?? 1);
    }
  }

  // 4. DNF Malus
  if (!pos) {
    dnf = (rules.raceDNF ?? -5);
  }

  // 5. Last Place Malus
  const maxPos = Math.max(...Object.values(CLASSIFICATION));
  if (pos === maxPos && maxPos > 10) {
    lastPlace = (rules.raceLastPlaceMalus ?? -3);
  }

  // ── QUALIFYING COMPONENTS ──

  if (grid) {
    if (grid === 1) qualiPole = (rules.qualiPole ?? 3);
    if (grid <= 10) qualiSession = (rules.qualiQ3Reached ?? 3);
    else if (grid <= 15) qualiSession = (rules.qualiQ2Reached ?? 1);
    else qualiSession = (rules.qualiQ1Eliminated ?? -3);
  }

  // ── CONSTRUCTOR MULTIPLIER ──
  const mult = (driverInfo && multipliers[driverInfo.constructorId] !== undefined)
    ? multipliers[driverInfo.constructorId]!
    : 1.0;

  const rawRace = racePosition + overtakes + teammate + dnf + lastPlace;
  const rawQuali = qualiPole + qualiSession;

  const r = (n: number) => Math.round(n * 10) / 10;

  return {
    racePosition, overtakes, teammate, dnf, lastPlace,
    qualiPole, qualiSession,
    constructorMult: mult,
    race: r(rawRace * mult),
    quali: r(rawQuali * mult),
    total: r((rawRace + rawQuali) * mult),
  };
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
  const driverRacePoints: Record<string, number> = {};
  const driverQualiPoints: Record<string, number> = {};
  const driverBreakdown: Record<string, DriverBreakdown> = {};
  for (const dId of allDriverIds) {
    const breakdown = computeBaseDriverPoints(dId, baseRules, allDrivers, baseRacePosPoints, baseMults);
    driverPoints[dId] = breakdown.total;
    driverRacePoints[dId] = breakdown.race;
    driverQualiPoints[dId] = breakdown.quali;
    driverBreakdown[dId] = breakdown;
  }

  console.log("\n📊 Base Driver Fantasy Points (detailed breakdown):");
  console.log("  Pos   Driver                  PosP  Overt  Mate   DNF   Last  | Pole  Sess  | ×Mult  Race   Quali  Total");
  console.log("  ──── ─────────────────────── ───── ────── ───── ───── ───── | ───── ───── | ───── ─────── ────── ──────");
  const sorted = Object.entries(driverPoints).sort((a, b) => b[1] - a[1]);
  for (const [dId, pts] of sorted) {
    const driver = allDrivers.find(d => d.id === dId);
    const pos = CLASSIFICATION[dId];
    const status = pos ? `P${pos}` : 'DNF';
    const b = driverBreakdown[dId]!;
    const f = (n: number) => (n > 0 ? '+' + n : n === 0 ? ' 0' : '' + n).padStart(5);
    console.log(`  ${status.padEnd(4)} ${(driver?.name || dId).padEnd(22)} ${f(b.racePosition)} ${f(b.overtakes)} ${f(b.teammate)} ${f(b.dnf)} ${f(b.lastPlace)} | ${f(b.qualiPole)} ${f(b.qualiSession)} | ×${b.constructorMult} ${f(b.race)} ${f(b.quali)}  ${pts > 0 ? '+' : ''}${pts}`);
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
        const breakdown = computeBaseDriverPoints(driverId, rules, allDrivers, racePosPoints, multipliers);

        let finalPts = breakdown.total;
        const isReserve = driverId === team.reserveId;
        const isCaptain = driverId === team.captainId;

        if (isReserve) {
          // Reserve is INSURANCE: only scores if a starter DNFed
          const starters = team.drivers.filter((d: any) => d.driverId !== team.reserveId);
          const anyStarterDNF = starters.some((d: any) => !CLASSIFICATION[d.driverId]);
          if (!anyStarterDNF) {
            finalPts = 0; // Reserve stays on the bench
          }
          // If a starter DNFed, reserve enters at ×1.0 (full points)
        } else if (isCaptain) {
          finalPts *= 1.5;
        }

        const storedPts = Math.round(finalPts * 10) / 10;
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

  // Mark race as completed and store results (including per-driver point breakdowns)
  await prisma.race.update({
    where: { id: RACE_ID },
    data: { 
      isCompleted: true,
      results: {
        quali: GRID,
        race: CLASSIFICATION,
        driverPoints: driverPoints,
        driverRacePoints: driverRacePoints,
        driverQualiPoints: driverQualiPoints,
        driverBreakdown: driverBreakdown as any,
      }
    }
  });

  console.log("\n✅ Simulation finished! driverPoints + breakdown stored in race.results.");
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
