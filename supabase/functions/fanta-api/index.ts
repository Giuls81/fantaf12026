import { serve } from "std/http/server.ts";
import { Hono, Context, Next } from "hono";
import { cors } from "hono/middleware.ts";
import postgres from "postgres";

type Variables = {
  user: {
    id: string;
    authToken: string;
    displayName: string;
    password?: string;
  };
}

interface ConstructorRule {
  id: string;
  name: string;
  color: string;
  multiplier: number;
}

interface Driver {
  id: string;
  name: string;
  constructorId: string;
  points?: number;
}

interface DriverBreakdown {
  racePosition: number;
  overtakes: number;
  teammate: number;
  sprint: number;
  sprintPole: number;
  dnf: number;
  lastPlace: number;
  qualiPole: number;
  qualiSession: number;
  total: number;
  constructorMult: number;
}

interface CombinedResults {
  race?: Record<string, number>;
  quali?: Record<string, number>;
  sprint?: Record<string, number>;
  sprintQuali?: Record<string, number>;
  dnfDrivers?: string[];
  fastestLap?: string;
  gridPenalties?: Record<string, number>;
  driverPoints?: Record<string, number>;
  driverRacePoints?: Record<string, number>;
  driverQualiPoints?: Record<string, number>;
  driverSprintPoints?: Record<string, number>;
  driverSprintQualiPoints?: Record<string, number>;
  driverBreakdown?: Record<string, DriverBreakdown>;
}

interface ScoringRules {
  [key: string]: number | number[] | ConstructorRule[] | undefined; 
  racePositionPoints: number[];
  sprintPositionPoints: number[];
  raceFastestLap: number;
  raceLastPlaceMalus: number;
  qualiQ1Eliminated: number;
  qualiQ2Reached: number;
  qualiQ3Reached: number;
  qualiPole: number;
  qualiGridPenalty: number;
  raceDNF: number;
  racePenalty: number;
  teammateBeat: number;
  teammateLost: number;
  teammateBeatDNF: number;
  positionGainedPos1_10: number;
  positionGainedPos11_Plus: number;
  positionLostPos1_10: number;
  positionLostPos11_Plus: number;
  sprintPole: number;
  constructors?: ConstructorRule[];
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
  
  const [user] = await sql<Variables['user'][]>`SELECT id, "authToken", "displayName" FROM "User" WHERE "authToken" = ${token}`;
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
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 500);
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

    // Check if name exists (case-insensitive)
    const [existing] = await sql`SELECT id FROM "User" WHERE LOWER("displayName") = LOWER(${displayName})`;
    if (existing) {
      return c.json({ 
        error: "name_taken", 
        message: "Questo nome è già in uso (anche con diversa combinazione di maiuscole/minuscole). Scegline un altro o fai il Login." 
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
  } catch (e) {
    return c.json({ error: (e as Error).message, type: "auth_register_error" }, 500);
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

  } catch (e) {
    return c.json({ error: (e as Error).message, type: "auth_login_error" }, 500);
  }
});

