import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Hono } from "https://deno.land/x/hono@v3.1.8/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.1.8/middleware.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const app = new Hono().basePath("/fanta-api");

// DB Connection
const databaseUrl = Deno.env.get("DATABASE_URL")!;
const sql = postgres(databaseUrl, { ssl: "require" });

// Helper for tokens
function makeToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

// Middleware: Auth
const requireUser = async (c: any, next: any) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "missing_token" }, 401);
  }
  const token = authHeader.slice(7);
  
  const [user] = await sql`SELECT id, "authToken" FROM "User" WHERE "authToken" = ${token}`;
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

app.post("/auth/anon", async (c) => {
  try {
    const token = makeToken();
    const [user] = await sql`
      INSERT INTO "User" ("authToken") 
      VALUES (${token}) 
      RETURNING id, "authToken"
    `;
    return c.json(user);
  } catch (e: any) {
    return c.json({ error: e.message, type: "auth_anon_error" }, 500);
  }
});

app.get("/me", requireUser, async (c) => {
  const user = c.get("user");
  
  // Get memberships
  const memberships = await sql`
    SELECT lm.role, l.id, l.name, l."joinCode",
           t.id as team_id, t.budget, t."captainId", t."reserveId"
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
    
    return {
      id: m.id,
      name: m.name,
      joinCode: m.joinCode,
      role: m.role,
      isAdmin: m.role === "ADMIN",
      team: m.team_id ? {
        id: m.team_id,
        budget: Number(m.budget),
        captainId: m.captainId,
        reserveId: m.reserveId,
        driverIds: drivers.map(d => d.driverId)
      } : null
    };
  }));

  return c.json({
    user: { id: user.id },
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
  const user = c.get("user");
  const { name } = await c.req.json();
  const leagueName = (name?.trim() || "League").slice(0, 64);
  const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  const [league] = await sql.begin(async (sql) => {
    const [l] = await sql`
      INSERT INTO "League" (name, "joinCode") 
      VALUES (${leagueName}, ${joinCode}) 
      RETURNING id, name, "joinCode"
    `;
    
    await sql`
      INSERT INTO "LeagueMember" ("userId", "leagueId", role)
      VALUES (${user.id}, ${l.id}, 'ADMIN')
    `;
    
    await sql`
      INSERT INTO "Team" ("userId", "leagueId", budget)
      VALUES (${user.id}, ${l.id}, 100.0)
    `;
    
    return [l];
  });

  return c.json(league);
});

app.post("/leagues/join", requireUser, async (c) => {
  const user = c.get("user");
  const { joinCode } = await c.req.json();
  const code = (joinCode || "").trim().toUpperCase();

  const [league] = await sql`SELECT id, name, "joinCode" FROM "League" WHERE "joinCode" = ${code}`;
  if (!league) return c.json({ error: "league_not_found" }, 404);

  await sql.begin(async (sql) => {
    await sql`
      INSERT INTO "LeagueMember" ("userId", "leagueId", role)
      VALUES (${user.id}, ${league.id}, 'MEMBER')
      ON CONFLICT ("userId", "leagueId") DO NOTHING
    `;
    
    await sql`
      INSERT INTO "Team" ("userId", "leagueId", budget)
      VALUES (${user.id}, ${league.id}, 100.0)
      ON CONFLICT ("userId", "leagueId") DO NOTHING
    `;
  });

  return c.json({ leagueId: league.id, name: league.name, joinCode: league.joinCode });
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
      await sql`INSERT INTO "TeamDriver" ("teamId", "driverId") VALUES (${team.id}, ${driverIdIn})`;
    }
    await sql`UPDATE "Team" SET budget = ${newBudget} WHERE id = ${team.id}`;
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

  await sql`
    UPDATE "Team" 
    SET "captainId" = ${captainId ?? null}, "reserveId" = ${reserveId ?? null}
    WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id}
  `;

  return c.json({ ok: true });
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

serve(app.fetch);
