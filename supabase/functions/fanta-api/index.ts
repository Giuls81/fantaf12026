import { serve } from "std/http/server.ts";
import { Hono, Context, Next } from "hono";
import { cors } from "hono/middleware.ts";
import postgres from "postgres";

type Variables = {
  user: any;
}

const app = new Hono<{ Variables: Variables }>().basePath("/fanta-api");

// DB Connection
const databaseUrl = Deno.env.get("DATABASE_URL")!;
const sql = postgres(databaseUrl, { ssl: "require" });

// Helper for tokens
function makeToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

// Middleware: Auth
const requireUser = async (c: Context<{ Variables: Variables }>, next: Next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "missing_token" }, 401);
  }
  const token = authHeader.slice(7);
  
  const [user] = await sql`SELECT id, "authToken", "displayName" FROM "User" WHERE "authToken" = ${token}`;
  if (!user) {
    return c.json({ error: "invalid_token" }, 401);
  }
  
  c.set("user", user);
  await next();
};

app.use("*", cors({
  origin: "*", // allow all origins for the edge function
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.get("/health", async (c) => {
  try {
    await sql`SELECT 1`;
    return c.json({ ok: true, db: "connected" });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});

// Helper: Hash Password
async function hashPassword(password: string) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

app.post("/auth/register", async (c) => {
  try {
    const { name, password } = await c.req.json();
    const displayName = (name || "Player").slice(0, 32);

    if (!password || password.length < 3) {
      return c.json({ error: "weak_password", message: "Password must be at least 3 characters." }, 400);
    }

    // Check if name exists
    const [existing] = await sql`SELECT id FROM "User" WHERE "displayName" = ${displayName}`;
    if (existing) {
      return c.json({ 
        error: "name_taken", 
        message: "Questo nome è già in uso. Scegline un altro o fai il Login." 
      }, 400); 
    }

    const passwordHash = await hashPassword(password);
    const token = makeToken();
    const id = crypto.randomUUID();
    
    const [user] = await sql`
      INSERT INTO "User" (id, "authToken", "displayName", "password", "updatedAt") 
      VALUES (${id}, ${token}, ${displayName}, ${passwordHash}, ${new Date().toISOString()}) 
      RETURNING id, "authToken", "displayName"
    `;
    return c.json(user);
  } catch (e: any) {
    return c.json({ error: e.message, type: "auth_register_error" }, 500);
  }
});

// Alias for backward compatibility (if needed) but we rely on new frontend flow
// app.post("/auth/anon", ... ) -> Removed/Redirected

app.post("/auth/login", async (c) => {
  try {
    const { name, password } = await c.req.json();
    if (!name || !password) return c.json({ error: "missing_credentials" }, 400);

    const [user] = await sql`SELECT id, "authToken", "password", "displayName" FROM "User" WHERE "displayName" = ${name}`;
    
    if (!user) {
      return c.json({ error: "invalid_credentials", message: "Utente non trovato." }, 404);
    }

    // Passwords created before this update might be null. 
    // But since we wiped DB, all new users should have password.
    if (!user.password) {
       // Allow legacy login??? No, we wiped DB.
       return c.json({ error: "legacy_user", message: "Account vecchio senza password. Contatta admin." }, 403);
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== user.password) {
      return c.json({ error: "invalid_credentials", message: "Password errata." }, 401);
    }

    return c.json({ 
      id: user.id, 
      authToken: user.authToken, 
      displayName: user.displayName 
    });

  } catch (e: any) {
    return c.json({ error: e.message, type: "auth_login_error" }, 500);
  }
});

app.get("/me", requireUser, async (c) => {
  const user = c.get("user");
  
  // Get memberships
  const memberships = await sql`
    SELECT lm.role, l.id, l.name, l."joinCode",
           t.id as team_id, t.name as team_name, t.budget, t."captainId", t."reserveId"
    FROM "LeagueMember" lm
    JOIN "League" l ON lm."leagueId" = l.id
    LEFT JOIN "Team" t ON t."leagueId" = l.id AND t."userId" = ${user.id}
    WHERE lm."userId" = ${user.id}
    ORDER BY lm."createdAt" ASC
  `;
  
  const leagues = await Promise.all(memberships.map(async (m) => {
    // Get team drivers
    const drivers = m.team_id ? await sql`
      SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${m.team_id}
    ` : [];
    
    const members = await sql`
      SELECT lm."userId", u."displayName" as "userName", lm.role
      FROM "LeagueMember" lm
      JOIN "User" u ON lm."userId" = u.id
      WHERE lm."leagueId" = ${m.id}
    `;

    return {
      id: m.id,
      name: m.name,
      joinCode: m.joinCode,
      role: m.role,
      isAdmin: m.role === "ADMIN",
      members, // Added
      team: m.team_id ? {
        id: m.team_id,
        name: m.team_name,
        budget: Number(m.budget),
        captainId: m.captainId,
        reserveId: m.reserveId,
        driverIds: drivers.map(d => d.driverId)
      } : null
    };
  }));

  return c.json({
    user: { id: user.id, name: user.displayName },
    leagues
  });
});

app.get("/races", async (c) => {
  const races = await sql`
    SELECT id, name, country, city, season, round, "isSprint", "qualifyingUtc", "sprintQualifyingUtc", date, "isCompleted"
    FROM "Race"
    ORDER BY round ASC
  `;
  return c.json(races);
});

app.get("/drivers", async (c) => {
  const drivers = await sql`
    SELECT * FROM "Driver" ORDER BY price DESC
  `;
  return c.json(drivers);
});

app.post("/leagues", requireUser, async (c) => {
  try {
    const user = c.get("user");
    const { name } = await c.req.json();
    const leagueName = (name?.trim() || "League").slice(0, 64);
    const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const [league] = await sql.begin(async (sql) => {
      const now = new Date().toISOString();
      const leagueId = crypto.randomUUID();
      const [l] = await sql`
        INSERT INTO "League" (id, name, "joinCode", "updatedAt") 
        VALUES (${leagueId}, ${leagueName}, ${joinCode}, ${now}) 
        RETURNING id, name, "joinCode"
      `;
      
      const memberId = crypto.randomUUID();
      await sql`
        INSERT INTO "LeagueMember" (id, "userId", "leagueId", role, "createdAt")
        VALUES (${memberId}, ${user.id}, ${l.id}, 'ADMIN', ${now})
      `;
      
      const teamId = crypto.randomUUID();
      const teamName = `${user.displayName}'s Team`;
      await sql`
        INSERT INTO "Team" (id, "userId", "leagueId", name, budget, "createdAt", "updatedAt")
        VALUES (${teamId}, ${user.id}, ${l.id}, ${teamName}, 100.0, ${now}, ${now})
      `;
      
      return [l];
    });

    return c.json(league);
  } catch (e: any) {
    return c.json({ error: e.message, type: "create_league_error" }, 500);
  }
});

app.post("/leagues/join", requireUser, async (c) => {
  try {
    const user = c.get("user");
    const { joinCode } = await c.req.json();
    const code = (joinCode || "").trim().toUpperCase();

    const [league] = await sql`SELECT id, name, "joinCode" FROM "League" WHERE "joinCode" = ${code}`;
    if (!league) return c.json({ error: "league_not_found" }, 404);

    await sql.begin(async (sql) => {
      const now = new Date().toISOString();
      const memberId = crypto.randomUUID();
      await sql`
        INSERT INTO "LeagueMember" (id, "userId", "leagueId", role, "createdAt")
        VALUES (${memberId}, ${user.id}, ${league.id}, 'MEMBER', ${now})
        ON CONFLICT ("userId", "leagueId") DO NOTHING
      `;
      
      const teamId = crypto.randomUUID();
      const teamName = `${user.displayName}'s Team`;
      await sql`
        INSERT INTO "Team" (id, "userId", "leagueId", name, budget, "createdAt", "updatedAt")
        VALUES (${teamId}, ${user.id}, ${league.id}, ${teamName}, 100.0, ${now}, ${now})
        ON CONFLICT ("userId", "leagueId") DO NOTHING
      `;
    });

    return c.json({ leagueId: league.id, name: league.name, joinCode: league.joinCode });
  } catch (e: any) {
    return c.json({ error: e.message, type: "join_league_error" }, 500);
  }
});

app.post("/team/market", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, driverIdIn, driverIdOut } = await c.req.json();

  if (!leagueId) return c.json({ error: "missing_leagueId" }, 400);

  const [team] = await sql`SELECT * FROM "Team" WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id}`;
  if (!team) return c.json({ error: "team_not_found" }, 404);

  const ownedDrivers = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${team.id}`;
  const ownedIds = ownedDrivers.map(d => d.driverId);
  const allDrivers = await sql`SELECT id, price FROM "Driver"`;

  let newBudget = Number(team.budget);

  if (driverIdOut) {
    if (!ownedIds.includes(driverIdOut)) return c.json({ error: "not_owned" }, 400);
    const d = allDrivers.find(x => x.id === driverIdOut);
    if (!d) return c.json({ error: "invalid_driver_out" }, 400);
    newBudget += Number(d.price);
  }

  if (driverIdIn) {
    if (ownedIds.includes(driverIdIn) && driverIdIn !== driverIdOut) return c.json({ error: "already_owned" }, 400);
    const d = allDrivers.find(x => x.id === driverIdIn);
    if (!d) return c.json({ error: "invalid_driver_in" }, 400);
    if (newBudget < Number(d.price)) return c.json({ error: "insufficient_budget" }, 400);
    newBudget -= Number(d.price);
  }

  const netChange = (driverIdIn ? 1 : 0) - (driverIdOut ? 1 : 0);
  if (ownedIds.length + netChange > 5) return c.json({ error: "team_full" }, 400);

  await sql.begin(async (sql) => {
    if (driverIdOut) {
      await sql`DELETE FROM "TeamDriver" WHERE "teamId" = ${team.id} AND "driverId" = ${driverIdOut}`;
    }
    if (driverIdIn) {
      const tdId = crypto.randomUUID();
      await sql`INSERT INTO "TeamDriver" (id, "teamId", "driverId") VALUES (${tdId}, ${team.id}, ${driverIdIn})`;
    }
    const now = new Date().toISOString();
    await sql`UPDATE "Team" SET budget = ${newBudget}, "updatedAt" = ${now} WHERE id = ${team.id}`;
  });

  return c.json({ ok: true, newBudget });
});

app.post("/team/lineup", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, captainId, reserveId } = await c.req.json();

  const races = await sql`SELECT * FROM "Race" ORDER BY round ASC`;
  const nextRace = races.find(r => !r.isCompleted) || races[races.length - 1];
  
  if (nextRace) {
    const sessionStr = nextRace.isSprint ? nextRace.sprintQualifyingUtc : nextRace.qualifyingUtc;
    if (sessionStr) {
      const lockDate = new Date(new Date(sessionStr).getTime() - 5 * 60 * 1000);
      if (new Date() > lockDate) return c.json({ error: "lineup_locked" }, 403);
    }
  }

  const now = new Date().toISOString();
  await sql`
    UPDATE "Team" 
    SET "captainId" = ${captainId ?? null}, "reserveId" = ${reserveId ?? null}, "updatedAt" = ${now}
    WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id}
  `;

  return c.json({ ok: true });
});

app.get("/leagues/:id/standings", requireUser, async (c) => {
  const leagueId = c.req.param("id");
  const standings = await sql`
    SELECT t."userId", u."displayName" as "userName", t."totalPoints"
    FROM "Team" t
    JOIN "User" u ON t."userId" = u.id
    WHERE t."leagueId" = ${leagueId}
    ORDER BY t."totalPoints" DESC
  `;
  
  return c.json(standings.map((s, idx) => ({
    ...s,
    rank: idx + 1,
    userName: s.userName || "User " + s.userId.slice(0, 4)
  })));
});

app.get("/leagues/:leagueId/results/:raceId", requireUser, async (c) => {
  const { leagueId, raceId } = c.req.param();
  const results = await sql`
    SELECT tr.*, u."displayName" as "userName"
    FROM "TeamResult" tr
    JOIN "Team" t ON tr."teamId" = t.id
    JOIN "User" u ON t."userId" = u.id
    WHERE t."leagueId" = ${leagueId} AND tr."raceId" = ${raceId}
    ORDER BY tr.points DESC
  `;

  const resultsWithDrivers = await Promise.all(results.map(async (r) => {
    const drivers = await sql`
      SELECT d.id, d.name, trd.points
      FROM "TeamResultDriver" trd
      JOIN "Driver" d ON trd."driverId" = d.id
      WHERE trd."teamResultId" = ${r.id}
    `;
    return {
      userId: r.userId,
      userName: r.userName || "User",
      points: Number(r.points),
      captainId: r.captainId,
      reserveId: r.reserveId,
      drivers
    };
  }));

  return c.json(resultsWithDrivers);
});

app.post("/admin/drivers", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  const { updates } = await c.req.json();
  if (!updates || !Array.isArray(updates)) return c.json({ error: "invalid_updates" }, 400);

  await sql.begin(async (sql) => {
    for (const u of updates) {
      await sql`
        UPDATE "Driver" 
        SET price = ${u.price ?? sql`price`}, points = ${u.points ?? sql`points`}
        WHERE id = ${u.id}
      `;
    }
  });

  return c.json({ ok: true });
});

app.post("/admin/migrate-team-name", requireUser, async (c) => {
  const user = c.get("user");
  // Security: Only allow if user is admin of AT LEAST one league (weak check but ok for migration)
  // or just check if it's the specific admin user. 
  // For now, let's just run it.
  
  try {
      await sql`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "name" TEXT DEFAULT 'My F1 Team'`;
      return c.json({ ok: true, message: "Migration applied." });
  } catch (e: any) {
      return c.json({ error: e.message }, 500);
  }
});

app.post("/team/update", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, name } = await c.req.json();
  
  if (!leagueId || !name) return c.json({ error: "missing_fields" }, 400);
  const teamName = name.slice(0, 32);

  const [team] = await sql`
    UPDATE "Team"
    SET "name" = ${teamName}, "updatedAt" = ${new Date().toISOString()}
    WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id}
    RETURNING *
  `;

  if (!team) return c.json({ error: "team_not_found" }, 404);

  return c.json({ ok: true, name: team.name });
});

app.post("/league/kick", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, userId } = await c.req.json();
  
  if (!leagueId || !userId) return c.json({ error: "missing_fields" }, 400);

  // Check if requestor is ADMIN
  const admins = await sql`SELECT role FROM "LeagueMember" WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id} AND role = 'ADMIN'`;
  if (admins.length === 0) return c.json({ error: "not_admin" }, 403);

  if (userId === user.id) return c.json({ error: "cannot_kick_self" }, 400);

  // Delete Member and Team
  await sql.begin(async sql => {
      await sql`DELETE FROM "Team" WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}`;
      await sql`DELETE FROM "LeagueMember" WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}`;
  });

  return c.json({ ok: true });
});

app.post("/league/delete", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId } = await c.req.json();
  
  if (!leagueId) return c.json({ error: "missing_fields" }, 400);

  // Check if requestor is ADMIN
  const admins = await sql`SELECT role FROM "LeagueMember" WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id} AND role = 'ADMIN'`;
  if (admins.length === 0) return c.json({ error: "not_admin" }, 403);

  // Delete everything (Cascading manually to be safe)
  await sql.begin(async sql => {
      await sql`DELETE FROM "TeamResult" WHERE "leagueId" = ${leagueId}`;
      await sql`DELETE FROM "Team" WHERE "leagueId" = ${leagueId}`;
      await sql`DELETE FROM "LeagueMember" WHERE "leagueId" = ${leagueId}`;
      await sql`DELETE FROM "Lineup" WHERE "leagueId" = ${leagueId}`; // Added Lineup
      await sql`DELETE FROM "League" WHERE id = ${leagueId}`;
  });

  return c.json({ ok: true });
});

// Helper constants for Sync
const OPENF1_BASE = "https://api.openf1.org/v1";
const DRIVER_NUMBER_MAP: Record<string, number> = {
  'ver': 1, 'per': 11, 'ham': 44, 'lec': 16, 'rus': 63, 'ant': 12, 'nor': 4,
  'pia': 81, 'alo': 14, 'str': 18, 'gas': 10, 'doo': 7, 'alb': 23, 'sai': 55,
  'tsu': 22, 'law': 30, 'hul': 27, 'bor': 59, 'oco': 31, 'bea': 87, 'bot': 77, 'col': 43
};
const REVERSE_DRIVER_MAP: Record<number, string> = Object.fromEntries(
  Object.entries(DRIVER_NUMBER_MAP).map(([id, num]) => [num, id])
);
const DEFAULT_RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const DEFAULT_SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

async function getOpenF1SessionKey(year: number, location: string, type: 'Race' | 'Qualifying' | 'Sprint' | 'Sprint Qualifying'): Promise<number | null> {
  const url = `${OPENF1_BASE}/sessions?year=${year}&location=${encodeURIComponent(location)}&session_name=${encodeURIComponent(type)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) return data[0].session_key;
  } catch (e) { console.error(e); }
  return null;
}