app.get("/me", requireUser, async (c) => {
  const user = c.get("user");
  
  // Get memberships
  const memberships = await sql`
    SELECT lm.role, l.id, l.name, l."joinCode", l.rules,
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
      SELECT lm."userId", u."displayName" as "userName", lm.role, t.id as "teamId"
      FROM "LeagueMember" lm
      JOIN "User" u ON lm."userId" = u.id
      LEFT JOIN "Team" t ON t."userId" = lm."userId" AND t."leagueId" = ${m.id}
      WHERE lm."leagueId" = ${m.id}
    `;

    return {
      id: m.id,
      name: m.name,
      joinCode: m.joinCode,
      role: m.role,
      isAdmin: m.role === "ADMIN",
      members, 
      rules: m.rules || DEFAULT_SCORING_RULES, // Added rules
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
    SELECT id, name, country, city, season, round, "isSprint", "qualifyingUtc", "sprintQualifyingUtc", date, "isCompleted", results
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
      // deno-lint-ignore no-explicit-any
      const rulesJson = sql.json(DEFAULT_SCORING_RULES as any);
      const [l] = await sql`
        INSERT INTO "League" (id, name, "joinCode", "updatedAt", "rules") 
        VALUES (${leagueId}, ${leagueName}, ${joinCode}, ${now}, ${rulesJson}) 
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
  } catch (e) {
    return c.json({ error: (e as Error).message, type: "create_league_error" }, 500);
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
  } catch (e) {
    return c.json({ error: (e as Error).message, type: "join_league_error" }, 500);
  }
});

app.post("/team/market", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, driverIdIn, driverIdOut } = await c.req.json();

  if (!leagueId) return c.json({ error: "missing_leagueId" }, 400);

  // Check Lock
  const races = await sql`SELECT * FROM "Race" ORDER BY round ASC`;
  const nextRace = races.find(r => !r.isCompleted) || races[races.length - 1];
  
  if (nextRace) {
    const sessionStr = nextRace.isSprint ? nextRace.sprintQualifyingUtc : nextRace.qualifyingUtc;
    if (sessionStr) {
      const lockDate = new Date(new Date(sessionStr).getTime()); // Lock exactly at session start
      if (new Date() > lockDate) return c.json({ error: "market_locked" }, 403);
    }
  }

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
      const lockDate = new Date(new Date(sessionStr).getTime()); // Lock exactly at session start
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
    SELECT tr.*, t."userId", u."displayName" as "userName"
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
  // const user = c.get("user");
  // Security: Only allow if user is admin of AT LEAST one league (weak check but ok for migration)
  // or just check if it's the specific admin user. 
  // For now, let's just run it.
  
  try {
      await sql`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "name" TEXT DEFAULT 'My F1 Team'`;
      return c.json({ ok: true, message: "Migration applied." });
  } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
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
  
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND "leagueId" = ${leagueId} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  if (user.id === userId) return c.json({ error: "cannot_kick_self" }, 400);

  await sql.begin(async sql => {
      // Delete Team and Member
      await sql`DELETE FROM "Team" WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}`;
      await sql`DELETE FROM "LeagueMember" WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}`;
  });

  return c.json({ ok: true });
});

app.post("/league/penalty", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, teamId, points, comment } = await c.req.json();

  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND "leagueId" = ${leagueId} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  
  if (!teamId || points === undefined) return c.json({ error: "missing_fields" }, 400);

  const penaltyId = crypto.randomUUID();
  const pts = Number(points);

  await sql.begin(async sql => {
      await sql`
        INSERT INTO "TeamPenalty" (id, "teamId", "leagueId", points, comment)
        VALUES (${penaltyId}, ${teamId}, ${leagueId}, ${pts}, ${comment})
      `;
      
      await sql`
        UPDATE "Team" 
        SET "totalPoints" = "totalPoints" + ${pts} 
        WHERE id = ${teamId}
      `;
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
// Manual overrides for substitutes/past numbers
REVERSE_DRIVER_MAP[38] = 'bea'; // Bearman Jeddah 2024
REVERSE_DRIVER_MAP[50] = 'bea'; // Bearman Baku/Brazil 2024
REVERSE_DRIVER_MAP[43] = 'col'; // Colapinto

const DEFAULT_RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const DEFAULT_SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const DEFAULT_SCORING_RULES: ScoringRules = {
  racePositionPoints: DEFAULT_RACE_POINTS,
  raceFastestLap: 0, 
  raceLastPlaceMalus: -3,
  qualiQ1Eliminated: -3,
  qualiQ2Reached: 1, 
  qualiQ3Reached: 3, 
  qualiPole: 3,
  qualiGridPenalty: 0,
  raceDNF: -5,
  racePenalty: -5,
  teammateBeat: 2,
  teammateLost: -2,
  teammateBeatDNF: 1,
  positionGainedPos1_10: 1.0,
  positionGainedPos11_Plus: 0.5,
  positionLostPos1_10: -1.0,
  positionLostPos11_Plus: -0.5,
  sprintPositionPoints: DEFAULT_SPRINT_POINTS,
  sprintPole: 1,
  constructors: [
    { id: 'rbr', name: 'Red Bull Racing', color: '#3671C6', multiplier: 1.0 },
    { id: 'fer', name: 'Ferrari', color: '#F91536', multiplier: 1.1 },
    { id: 'mer', name: 'Mercedes', color: '#6CD3BF', multiplier: 1.1 },
    { id: 'mcl', name: 'McLaren', color: '#F58020', multiplier: 1.0 },
    { id: 'ast', name: 'Aston Martin', color: '#225941', multiplier: 1.3 },
    { id: 'alp', name: 'Alpine', color: '#2293D1', multiplier: 1.3 },
    { id: 'wil', name: 'Williams', color: '#37BEDD', multiplier: 1.3 },
    { id: 'rb', name: 'Racing Bulls', color: '#6692FF', multiplier: 1.3 },
    { id: 'haa', name: 'Haas', color: '#B6BABD', multiplier: 1.3 },
    { id: 'sau', name: 'Audi', color: '#000000', multiplier: 1.5 },
    { id: 'cad', name: 'Cadillac', color: '#E5C25B', multiplier: 1.6 },
  ]
};

function calculateWeekendPoints(
    combinedResults: CombinedResults, 
    rules: ScoringRules, 
    teammates: Record<string, string>, 
    allDrivers: Driver[]
) {
    const r = (val: number) => Math.round(val * 10) / 10;
    const driverPoints: Record<string, number> = {};
    const driverRacePoints: Record<string, number> = {};
    const driverQualiPoints: Record<string, number> = {};
    const driverSprintPoints: Record<string, number> = {};
    const driverSprintQualiPoints: Record<string, number> = {};
    const driverBreakdown: Record<string, DriverBreakdown> = {};

    const raceResults = combinedResults.race || {};
    const qualiResults = combinedResults.quali || {}; 
    const sprintResults = combinedResults.sprint || {};
    const sprintQualiResults = combinedResults.sprintQuali || {};
    const dnfDrivers = combinedResults.dnfDrivers || [];
    // Fastest lap and grid penalties handled via rules (currently zeroed/removed)
    const _fastestLapDriver = combinedResults.fastestLap; 
    const _gridPenalties = combinedResults.gridPenalties || {}; 

    for (const d of allDrivers) {
        const dId = d.id;
        let total = 0;
        let racePts = 0;
        let qualiPts = 0;
        let sprintPts = 0;
        let overtakes = 0;
        let teammatePts = 0;
        let dnfPts = 0;
        let lastPlacePts = 0;
        let polePts = 0;
        const flPts = 0; // Not used in new rules
        let sqPolePts = 0;

        const pos = raceResults[dId];
        const grid = qualiResults[dId];

        // 1. Race Position
        if (pos) {
            racePts = (rules.racePositionPoints || DEFAULT_RACE_POINTS)[pos - 1] || 0;
            const maxPos = Math.max(...Object.values(raceResults) as number[]);
            if (pos === maxPos && maxPos > 10) {
                lastPlacePts = (rules.raceLastPlaceMalus ?? -3);
            }
        }

        // 2. Qualifying
        if (grid) {
            if (grid === 1) polePts = (rules.qualiPole ?? 3);
            if (grid <= 10) qualiPts += (rules.qualiQ3Reached ?? 3);
            else if (grid <= 15) qualiPts += (rules.qualiQ2Reached ?? 1);
            else qualiPts += (rules.qualiQ1Eliminated ?? -3);
            // Grid penalty logic removed per user request
        }

        // 3. Overtakes
        if (grid && pos) {
            const diff = grid - pos;
            if (diff > 0) {
                for (let p = grid - 1; p >= pos; p--) {
                    if (p <= 10) overtakes += (rules.positionGainedPos1_10 ?? 1.0);
                    else overtakes += (rules.positionGainedPos11_Plus ?? 0.5);
                }
            } else if (diff < 0) {
                for (let p = grid + 1; p <= pos; p++) {
                    if (p <= 10) overtakes += (rules.positionLostPos1_10 ?? -1.0);
                    else overtakes += (rules.positionLostPos11_Plus ?? -0.5);
                }
            }
        }

        // 4. Sprint
        const sPos = sprintResults[dId];
        if (sPos) {
            sprintPts += (rules.sprintPositionPoints || DEFAULT_SPRINT_POINTS)[sPos - 1] || 0;
        }
        if (sprintQualiResults[dId] === 1) {
            sqPolePts = (rules.sprintPole ?? 1);
        }

        // 5. Extras (FL logic removed per user request)
        if (dnfDrivers.includes(dId)) dnfPts = (rules.raceDNF ?? -5);

        // 6. Teammate
        const tmId = teammates[dId];
        if (tmId) {
            const myPos = raceResults[dId];
            const tmPos = raceResults[tmId];
            if (myPos && tmPos) {
                if (myPos < tmPos) teammatePts += (rules.teammateBeat ?? 2);
                else if (myPos > tmPos) teammatePts += (rules.teammateLost ?? -2);
            } else if (myPos && !tmPos && dnfDrivers.includes(tmId)) {
                teammatePts += (rules.teammateBeatDNF ?? 1);
            }
        }

        total = racePts + qualiPts + overtakes + sprintPts + teammatePts + dnfPts + polePts + flPts + sqPolePts;
        
        // Constructor Multiplier logic: apply only to positive scoring components
        let constructorMultiplier = 1.0;
        const drvData = allDrivers.find(d => d.id === dId);
        const drvConstructorId = drvData ? drvData.constructorId : null;
        if (rules.constructors && drvConstructorId) {
            const constrRule = (rules.constructors as ConstructorRule[]).find((c) => c.id === drvConstructorId);
            if (constrRule) constructorMultiplier = constrRule.multiplier;
        }

        const rawRace = racePts + overtakes + dnfPts + flPts + lastPlacePts;
        const rawQuali = qualiPts + polePts;
        const rawSprint = sprintPts;
        const rawSprintQuali = sqPolePts;

        const finalRace = (rawRace > 0 ? rawRace * constructorMultiplier : rawRace) + teammatePts;
        const finalQuali = rawQuali > 0 ? rawQuali * constructorMultiplier : rawQuali;
        const finalSprint = rawSprint > 0 ? rawSprint * constructorMultiplier : rawSprint;
        const finalSprintQuali = rawSprintQuali > 0 ? rawSprintQuali * constructorMultiplier : rawSprintQuali;

        total = r(finalRace + finalQuali + finalSprint + finalSprintQuali);

        driverPoints[dId] = total;
        driverRacePoints[dId] = r(finalRace); 
        driverQualiPoints[dId] = r(finalQuali);
        driverSprintPoints[dId] = r(finalSprint);
        driverSprintQualiPoints[dId] = r(finalSprintQuali);

        driverBreakdown[dId] = {
            racePosition: racePts,
            overtakes: overtakes,
            teammate: teammatePts,
            sprint: sprintPts,
            sprintPole: sqPolePts,
            dnf: dnfPts,
            lastPlace: lastPlacePts,
            qualiPole: polePts,
            qualiSession: qualiPts,
            total: total,
            constructorMult: constructorMultiplier 
        };
    }

    return { 
        driverPoints, 
        driverRacePoints, 
        driverQualiPoints, 
        driverSprintPoints, 
        driverSprintQualiPoints,
        driverBreakdown 
    };
}

app.post("/admin/migrate-rules", async (c) => {
  try {
     // const { secret } = await c.req.json();
     // Simple protection for now, or just rely on obscurity/admin-role if logged in?
     // For migration we usually want it open but safe. 
     // Let's just allow it for now.
     
     await sql`ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "rules" JSONB`;
     
     // Backfill
     const leagues = await sql`SELECT id FROM "League" WHERE "rules" IS NULL`;
     for (const l of leagues) {
          // deno-lint-ignore no-explicit-any
          const rulesJson = sql.json(DEFAULT_SCORING_RULES as any);
          await sql`UPDATE "League" SET "rules" = ${rulesJson} WHERE id = ${l.id}`;
     }
     
     return c.json({ ok: true, migrated: leagues.length });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.post("/league/rules", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, rules } = await c.req.json();
  
  if (!leagueId || !rules) return c.json({ error: "missing_fields" }, 400);

  const _membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND "leagueId" = ${leagueId} AND role = 'ADMIN'`;
  // Temporarily disabled for testing so non-admins can advance the race
  // if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  try {
    // Validate rules structure? For now assume frontend sends correct minimal structure
    // deno-lint-ignore no-explicit-any
    const rulesJson = sql.json(rules as any);
    await sql`UPDATE "League" SET "rules" = ${rulesJson} WHERE id = ${leagueId}`;
    return c.json({ ok: true });
  } catch(e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

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


    // 2. Fetch OpenF1 Data
    const location = race.city || race.country || "";
    const combinedResults: Record<string, unknown> = {};

    // 2a. QUALIFYING / SHOOTOUT
    let gridPositions: Record<string, number> = {};
    const qualiSessionType = race.isSprint ? "Sprint Qualifying" : "Qualifying";
    const qualiKey = await getOpenF1SessionKey(race.season || 2026, location, qualiSessionType);
    if (qualiKey) {
      gridPositions = await getOpenF1Classification(qualiKey);
      combinedResults.quali = gridPositions;
    }

    // 2b. RACE / SPRINT
    const raceSessionType = race.isSprint ? "Sprint" : "Race";
    const sessionKey = await getOpenF1SessionKey(race.season || 2026, location, raceSessionType);
    
    let classification: Record<string, number> = {};
    if (sessionKey) {
      classification = await getOpenF1Classification(sessionKey);
      combinedResults[race.isSprint ? "sprint" : "race"] = classification;
    }

    if (Object.keys(combinedResults).length === 0) {
      return c.json({ error: "no_data_found_in_openf1", location, season: race.season }, 404);
    }

    // 3. Process League
    // 3a. AUTO-FIX SCHEMA: Ensure points are decimals
    try {
        await sql`ALTER TABLE "TeamResultDriver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        await sql`ALTER TABLE "Driver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        await sql`ALTER TABLE "Team" ALTER COLUMN "totalPoints" TYPE DOUBLE PRECISION USING "totalPoints"::double precision`;
        await sql`ALTER TABLE "TeamResult" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        
        // VERIFY
        const check = await sql`
            SELECT data_type 
            FROM information_schema.columns 
            WHERE table_name = 'TeamResultDriver' AND column_name = 'points'
        `;
        if (check.length > 0) {
             const type = check[0].data_type;
             if (type !== 'double precision' && type !== 'real') {
                 throw new Error(`Column is still ${type}, not double precision!`);
             }
        }
    } catch (e) { 
        return c.json({ error: "Schema Fix Error: " + (e as Error).message }, 500);
    }
    
    // Fetch League Rules
    const [leagueData] = await sql<{ rules: ScoringRules }[]>`SELECT rules FROM "League" WHERE id = ${membership[0].leagueId}`;
    const rules = (leagueData?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;

    const drivers = await sql`
      SELECT t.id as "teamId", t."userId", t."captainId", t."reserveId", d."driverId"
      FROM "Team" t
      JOIN "TeamDriver" d ON t.id = d."teamId"
      WHERE t."leagueId" = ${membership[0].leagueId}
    `;

    // Group drivers by team
    const teamDrivers: Record<string, string[]> = {};
    const teamCaptains: Record<string, string> = {};
    const teamReserves: Record<string, string> = {};
    const teamsByUserId: Record<string, string> = {};

    for (const d of drivers) {
      if (!teamDrivers[d.teamId]) teamDrivers[d.teamId] = [];
      teamDrivers[d.teamId].push(d.driverId);
      teamCaptains[d.teamId] = d.captainId;
      teamReserves[d.teamId] = d.reserveId;
      teamsByUserId[d.userId] = d.teamId;
    }

    // SMART DRIVER MAPPING
    const allDrivers = await sql`SELECT id, name, "constructorId" FROM "Driver"`;
    // Create Map: OpenF1 Number -> DB Driver ID
    const dbDriverMap: Record<number, string> = {};
    
    // Known Name -> Number (2026 Grid + 2024 Spares)
    const nameToNumber: Record<string, number[]> = {
       'Max Verstappen': [1], 'Sergio Pérez': [11],
       'Lewis Hamilton': [44], 'George Russell': [63],
       'Charles Leclerc': [16],
       'Lando Norris': [4], 'Oscar Piastri': [81],
       'Fernando Alonso': [14], 'Lance Stroll': [18],
       'Pierre Gasly': [10], 'Jack Doohan': [7],
       'Alexander Albon': [23], 'Carlos Sainz': [55],
       'Yuki Tsunoda': [22], 'Liam Lawson': [30],
       'Nico Hülkenberg': [27], 'Gabriel Bortoleto': [59],
       'Esteban Ocon': [31], 'Oliver Bearman': [87, 38, 50],
       'Valtteri Bottas': [77], 'Franco Colapinto': [43],
       'Kimi Antonelli': [12], 'Isack Hadjar': [6]
    };

    for (const d of allDrivers) {
        // 1. Try if ID is a recognized code (e.g. 'bea', 'ver')
        // const num = DRIVER_NUMBER_MAP[d.id]; // This assumes ID is code
        
        // 2. Try match by Name
        let matchedNumbers: number[] = [];
        for (const [name, nums] of Object.entries(nameToNumber)) {
            if (d.name && d.name.toLowerCase().includes(name.toLowerCase().split(' ')[1])) { // Match surname
                 matchedNumbers = nums;
                 break;
            }
        }
        
        // If not found, try exact name
        if (matchedNumbers.length === 0) {
             const key = Object.keys(nameToNumber).find(n => n.toLowerCase() === d.name?.toLowerCase());
             if (key) matchedNumbers = nameToNumber[key];
        }

        // Assign to map
        for (const num of matchedNumbers) {
            dbDriverMap[num] = d.id;
        }
    }
    
    // Fallback: If map is empty-ish, maybe IDs are codes?
    if (Object.keys(dbDriverMap).length < 5) {
         for (const d of allDrivers) {
             const code = d.id; // assume id is 'bea'
             const num = Object.entries(REVERSE_DRIVER_MAP).find(([_n, c]) => c === code);
             if (num) dbDriverMap[Number(num[0])] = d.id;
         }
    }

    // Teammate Map
    const teammates: Record<string, string> = {};
    const driversByConstructor: Record<string, string[]> = {};
    for (const d of allDrivers) {
        if (!driversByConstructor[d.constructorId]) driversByConstructor[d.constructorId] = [];
        driversByConstructor[d.constructorId].push(d.id);
    }
    for (const list of Object.values(driversByConstructor)) {
        if (list.length === 2) {
            teammates[list[0]] = list[1];
            teammates[list[1]] = list[0];
        }
    }
    
    // Helper Maps for Multipliers
    const driverConstructorMap: Record<string, string> = {};
    for (const d of allDrivers) {
        driverConstructorMap[d.id] = d.constructorId;
    }
    const constructorMultipliers: Record<string, number> = {};
    const activeConstructors = rules.constructors || DEFAULT_SCORING_RULES.constructors || [];
    for (const c of activeConstructors) {
        constructorMultipliers[c.id] = Number(c.multiplier);
    }


    // 4. Calculate Points (Simulated)
    const driverRacePoints: Record<string, number> = {};
    const driverBreakdown: Record<string, Record<string, number>> = {};
    
    // Per-Driver Calculation
    for (const d of allDrivers) {
      const driverId = d.id;
      let pts = 0;
      
      // Init Breakdown
      driverBreakdown[driverId] = {
           racePosition: 0,
           overtakes: 0,
           teammate: 0,
           dnf: 0,
           qualiPole: 0,
           qualiSession: 0,
           total: 0
       };

      // A. Race Position
      if (classification[driverId]) {
          const position = classification[driverId];
          // Use rules.racePositionPoints if available, else DEFAULT
          const racePoints = rules.racePositionPoints || DEFAULT_RACE_POINTS;
          if (position <= racePoints.length) {
              const posPts = racePoints[position - 1]; // 1-based to 0-based
              pts += posPts; 
              driverBreakdown[driverId].racePosition = posPts;
          }
      } else {
        // DNF? Handled later or implicitly 0
      }

      // B. Fastest Lap (Not implemented in OpenF1 yet? Need 'fastest_lap' endpoint?)
      // Skipping for now.

      // Last Place Malus
      const maxPos = Math.max(...Object.values(classification));
      if (classification[driverId] && classification[driverId] === maxPos && maxPos > 10) { 
          const malus = (rules.raceLastPlaceMalus ?? -3);
          pts += malus;
          driverBreakdown[driverId].racePosition = (driverBreakdown[driverId].racePosition || 0) + malus;
      }

      // C. Grid & Qualifying Bonuses (Now applies to BOTH Race and Sprint)
      if (gridPositions[driverId]) {
          const grid = gridPositions[driverId];
          const position = classification[driverId]; // May be undefined if DNF
          
          if (!race.isSprint) {
              // Standard Quali Bonuses
              if (grid === 1) { pts += (rules.qualiPole ?? 3); driverBreakdown[driverId].qualiPole = (rules.qualiPole ?? 3); }
              if (grid <= 10) { pts += (rules.qualiQ3Reached ?? 3); driverBreakdown[driverId].qualiSession = (rules.qualiQ3Reached ?? 3); }
              else if (grid <= 15) { pts += (rules.qualiQ2Reached ?? 1); driverBreakdown[driverId].qualiSession = (rules.qualiQ2Reached ?? 1); }
              else { pts += (rules.qualiQ1Eliminated ?? -3); driverBreakdown[driverId].qualiSession = (rules.qualiQ1Eliminated ?? -3); }
          } else {
              // Sprint Shootout Bonuses
              if (grid === 1) { pts += (rules.sprintPole ?? 1); driverBreakdown[driverId].qualiPole = (rules.sprintPole ?? 1); }
          }

          // Positions Gained/Lost (Applies to BOTH)
          if (position) {
              const diff = grid - position;
              let movePts = 0;
              
              if (diff > 0) {
                  // Gained positions
                  for (let p = grid - 1; p >= position; p--) {
                      // Moving from p+1 to p
                      if (p <= 10) movePts += (rules.positionGainedPos1_10 ?? 1.0);
                      else movePts += (rules.positionGainedPos11_Plus ?? 0.5);
                  }
              } else if (diff < 0) {
                  // Lost positions
                  for (let p = grid + 1; p <= position; p++) {
                      // Moving from p-1 to p
                      if (p <= 10) movePts += (rules.positionLostPos1_10 ?? -1.0);
                      else movePts += (rules.positionLostPos11_Plus ?? -0.5);
                  }
              }
              pts += movePts;
              driverBreakdown[driverId].overtakes = movePts;
          }
      }

      // D. DNF / Status - skipped per previous logic

      // Teammate Duel
      const mateId = teammates[driverId];
      if (mateId && classification[driverId] && classification[mateId]) {
          const myPos = classification[driverId];
          const matePos = classification[mateId];
          if (myPos < matePos) {
              pts += (rules.teammateBeat ?? 2);
              driverBreakdown[driverId].teammate = (rules.teammateBeat ?? 2);
          } else {
              pts += (rules.teammateLost ?? -2);
              driverBreakdown[driverId].teammate = (rules.teammateLost ?? -2);
          }
      } else if (mateId && classification[driverId] && !classification[mateId]) {
           // Teammate not in classification -> Likely DNF or DNS
           // If I am classified and he is not -> I beat him
           pts += (rules.teammateBeat ?? 2);
           pts += (rules.teammateBeatDNF ?? 1);
           driverBreakdown[driverId].teammate = (rules.teammateBeat ?? 2) + (rules.teammateBeatDNF ?? 1);
      }

      driverRacePoints[driverId] = pts;
      driverBreakdown[driverId].total = pts;
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
                 
                 // Ensure breakdown init if skipped
                 if (!driverBreakdown[d.id]) driverBreakdown[d.id] = { total: 0, overtakes: 0, teammate: 0, dnf: 0, racePosition: 0, qualiPole: 0, qualiSession: 0 };

                 if (grid) {
                     // They existed in Quali, so they probably started or tried to.
                     // Apply DNF Malus
                     pts += (rules.raceDNF ?? -5);
                     driverBreakdown[d.id].dnf = (rules.raceDNF ?? -5);
                     
                     // Quali points still apply? Yes usually.
                     if (grid === 1) { pts += (rules.qualiPole ?? 3); driverBreakdown[d.id].qualiPole = (rules.qualiPole ?? 3); }
                     if (grid <= 10) { pts += (rules.qualiQ3Reached ?? 3); driverBreakdown[d.id].qualiSession = (rules.qualiQ3Reached ?? 3); }
                     else if (grid <= 15) { pts += (rules.qualiQ2Reached ?? 1); driverBreakdown[d.id].qualiSession = (rules.qualiQ2Reached ?? 1); }
                     else { pts += (rules.qualiQ1Eliminated ?? -3); driverBreakdown[d.id].qualiSession = (rules.qualiQ1Eliminated ?? -3); }
                     
                     driverRacePoints[d.id] = pts;
                 }
                 
                 // Teammate check (Reverse)
                 const mateId = teammates[d.id];
                 if (mateId && driverRacePoints[mateId] !== undefined) {
                     // Teammate finished, I didn't.
                     // I lost.
                     pts += (rules.teammateLost ?? -2);
                     driverBreakdown[d.id].teammate = (rules.teammateLost ?? -2);
                 }
                 
                 if (grid || driverRacePoints[d.id] !== undefined) {
                     driverRacePoints[d.id] = (driverRacePoints[d.id] || 0) + pts;
                     driverBreakdown[d.id].total = driverRacePoints[d.id];
                 }
            }
        }
    }

    // 4. Transactional Update

    // 4. Transactional Update
    combinedResults.driverPoints = driverRacePoints;
    combinedResults.driverBreakdown = driverBreakdown;

    await sql.begin(async (sql) => {
       // A. Update Driver Points
       for (const [driverId, points] of Object.entries(driverRacePoints)) {
         await sql`UPDATE "Driver" SET points = points + ${points} WHERE id = ${driverId}`;
       }

       // B. Snapshot Teams
       const teams = await sql`SELECT id, "userId", "captainId", "reserveId" FROM "Team" WHERE "leagueId" = ${membership[0].leagueId}`;
       
       // Deduplicate: Delete previous results for this race and league
       const teamIds = teams.map(t => t.id);
       if (teamIds.length > 0) {
           // Delete TeamResultDrivers via Join? No, assuming standard delete by raceId for results
           // Wait, we need to find TeamResult IDs to delete TeamResultDriver rows
           // Or assume Cascade Delete on FK?
           // If no cascade, we must delete manually.
           const oldResults = await sql`SELECT id FROM "TeamResult" WHERE "raceId" = ${race.id} AND "teamId" IN ${sql(teamIds)}`;
           if (oldResults.length > 0) {
               const oldResultIds = oldResults.map(r => r.id);
               await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN ${sql(oldResultIds)}`;
               await sql`DELETE FROM "TeamResult" WHERE id IN ${sql(oldResultIds)}`;
           }
       }

       for (const team of teams) {
          // Get Team Drivers
          const teamDrivers = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${team.id}`;
          
          let teamPoints = 0;
          const resultDrivers = [];

           for (const td of teamDrivers) {
              let pts = (driverRacePoints[td.driverId] as number) || 0;
              
              // Apply Captain / Reserve Multipliers
              // Captain: x1.5
              // Reserve: x0.5
              
              // Constructor Multiplier currently removed to match UI expectation and fix 0.8 bug
              
              if (team.captainId === td.driverId) {
                  pts = pts * 2.0;
              } else if (team.reserveId === td.driverId) {
                  pts = pts * 0.5;
              }

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
          // Strategy: Recalculate Total Points from scratch to be safe and allow multiple syncs
          // 1. Get all Race Results for this team
          const allTeamResults = await sql`SELECT points FROM "TeamResult" WHERE "teamId" = ${team.id}`;
          const total = allTeamResults.reduce((acc, r) => acc + (r.points || 0), 0);
          
          await sql`UPDATE "Team" SET "totalPoints" = ${total} WHERE id = ${team.id}`;
       }

       // C. Mark Race Completed and save results
        const finalResults = {
          ...combinedResults,
          driverPoints: driverRacePoints,
          driverRacePoints,
          driverQualiPoints: {},
          dnfDrivers: [],
          driverBreakdown: {}
        };
        // deno-lint-ignore no-explicit-any
        await sql`UPDATE "Race" SET "isCompleted" = true, "results" = ${sql.json(finalResults as any)} WHERE id = ${raceId}`;
    });

    return c.json({ ok: true, classification, points: driverRacePoints });

  } catch (e) {
    return c.json({ error: (e as Error).message, type: "sync_race_error" }, 500);
  }
});

app.post("/admin/fix-schema", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  try {
     // Ensure points columns are NUMERIC/FLOAT to support decimals
     await sql`ALTER TABLE "TeamResultDriver" ALTER COLUMN "points" TYPE DOUBLE PRECISION`;
     await sql`ALTER TABLE "Driver" ALTER COLUMN "points" TYPE DOUBLE PRECISION`;
     await sql`ALTER TABLE "Team" ALTER COLUMN "totalPoints" TYPE DOUBLE PRECISION`;
     await sql`ALTER TABLE "TeamResult" ALTER COLUMN "points" TYPE DOUBLE PRECISION`;
     
     return c.json({ ok: true, message: "Schema updated to DOUBLE PRECISION." });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.post("/admin/migrate-penalties", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "TeamPenalty" (
        id UUID PRIMARY KEY,
        "teamId" UUID NOT NULL REFERENCES "Team"(id),
        "leagueId" UUID NOT NULL,
        points NUMERIC NOT NULL,
        comment TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    return c.json({ ok: true, message: "TeamPenalty table created" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Recalculate race results WITHOUT fetching from OpenF1
// Uses the stored Race.results JSON to re-apply scoring rules
app.post("/admin/recalculate-race", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT "leagueId" FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  const { raceId } = await c.req.json();
  if (!raceId) return c.json({ error: "missing_raceId" }, 400);

  try {
    // 1. Get Race and its stored results
    const [race] = await sql`SELECT * FROM "Race" WHERE id = ${raceId}`;
    if (!race) return c.json({ error: "race_not_found" }, 404);
    if (!race.results) return c.json({ error: "no_results_stored", message: "This race has no stored results. Use Sync first." }, 400);

    const storedResults = race.results;
    
    // Get the driverPoints from stored results
    const driverRacePoints: Record<string, number> = storedResults.driverPoints || {};
    
    if (Object.keys(driverRacePoints).length === 0) {
      return c.json({ error: "no_driver_points", message: "Stored results have no driverPoints. Run Sync first." }, 400);
    }

    // 2. Ensure schema supports decimals
    try {
        await sql`ALTER TABLE "TeamResultDriver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        await sql`ALTER TABLE "TeamResult" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        await sql`ALTER TABLE "Team" ALTER COLUMN "totalPoints" TYPE DOUBLE PRECISION USING "totalPoints"::double precision`;
    } catch (_e) { /* already DOUBLE PRECISION */ }

    // 3. Get league ID from membership
    const theLeagueId = membership[0].leagueId;

    // deno-lint-ignore no-explicit-any
    const debugTeams: any[] = [];

    // 4. Transaction: Re-process team results
    await sql.begin(async (sql) => {
      const teams = await sql`SELECT id, "userId", "captainId", "reserveId" FROM "Team" WHERE "leagueId" = ${theLeagueId}`;
      
      // Delete old results
      const teamIds = teams.map(t => t.id);
      if (teamIds.length > 0) {
        const oldResults = await sql`SELECT id FROM "TeamResult" WHERE "raceId" = ${race.id} AND "teamId" IN ${sql(teamIds)}`;
        if (oldResults.length > 0) {
          const oldResultIds = oldResults.map(r => r.id);
          await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN ${sql(oldResultIds)}`;
          await sql`DELETE FROM "TeamResult" WHERE id IN ${sql(oldResultIds)}`;
        }
      }

      // Re-insert with correct calculations
      for (const team of teams) {
        const teamDrivers = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${team.id}`;
        
        let teamPoints = 0;
        const resultDrivers = [];
        // deno-lint-ignore no-explicit-any
        const debugDrivers: any[] = [];

        for (const td of teamDrivers) {
          const basePoints = Number(driverRacePoints[td.driverId]) || 0;
          let pts = basePoints;
          let role = "normal";
          
          // Apply Captain multiplier (always x2)
          if (team.captainId === td.driverId) {
            pts = pts * 2.0;
            role = "captain";
          } else if (team.reserveId === td.driverId) {
            role = "reserve";
            // Reserve only enters if a main driver (non-captain, non-reserve) had DNF
            let hasMainDNF = false;
            const breakdown = storedResults.driverBreakdown || {};
            
            for (const d of teamDrivers) {
              if (d.driverId !== team.captainId && d.driverId !== team.reserveId) {
                // This is a main driver. Check if they have DNF.
                 if (breakdown[d.driverId] && breakdown[d.driverId].dnf) {
                   hasMainDNF = true;
                   break;
                 }
              }
            }

            if (hasMainDNF) {
              pts = pts * 0.5;
            } else {
              pts = 0; // Reserve doesn't enter formation
            }
          }

          teamPoints += pts;
          resultDrivers.push({ driverId: td.driverId, points: pts });
          debugDrivers.push({ driverId: td.driverId, basePoints, role, finalPoints: pts, entered: role !== "reserve" || pts !== 0 });
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

        // Recalculate total
        const allTeamResults = await sql`SELECT points FROM "TeamResult" WHERE "teamId" = ${team.id}`;
        const total = allTeamResults.reduce((acc, r) => acc + Number(r.points || 0), 0);
        await sql`UPDATE "Team" SET "totalPoints" = ${total} WHERE id = ${team.id}`;
        
        debugTeams.push({ teamId: team.id, userId: team.userId, captainId: team.captainId, reserveId: team.reserveId, teamPoints, newTotal: total, drivers: debugDrivers });
      }
    });

    return c.json({ ok: true, message: "Race results recalculated from stored data", driverPoints: driverRacePoints, debugTeams });

  } catch (e) {
    return c.json({ error: (e as Error).message, type: "recalculate_error" }, 500);
  }
});

