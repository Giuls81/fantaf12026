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
  // We get the final positions by looking at the last 'position' entry for each driver
  const url = `${OPENF1_BASE}/position?session_key=${sessionKey}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return {};

    // Group by driver and find the last record (latest timestamp)
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

  // For 2026, OpenF1 won't have data yet. We can test with 2024 data if location matches.
  // Use race.country or race.city as location. OpenF1 location is often the city/track name (e.g. 'Spa-Francorchamps').
  const location = race.city || race.country || "";
  const sessionKey = await getOpenF1SessionKey(race.season || 2024, location, !!race.isSprint);
  
  if (!sessionKey) {
    throw new Error(`OpenF1 session not found for ${location} ${race.season}`);
  }

  const classification = await getOpenF1Classification(sessionKey);
  if (Object.keys(classification).length === 0) {
    throw new Error("No results found in OpenF1 for this session.");
  }

  // Calculate points using a standard system (we can customize this later or fetch from league rules)
  // For simplicity, let's update Driver.points directly for now (Global points)
  // In a real multi-league system, points per race should be stored in a separate table.
  // But our schema has 'points' on the Driver model.
  
  const updates = Object.entries(classification).map(([driverId, position]) => {
    // Points logic: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1
    const pointsArray = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    let points = 0;
    if (position >= 1 && position <= 10) {
      points = pointsArray[position - 1] || 0;
    }
    
    return prisma.driver.update({
      where: { id: driverId },
      data: { points: { increment: points } }
    });
  });

  await prisma.$transaction(updates);
  
  // Mark race as completed
  await prisma.race.update({
    where: { id: raceId },
    data: { isCompleted: true }
  });

  return classification;
}