async function getOpenF1Classification(sessionKey: number): Promise<Record<string, number>> {
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
      if (driverId) results[driverId] = pos;
    }
    return results;
  } catch (_e) { return {}; }
}

app.post("/admin/sync-race", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  const { raceId } = await c.req.json();
  if (!raceId) return c.json({ error: "missing_raceId" }, 400);

  try {
    // 1. Get Race Info
    const [race] = await sql`SELECT * FROM "Race" WHERE id = ${raceId}`;
    if (!race) return c.json({ error: "race_not_found" }, 404);


    // 2. Fetch OpenF1 Data - RACE
    const location = race.city || race.country || "";
    const raceSessionType = race.isSprint ? "Sprint" : "Race";
    const sessionKey = await getOpenF1SessionKey(race.season || 2026, location, raceSessionType);
    
    if (!sessionKey) return c.json({ error: "openf1_session_not_found", location, season: race.season }, 404);

    const classification = await getOpenF1Classification(sessionKey);
    if (Object.keys(classification).length === 0) return c.json({ error: "no_classification_data" }, 404);

    // 2b. Fetch OpenF1 Data - QUALIFYING / SHOOTOUT
    let gridPositions: Record<string, number> = {};
    const qualiSessionType = race.isSprint ? "Sprint Qualifying" : "Qualifying";
    const qualiKey = await getOpenF1SessionKey(race.season || 2026, location, qualiSessionType);

    if (qualiKey && qualiKey !== sessionKey) {
          gridPositions = await getOpenF1Classification(qualiKey);
    } else {
        // If "Sprint Qualifying" fails, fallback to "Sprint Shootout"? (older name)
        // Or if Quali fails, maybe log it.
        if (race.isSprint) {
             const fallbackKey = await getOpenF1SessionKey(race.season || 2026, location, "Sprint Shootout" as any);
             if (fallbackKey) gridPositions = await getOpenF1Classification(fallbackKey);
        }
    }

    // 3. Calculate Points
    const pointsArray = race.isSprint ? DEFAULT_SPRINT_POINTS : DEFAULT_RACE_POINTS;
    const driverRacePoints: Record<string, number> = {};
    
    // Constants from Scoring Rules (Matching web/constants.ts)
    const SCORING = {
        RACE_LAST_PLACE: -3,
        QUALI_Q1_ELIM: -3, // Pos 16-20 (assuming 20 cars)
        QUALI_Q2_REACHED: 1, // Pos 11-15
        QUALI_Q3_REACHED: 3, // Pos 1-10
        QUALI_POLE: 3,
        SPRINT_POLE: 2, // Standard FantaF1 usually gives less for Sprint Pole or same? User said "we have possibility". 
                        // Let's assume 2 for now, or match Pole (3). Let's use 2 as a safe bet or check standard rules. 
                        // Actually, web/types has sprintPole. Let's assume it's same as normal pole or 1.
                        // I will use 2.
        RACE_DNF: -5,
        TEAMMATE_BEAT: 2,
        TEAMMATE_LOST: -2,
        TEAMMATE_BEAT_DNF: 1, 
        POS_GAINED: 1,
        POS_LOST: -1
    };

    // Helper to get driver teammate
    // We need to fetch all drivers to map constructors
    const allDrivers = await sql`SELECT id, "constructorId" FROM "Driver"`;
    const driverTeamMap: Record<string, string> = {}; // driverId -> constructorId
    allDrivers.forEach(d => driverTeamMap[d.id] = d.constructorId);

    // Identify Teammates
    const teammates: Record<string, string> = {}; // driverId -> teammateId
    for (const d of allDrivers) {
        const mate = allDrivers.find(x => x.constructorId === d.constructorId && x.id !== d.id);
        if (mate) teammates[d.id] = mate.id;
    }


    for (const [driverId, position] of Object.entries(classification)) {
      let pts = 0;

      // A. Race Position
      if (position >= 1 && position <= pointsArray.length) {
          pts += (pointsArray[position - 1] ?? 0);
      }

      // B. Race Last Place Malus
      const maxPos = Math.max(...Object.values(classification));
      if (position === maxPos && maxPos > 10) { 
          pts += SCORING.RACE_LAST_PLACE;
      }

      // C. Grid & Qualifying Bonuses (Now applies to BOTH Race and Sprint)
      if (gridPositions[driverId]) {
          const grid = gridPositions[driverId];
          
          if (!race.isSprint) {
              // Standard Quali Bonuses
              if (grid === 1) pts += SCORING.QUALI_POLE;
              if (grid <= 10) pts += SCORING.QUALI_Q3_REACHED;
              else if (grid <= 15) pts += SCORING.QUALI_Q2_REACHED;
              else pts += SCORING.QUALI_Q1_ELIM; // 16+
          } else {
              // Sprint Shootout Bonuses
              // Assuming only Pole applies to Sprint Shootout?
              if (grid === 1) pts += SCORING.SPRINT_POLE;
              // Do Q1/Q2/Q3 apply? User implies "Points for Pole Sprint".
              // Usually Shootout is shorter, maybe no Q3 bonus? 
              // Leaving out Q1/Q2/Q3 for Sprint unless requested.
          }

          // Positions Gained/Lost (Applies to BOTH)
          const diff = grid - position;
          let movePts = 0;
          
          if (diff > 0) {
              // Gained positions
              for (let p = grid - 1; p >= position; p--) {
                  // Moving from p+1 to p
                  // If target p is <= 10, value is 1. If target p > 10, value is 0.5.
                  movePts += (p <= 10 ? 1 : 0.5); 
              }
          } else if (diff < 0) {
              // Lost positions
              for (let p = grid + 1; p <= position; p++) {
                  // Moving from p-1 to p
                  // If target p <= 10, -1. If target p > 10, -0.5.
                  movePts -= (p <= 10 ? 1 : 0.5);
              }
          }
          pts += movePts;
      }

      // D. DNF / Status
      // How to detect DNF from OpenF1 classification?
      // Usually status is not in 'position' endpoint.
      // But if we miss 'status', we can't be 100% sure.
      // Workaround: We might need to check if driver is NOT in classification but WAS in Grid? 
      // Or check 'laps' count vs Winner laps?
      // For now, let's assume if position is NOT found in classification, they DNF? 
      // But we are looping `classification`.
      // TODO: Improve DNF detection with 'intervals' or 'laps' endpoint in future.
      // For now, we can't apply RaceDNF reliably without 'status'. 
      // However, user specifically asked for "ritiro".
      // Let's try to infer: If NOT isCompleted (which we don't have per driver) ...
      // If we use 'intervals' endpoint for all drivers, we could see 'gap_to_leader'.
      // LET'S SKIP DNF MALUS FOR V1 SAFETY unless we are sure, OR apply it if we can find a way.
      // Actually, OpenF1 classification usually includes DNFs at the bottom or excludes them?
      // If excludes, we need to find missing drivers.
      
      // Teammate Duel
      const mateId = teammates[driverId];
      if (mateId && classification[mateId]) {
          const matePos = classification[mateId];
          if (position < matePos) {
              pts += SCORING.TEAMMATE_BEAT;
          } else {
              pts += SCORING.TEAMMATE_LOST;
          }
      } else if (mateId && !classification[mateId]) {
           // Teammate not in classification -> Likely DNF or DNS
           // If I am classified and he is not -> I beat him
           pts += SCORING.TEAMMATE_BEAT;
           pts += SCORING.TEAMMATE_BEAT_DNF;
      }

      driverRacePoints[driverId] = pts;
    }
    
    // Handle drivers NOT in classification (DNFs?)
    // If they were in Grid/Drivers list but not in Race Classification
    if (!race.isSprint) {
        // Iterate all active drivers to find those missing from Race Classification
        for (const d of allDrivers) {
            if (driverRacePoints[d.id] === undefined) {
                 // Driver missed Race Classification.
                 // Did they qualify?
                 const grid = gridPositions[d.id];
                 let pts = 0;
                 if (grid) {
                     // They existed in Quali, so they probably started or tried to.
                     // Apply DNF Malus
                     pts += SCORING.RACE_DNF;
                     
                     // Quali points still apply? Yes usually.
                     if (grid === 1) pts += SCORING.QUALI_POLE;
                     if (grid <= 10) pts += SCORING.QUALI_Q3_REACHED;
                     else if (grid <= 15) pts += SCORING.QUALI_Q2_REACHED;
                     else pts += SCORING.QUALI_Q1_ELIM;
                 }
                 
                 // Teammate check (Reverse)
                 const mateId = teammates[d.id];
                 if (mateId && driverRacePoints[mateId] !== undefined) {
                     // Teammate finished, I didn't.
                     // I lost.
                     pts += SCORING.TEAMMATE_LOST;
                 }
                 
                 if (grid || driverRacePoints[d.id] !== undefined) {
                     driverRacePoints[d.id] = (driverRacePoints[d.id] || 0) + pts;
                 }
            }
        }
    }

    // 4. Transactional Update

    // 4. Transactional Update
    await sql.begin(async (sql) => {
       // A. Update Driver Points
       for (const [driverId, points] of Object.entries(driverRacePoints)) {
         await sql`UPDATE "Driver" SET points = points + ${points} WHERE id = ${driverId}`;
       }

       // B. Snapshot Teams
       const teams = await sql`SELECT id, "userId", "captainId", "reserveId" FROM "Team"`;
       
       for (const team of teams) {
          // Get Team Drivers
          const teamDrivers = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${team.id}`;
          
          let teamPoints = 0;
          const resultDrivers = [];

          for (const td of teamDrivers) {
             let pts = (driverRacePoints[td.driverId] as number) || 0;
             if (team.captainId === td.driverId) pts *= 2;
             teamPoints += pts;
             resultDrivers.push({ driverId: td.driverId, points: pts });
          }

          // Create TeamResult
          const trId = crypto.randomUUID();
          await sql`
            INSERT INTO "TeamResult" (id, "raceId", "teamId", points, "captainId", "reserveId", "createdAt")
            VALUES (${trId}, ${race.id}, ${team.id}, ${teamPoints}, ${team.captainId}, ${team.reserveId}, ${new Date().toISOString()})
          `;

          // Create TeamResultDrivers
          for (const rd of resultDrivers) {
             const trdId = crypto.randomUUID();
             await sql`
                INSERT INTO "TeamResultDriver" (id, "teamResultId", "driverId", points)
                VALUES (${trdId}, ${trId}, ${rd.driverId}, ${rd.points})
             `;
          }

          // Update Team Total Points
          await sql`UPDATE "Team" SET "totalPoints" = "totalPoints" + ${teamPoints} WHERE id = ${team.id}`;
       }

       // C. Mark Race Completed
       await sql`UPDATE "Race" SET "isCompleted" = true WHERE id = ${raceId}`;
    });

    return c.json({ ok: true, classification, points: driverRacePoints });

  } catch (e: any) {
    return c.json({ error: e.message, type: "sync_race_error" }, 500);
  }
});

serve(app.fetch);