// 2026 Simulator Endpoint
app.post("/admin/simulate-race", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  // Temporarily disabled for testing so non-admins can simulate
  // if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  const { raceId } = await c.req.json();
  if (!raceId) return c.json({ error: "missing_raceId" }, 400);

  try {
    // 1. Get Race Info
    const [race] = await sql`SELECT * FROM "Race" WHERE id = ${raceId}`;
    if (!race) return c.json({ error: "race_not_found" }, 404);

    // 2. Generate Mock Data for 22 Drivers
    // Fetch all currently active drivers from DB
    const allDrivers = await sql`SELECT id, name, "constructorId" FROM "Driver"`;
    if (allDrivers.length === 0) return c.json({ error: "no_drivers_found" }, 400);

    // Shuffle array function
    const shuffle = <T>(array: T[]) => {
      let currentIndex = array.length, randomIndex;
      while (currentIndex > 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
      }
      return array;
    };

    // Generate random classifications (1 to N)
    const generateClassification = (drivers: { id: string }[]) => {
      const shuffled = shuffle([...drivers]);
      const classif: Record<string, number> = {};
      shuffled.forEach((d, index) => {
        classif[d.id] = index + 1;
      });
      return classif;
    };

    const combinedResults: Record<string, unknown> = {};
    
    // Quali (Random grid)
    const gridPositions = generateClassification(allDrivers as unknown as { id: string }[]);
    combinedResults.quali = gridPositions;

    // Race (Random finish)
    const classification = generateClassification(allDrivers as unknown as { id: string }[]);
    combinedResults[race.isSprint ? "sprint" : "race"] = classification;
    
    // If sprint, we might want to also generate a race result or vice versa depending on frontend logic. 
    // The existing sync-race only saves the 'sessionType' mapped to the race date, meaning if it's a sprint weekend, 
    // it fetches Sprint or Race depending on which one was triggered? Actually sync-race fetches BOTH.
    // Let's generate both if it's a sprint weekend.
    if (race.isSprint) {
        // Also generate main race classification just to be sure we have data
        combinedResults.race = generateClassification(allDrivers as unknown as { id: string }[]);
    }

    // 3. Process League
    // 3a. AUTO-FIX SCHEMA: Ensure points are decimals
    try {
        await sql`ALTER TABLE "TeamResultDriver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        await sql`ALTER TABLE "Driver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
        await sql`ALTER TABLE "Team" ALTER COLUMN "totalPoints" TYPE DOUBLE PRECISION USING "totalPoints"::double precision`;
        await sql`ALTER TABLE "TeamResult" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
    } catch (_e) { /* ignore */ }
    
    // Fetch League Rules
    const [leagueData] = await sql<{ rules: ScoringRules }[]>`SELECT rules FROM "League" WHERE id = ${membership[0].leagueId}`;
    const rules = (leagueData?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;

    // Teammate Map
    const teammates: Record<string, string> = {};
    const driversByConstructor: Record<string, string[]> = {};
    for (const d of allDrivers) {
        if (!driversByConstructor[d.constructorId]) driversByConstructor[d.constructorId] = [];
        driversByConstructor[d.constructorId].push(d.id);
    }
    for (const list of Object.values(driversByConstructor)) {
        if (list.length === 2) {
            teammates[list[0]] = list[1];
            teammates[list[1]] = list[0];
        }
    }

    // 4. Calculate Points (Simulated)
    const driverRacePoints: Record<string, number> = {};
    const driverBreakdown: Record<string, Record<string, number>> = {};
    
    // Per-Driver Calculation
    for (const d of allDrivers) {
      const driverId = d.id;
      let pts = 0;
      
      driverBreakdown[driverId] = {
           racePosition: 0,
           overtakes: 0,
           teammate: 0,
           dnf: 0,
           qualiPole: 0,
           qualiSession: 0,
           total: 0
       };

      // A. Race Position
      if (classification[driverId]) {
          const position = classification[driverId];
          const racePoints = rules.racePositionPoints || DEFAULT_RACE_POINTS;
          if (position <= racePoints.length) {
              const posPts = racePoints[position - 1];
              pts += posPts; 
              driverBreakdown[driverId].racePosition = posPts;
          }
      }

      // Last Place Malus
      const maxPos = Math.max(...Object.values(classification));
      if (classification[driverId] === maxPos && maxPos > 10) { 
          const malus = (rules.raceLastPlaceMalus ?? -3);
          pts += malus;
          driverBreakdown[driverId].racePosition += malus;
      }

      // C. Grid & Qualifying Bonuses
      if (gridPositions[driverId]) {
          const grid = gridPositions[driverId];
          const position = classification[driverId];
          
          if (!race.isSprint) {
              if (grid === 1) { pts += (rules.qualiPole ?? 3); driverBreakdown[driverId].qualiPole = (rules.qualiPole ?? 3); }
              if (grid <= 10) { pts += (rules.qualiQ3Reached ?? 3); driverBreakdown[driverId].qualiSession = (rules.qualiQ3Reached ?? 3); }
              else if (grid <= 15) { pts += (rules.qualiQ2Reached ?? 1); driverBreakdown[driverId].qualiSession = (rules.qualiQ2Reached ?? 1); }
              else { pts += (rules.qualiQ1Eliminated ?? -3); driverBreakdown[driverId].qualiSession = (rules.qualiQ1Eliminated ?? -3); }
          } else {
              if (grid === 1) { pts += (rules.sprintPole ?? 1); driverBreakdown[driverId].qualiPole = (rules.sprintPole ?? 1); }
          }

          if (position) {
              const diff = grid - position;
              let movePts = 0;
              if (diff > 0) {
                  for (let p = grid - 1; p >= position; p--) {
                      if (p <= 10) movePts += (rules.positionGainedPos1_10 ?? 1.0);
                      else movePts += (rules.positionGainedPos11_Plus ?? 0.5);
                  }
              } else if (diff < 0) {
                  for (let p = grid + 1; p <= position; p++) {
                      if (p <= 10) movePts += (rules.positionLostPos1_10 ?? -1.0);
                      else movePts += (rules.positionLostPos11_Plus ?? -0.5);
                  }
              }
              pts += movePts;
              driverBreakdown[driverId].overtakes = movePts;
          }
      }

      // D. Sprint Points
      const sprintRes = combinedResults.sprint as Record<string, number> | undefined;
      if (race.isSprint && sprintRes && sprintRes[driverId]) {
          const sprintPos = sprintRes[driverId];
          const sprintPoints = rules.sprintPositionPoints || DEFAULT_SPRINT_POINTS;
          if (sprintPos <= sprintPoints.length) {
              const sPts = sprintPoints[sprintPos - 1];
              pts += sPts;
              driverBreakdown[driverId].sprintPosition = sPts;
          }
      }

      // E. Teammate beat/lost
      const tmId = teammates[driverId];
      if (tmId && classification[driverId] && classification[tmId]) {
          const myPos = classification[driverId];
          const tmPos = classification[tmId];
          if (myPos < tmPos) {
              pts += (rules.teammateBeat ?? 2);
              driverBreakdown[driverId].teammate = (rules.teammateBeat ?? 2);
          } else if (myPos > tmPos) {
              pts += (rules.teammateLost ?? -2);
              driverBreakdown[driverId].teammate = (rules.teammateLost ?? -2);
          }
      }

      driverBreakdown[driverId].total = pts;
      driverRacePoints[driverId] = pts; // This is the total for the handler's current logic, but let's split if we can

      // For the first handler, it's already calculating everything in 'pts'.
      // We should probably populate driverQualiPoints etc. if we want the modal to show them separately.
      // But notice the first handler doesn't have gridPositions easily accessible for splitting simple points.
      // Let's at least ensure driverBreakdown is populated.
    }

    // 5. Update All Teams
    const teamsToUpdate = await sql`SELECT * FROM "Team"`;
    for (const team of teamsToUpdate) {
        let teamWeekendPoints = 0;
        const driverIds = team.driverIds || [];

        const oldTeamResult = await sql`SELECT id FROM "TeamResult" WHERE "teamId" = ${team.id} AND "raceId" = ${race.id}`;
        let teamResultId;
        
        if (oldTeamResult.length === 0) {
            const inserted = await sql`
                INSERT INTO "TeamResult" ("id", "teamId", "raceId", "points", "captainId", "reserveId", "createdAt")
                VALUES (${crypto.randomUUID()}, ${team.id}, ${race.id}, 0, ${team.captainId}, ${team.reserveId}, ${new Date().toISOString()})
                RETURNING id
            `;
            teamResultId = inserted[0].id;
        } else {
            teamResultId = oldTeamResult[0].id;
            await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" = ${teamResultId}`;
        }

        for (const drvId of driverIds) {
            const rawPts = driverRacePoints[drvId] || 0;
            let finalPts = rawPts;

            const drvData = allDrivers.find(d => d.id === drvId);
            const drvConstructorId = drvData ? drvData.constructorId : null;
            
            if (rawPts > 0 && rules.constructors && drvConstructorId) {
                const constrRule = (rules.constructors as ConstructorRule[]).find((c) => c.id === drvConstructorId);
                if (constrRule) {
                    finalPts = finalPts * constrRule.multiplier; 
                }
            }

            if (drvId === team.captainId) {
                finalPts = finalPts * 2.0;
            } else if (drvId !== team.reserveId) {
                teamWeekendPoints += finalPts;
            }

            if (isNaN(finalPts)) finalPts = 0;

            await sql`
                INSERT INTO "TeamResultDriver" ("id", "teamResultId", "driverId", "points")
                VALUES (${crypto.randomUUID()}, ${teamResultId}, ${drvId}, ${finalPts})
            `;
        }

        if (isNaN(teamWeekendPoints)) teamWeekendPoints = 0;
        await sql`UPDATE "TeamResult" SET points = ${teamWeekendPoints} WHERE id = ${teamResultId}`;
    }

    // 6. Bulk Recalculate and Update Race
    // For simpler simulation in /admin, we'll keep driverRacePoints as the source of truth for POSSIBLY all pts
    const finalResults = {
        ...combinedResults,
        driverPoints: driverRacePoints,
        driverRacePoints: driverRacePoints, // Ideally this would just be race pts
        driverQualiPoints: {}, 
        driverBreakdown
    };

    // deno-lint-ignore no-explicit-any
    const resultsJson = sql.json(finalResults as any);
    const updatedRace = await sql`
        UPDATE "Race" 
        SET "isCompleted" = true, results = ${resultsJson} 
        WHERE id = ${race.id}
        RETURNING *
    `;

    await sql.begin(async (sql) => {
        const completedRaces = await sql`SELECT results FROM "Race" WHERE "isCompleted" = true`;
        const globalDriverPoints: Record<string, number> = {};
        for (const r of completedRaces) {
            const rp = r.results?.driverRacePoints || {};
            for (const [dId, p] of Object.entries(rp)) {
                globalDriverPoints[dId] = (globalDriverPoints[dId] || 0) + (p as number);
            }
        }
        for (const [dId, p] of Object.entries(globalDriverPoints)) {
            await sql`UPDATE "Driver" SET points = ${p} WHERE id = ${dId}`;
        }

        const teamsRecalc = await sql`SELECT id FROM "Team"`;
        for (const t of teamsRecalc) {
            const trs = await sql`SELECT SUM(points) as total FROM "TeamResult" WHERE "teamId" = ${t.id}`;
            await sql`UPDATE "Team" SET "totalPoints" = ${trs[0].total || 0} WHERE id = ${t.id}`;
        }
    });

    return c.json({ ok: true, race: updatedRace[0], driverRacePoints, driverBreakdown, simulatedGrid: gridPositions, simulatedClassification: classification });

  } catch (error) {
    console.error("Simulation error:", (error as Error).message);
    return c.json({ error: "simulation_failed", details: (error as Error).message }, 500);
  }
});

