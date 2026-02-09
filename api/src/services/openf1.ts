import { PrismaClient } from "@prisma/client";

const OPENF1_BASE = "https://api.openf1.org/v1";

// Mapping of our internal IDs to official F1 Racing Numbers
const DRIVER_NUMBER_MAP: Record<string, number> = {
  'ver': 1,
  'per': 11,
  'ham': 44,
  'lec': 16,
  'rus': 63,
  'ant': 12,
  'nor': 4,
  'pia': 81,
  'alo': 14,
  'str': 18,
  'gas': 10,
  'doo': 7,
  'alb': 23,
  'sai': 55,
  'tsu': 22,
  'law': 30,
  'hul': 27,
  'bor': 59,
  'oco': 31,
  'bea': 87,
  'bot': 77,
  'col': 43
};

const REVERSE_DRIVER_MAP: Record<number, string> = Object.fromEntries(
  Object.entries(DRIVER_NUMBER_MAP).map(([id, num]) => [num, id])
);

const DEFAULT_RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const DEFAULT_SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

export async function getOpenF1SessionKey(year: number, location: string, isSprint: boolean): Promise<number | null> {
  const sessionName = isSprint ? "Sprint" : "Race";
  const url = `${OPENF1_BASE}/sessions?year=${year}&location=${encodeURIComponent(location)}&session_name=${encodeURIComponent(sessionName)}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0].session_key;
    }
  } catch (e) {
    console.error("OpenF1 session fetch error:", e);
  }
  return null;
}

export async function getOpenF1Classification(sessionKey: number): Promise<Record<string, number>> {
  const url = `${OPENF1_BASE}/position?session_key=${sessionKey}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return {};

    const latestPositions: Record<number, number> = {};
    const timestamps: Record<number, string> = {};

    for (const record of data) {
      const num = record.driver_number;
      const pos = record.position;
      const ts = record.date;

      if (!timestamps[num] || ts > timestamps[num]) {
        timestamps[num] = ts;
        latestPositions[num] = pos;
      }
    }

    const results: Record<string, number> = {};
    for (const [num, pos] of Object.entries(latestPositions)) {
      const driverId = REVERSE_DRIVER_MAP[Number(num)];
      if (driverId) {
        results[driverId] = pos;
      }
    }
    return results;
  } catch (e) {
    console.error("OpenF1 position fetch error:", e);
    return {};
  }
}

export async function syncRaceResults(prisma: PrismaClient, raceId: string) {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) throw new Error("Race not found");

  const location = race.city || race.country || "";
  const sessionKey = await getOpenF1SessionKey(race.season || 2024, location, !!race.isSprint);
  
  if (!sessionKey) {
    throw new Error(`OpenF1 session not found for ${location} ${race.season}`);
  }

  const classification = await getOpenF1Classification(sessionKey);
  if (Object.keys(classification).length === 0) {
    throw new Error("No results found in OpenF1 for this session.");
  }

  // Calculate Points per Driver
  const driverRacePoints: Record<string, number> = {};
  for (const [driverId, position] of Object.entries(classification)) {
    const pointsArray = race.isSprint ? DEFAULT_SPRINT_POINTS : DEFAULT_RACE_POINTS;
    const pts = (position >= 1 && position <= pointsArray.length) ? (pointsArray[position - 1] ?? 0) : 0;
    driverRacePoints[driverId] = pts;
  }

  await prisma.$transaction(async (tx: any) => {
    // 1. Update Global Driver Points (Cumulative)
    for (const [driverId, points] of Object.entries(driverRacePoints)) {
      await tx.driver.update({
        where: { id: driverId },
        data: { points: { increment: points } }
      });
    }

    // 2. Snapshot Results for all Teams
    const teams = await tx.team.findMany({
      include: { drivers: true }
    });

    for (const team of teams) {
      let teamPoints = 0;
      const resultDrivers = [];

      for (const td of team.drivers) {
        let pts = (driverRacePoints[td.driverId] as number) || 0;
        
        // Captain Bonus (2x)
        if (team.captainId === td.driverId) {
          pts *= 2;
        }

        teamPoints += pts;
        resultDrivers.push({
          driverId: td.driverId,
          points: pts
        });
      }

      // Create TeamResult snapshot
      await tx.teamResult.create({
        data: {
          raceId: race.id,
          teamId: team.id,
          points: teamPoints,
          captainId: team.captainId,
          reserveId: team.reserveId,
          drivers: {
            create: resultDrivers
          }
        }
      });

      // Update Team Global Points
      await tx.team.update({
        where: { id: team.id },
        data: { totalPoints: { increment: teamPoints } }
      });
    }

    // 3. Mark race as completed
    await tx.race.update({
      where: { id: raceId },
      data: { isCompleted: true }
    });
  });

  return classification;
}