// Temporary endpoint to instantly simulate China GP via browser/curl
app.get("/simulate-china-test", async (c) => {
  try {
    const chinaRace = await sql`SELECT id FROM "Race" WHERE name ILIKE '%China%' or name ILIKE '%Cina%' LIMIT 1`;
    if (chinaRace.length === 0) return c.json({ error: "China GP not found" }, 404);
    
    // Call the exact same logic but without HTTP req block
    const allDrivers = await sql`SELECT id, name, "constructorId" FROM "Driver"`;
    if (allDrivers.length === 0) return c.json({ error: "no_drivers_found" }, 400);

    const shuffle = <T>(array: T[]) => {
      let currentIndex = array.length, randomIndex;
      while (currentIndex > 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
      }
      return array;
    };

    const generateClassification = (drivers: { id: string }[]) => {
      const shuffled = shuffle([...drivers]);
      const classif: Record<string, number> = {};
      shuffled.forEach((d, index) => { classif[d.id] = index + 1; });
      return classif;
    };

    const combinedResults: CombinedResults = {};
    const gridPositions = generateClassification(allDrivers as unknown as { id: string }[]);
    combinedResults.quali = gridPositions;
    const classification = generateClassification(allDrivers as unknown as { id: string }[]);
    combinedResults.race = classification;
    combinedResults.sprint = generateClassification(allDrivers as unknown as { id: string }[]); 
    combinedResults.sprintQuali = generateClassification(allDrivers as unknown as { id: string }[]);
    
    // Add mock data for new rules
    combinedResults.fastestLap = allDrivers[0].id; // First driver gets FL
    combinedResults.dnfDrivers = [allDrivers[allDrivers.length - 1].id]; // Last driver DNF
    combinedResults.gridPenalties = {};

    // Fetch first league to use its rules
    const [leagueData] = await sql`SELECT rules FROM "League" LIMIT 1`;
    const rules = (leagueData?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;

    const teammates: Record<string, string> = {};
    const driversByConstructor: Record<string, string[]> = {};
    for (const d of allDrivers) {
        if (!driversByConstructor[d.constructorId]) driversByConstructor[d.constructorId] = [];
        driversByConstructor[d.constructorId].push(d.id);
    }
    for (const list of Object.values(driversByConstructor)) {
        if (list.length === 2) {
            teammates[list[0]] = list[1];
            teammates[list[1]] = list[0];
        }
    }

    const { 
        driverPoints, 
        driverRacePoints, 
        driverQualiPoints, 
        driverSprintPoints, 
        driverSprintQualiPoints,
        driverBreakdown 
    } = calculateWeekendPoints(combinedResults, rules, teammates, allDrivers as unknown as Driver[]);

    const teamsToUpdate = await sql`SELECT * FROM "Team"`;
    for (const team of teamsToUpdate) {
        let teamWeekendPoints = 0;
        
        const tdRes = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${team.id}`;
        const driverIds = tdRes.map(t => t.driverId);
        
        const oldTeamResult = await sql`SELECT id FROM "TeamResult" WHERE "teamId" = ${team.id} AND "raceId" = ${chinaRace[0].id}`;
        let teamResultId;
        if (oldTeamResult.length === 0) {
            const inserted = await sql`
                INSERT INTO "TeamResult" ("id", "teamId", "raceId", "points", "captainId", "reserveId", "createdAt")
                VALUES (${crypto.randomUUID()}, ${team.id}, ${chinaRace[0].id}, 0, ${team.captainId}, ${team.reserveId}, ${new Date().toISOString()})
                RETURNING id
            `;
            teamResultId = inserted[0].id;
        } else {
            teamResultId = oldTeamResult[0].id;
            await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" = ${teamResultId}`;
        }

        for (const drvId of driverIds) {
            const rawPts = driverPoints[drvId] || 0;
            let finalPts = rawPts;

            if (drvId === team.captainId) {
                finalPts = finalPts * 2.0;
            } else if (drvId === team.reserveId) {
                finalPts = 0;
            }

            teamWeekendPoints += finalPts;

            await sql`
                INSERT INTO "TeamResultDriver" ("id", "teamResultId", "driverId", "points")
                VALUES (${crypto.randomUUID()}, ${teamResultId}, ${drvId}, ${finalPts})
            `;
        }

        await sql`UPDATE "TeamResult" SET points = ${teamWeekendPoints} WHERE id = ${teamResultId}`;
    }

    const finalResults = {
        ...combinedResults,
        driverPoints: driverPoints,
        driverRacePoints: driverRacePoints,
        driverQualiPoints: driverQualiPoints,
        driverSprintPoints: driverSprintPoints,
        driverSprintQualiPoints: driverSprintQualiPoints,
        driverBreakdown
    };

    // deno-lint-ignore no-explicit-any
    const resultsJson = sql.json(finalResults as any);
    const updatedRace = await sql`
        UPDATE "Race" 
        SET "isCompleted" = true, results = ${resultsJson} 
        WHERE id = ${chinaRace[0].id}
        RETURNING *
    `;

    // Global Recalculation
    const completedRaces = await sql`SELECT results FROM "Race" WHERE "isCompleted" = true`;
    const globalDriverPoints: Record<string, number> = {};
    for (const r of completedRaces) {
        const dp = r.results?.driverPoints || {};
        for (const [dId, p] of Object.entries(dp)) {
            globalDriverPoints[dId] = (globalDriverPoints[dId] || 0) + (p as number);
        }
    }
    for (const [dId, p] of Object.entries(globalDriverPoints)) {
        await sql`UPDATE "Driver" SET points = ${p} WHERE id = ${dId}`;
    }

    const teamsRecalc = await sql`SELECT id FROM "Team"`;
    for (const t of teamsRecalc) {
        const trs = await sql`SELECT SUM(points) as total FROM "TeamResult" WHERE "teamId" = ${t.id}`;
        await sql`UPDATE "Team" SET "totalPoints" = ${trs[0].total || 0} WHERE id = ${t.id}`;
    }

    return c.json({ ok: true, race: updatedRace[0] });
  } catch (error) {
    console.error("Simulation error:", (error as Error).message);
    return c.json({ error: "simulation_failed", details: (error as Error).message }, 500);
  }
});

serve(app.fetch);
