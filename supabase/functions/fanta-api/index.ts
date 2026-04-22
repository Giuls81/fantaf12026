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
  dnsDrivers?: string[];
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
const LOCK_OFFSET_MS = 5 * 60 * 1000;
const parsedAutoCloseHours = Number(Deno.env.get("RACE_AUTO_CLOSE_HOURS") || "72");
const AUTO_CLOSE_HOURS = Number.isFinite(parsedAutoCloseHours) && parsedAutoCloseHours > 0 ? parsedAutoCloseHours : 72;
const AUTO_CLOSE_MS = AUTO_CLOSE_HOURS * 60 * 60 * 1000;

interface RaceRow {
  id: string;
  name: string;
  country?: string | null;
  city?: string | null;
  season?: number | null;
  round: number;
  isSprint: boolean;
  qualifyingUtc: string | Date | null;
  sprintQualifyingUtc: string | Date | null;
  date: string | Date | null;
  isCompleted: boolean;
  results?: CombinedResults | null;
}

const parseDateSafe = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getRaceSessionUtc = (race: RaceRow): Date | null => {
  const primary = race.isSprint ? race.sprintQualifyingUtc : race.qualifyingUtc;
  return parseDateSafe(primary) || parseDateSafe(race.qualifyingUtc) || parseDateSafe(race.date);
};

const getRaceLockDate = (race: RaceRow): Date | null => {
  const session = getRaceSessionUtc(race);
  if (!session) return null;
  return new Date(session.getTime() - LOCK_OFFSET_MS);
};

const isRaceStale = (race: RaceRow, now = new Date()): boolean => {
  if (race.isCompleted) return false;
  const session = getRaceSessionUtc(race);
  if (!session) return false;
  const autoCloseAt = session.getTime() + AUTO_CLOSE_MS;
  return now.getTime() > autoCloseAt;
};

const pickActiveRace = (races: RaceRow[], now = new Date()): RaceRow | null => {
  if (races.length === 0) return null;
  const nonCompleted = races.filter((race) => !race.isCompleted);
  if (nonCompleted.length === 0) return races[races.length - 1];
  return nonCompleted.find((race) => !isRaceStale(race, now)) || nonCompleted[nonCompleted.length - 1];
};

const loadRacesOrdered = async (): Promise<RaceRow[]> => {
  return sql<RaceRow[]>`
    SELECT id, name, country, city, season, round, "isSprint", "qualifyingUtc", "sprintQualifyingUtc", date, "isCompleted", results
    FROM "Race"
    ORDER BY round ASC
  `;
};

const autocloseStaleRaces = async (): Promise<RaceRow[]> => {
  await maybeSyncRaceCalendarFromOpenF1();
  const races = await loadRacesOrdered();
  const staleIds = races.filter((race) => isRaceStale(race)).map((race) => race.id);
  if (staleIds.length === 0) return races;

  await sql`
    UPDATE "Race"
    SET "isCompleted" = true
    WHERE id IN ${sql(staleIds)} AND "isCompleted" = false
  `;
  return loadRacesOrdered();
};

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

type SqlExecutor = (template: TemplateStringsArray, ...params: unknown[]) => Promise<Array<Record<string, unknown>>>;

const ensureTeamPenaltyTable = async (db: SqlExecutor): Promise<boolean> => {
  try {
    await db`
      CREATE TABLE IF NOT EXISTS "TeamPenalty" (
        id TEXT PRIMARY KEY,
        "teamId" TEXT NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
        "leagueId" TEXT NOT NULL REFERENCES "League"(id) ON DELETE CASCADE,
        points NUMERIC NOT NULL,
        comment TEXT,
        "createdAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `;
    return true;
  } catch (e) {
    console.error("TeamPenalty table unavailable:", e);
    return false;
  }
};

// --- Cosmetics (Phase 4a, added 2026-04-17) -----------------------------
//
// Catalog is the single server-side source of truth for product IDs,
// category, and bundle/pass expansion. Mirrors Appendix A.1 of the takeover
// plan. Keep in sync with:
//   - RevenueCat dashboard product entries
//   - web/constants_iap.ts when the web storefront is added
//
// Categories 'bundle' and 'pass' are never written to UserCosmetic.category;
// they expand into one row per contained item at grant time.

type CosmeticCategory = "emblem" | "helmet" | "suit" | "color" | "livery" | "bundle" | "pass";

interface CosmeticCatalogEntry {
  category: CosmeticCategory;
  contains?: string[]; // only set for bundle/pass
}

const COSMETIC_EMBLEMS = [
  "fantaf1.cosmetic.emblem.lightning",
  "fantaf1.cosmetic.emblem.mountain",
  "fantaf1.cosmetic.emblem.wave",
  "fantaf1.cosmetic.emblem.compass",
  "fantaf1.cosmetic.emblem.flame",
  "fantaf1.cosmetic.emblem.wolf",
  "fantaf1.cosmetic.emblem.checkered",
  "fantaf1.cosmetic.emblem.octane",
];

const COSMETIC_HELMETS = [
  "fantaf1.cosmetic.helmet.carbon",
  "fantaf1.cosmetic.helmet.storm",
  "fantaf1.cosmetic.helmet.gold",
  "fantaf1.cosmetic.helmet.chrome",
  "fantaf1.cosmetic.helmet.midnight",
  "fantaf1.cosmetic.helmet.rainbow",
  "fantaf1.cosmetic.helmet.fire",
  "fantaf1.cosmetic.helmet.ocean",
  "fantaf1.cosmetic.helmet.forest",
  "fantaf1.cosmetic.helmet.volcano",
];

const COSMETIC_SUITS = [
  "fantaf1.cosmetic.suit.monochrome",
  "fantaf1.cosmetic.suit.retro70",
  "fantaf1.cosmetic.suit.mosaic",
  "fantaf1.cosmetic.suit.sunrise",
  "fantaf1.cosmetic.suit.digicamo",
  "fantaf1.cosmetic.suit.tuxedo",
];

const COSMETIC_COLORS = [
  "fantaf1.cosmetic.color.electric",
  "fantaf1.cosmetic.color.emerald",
  "fantaf1.cosmetic.color.royal",
  "fantaf1.cosmetic.color.molten",
  "fantaf1.cosmetic.color.rosegold",
  "fantaf1.cosmetic.color.pure",
];

const COSMETIC_LIVERIES = [
  "fantaf1.cosmetic.livery.classic",
  "fantaf1.cosmetic.livery.stealth",
  "fantaf1.cosmetic.livery.racing",
  "fantaf1.cosmetic.livery.rainbow",
  "fantaf1.cosmetic.livery.carbon",
  "fantaf1.cosmetic.livery.neon",
];

const COSMETIC_CATALOG: Record<string, CosmeticCatalogEntry> = {
  // Individual items
  ...Object.fromEntries(COSMETIC_EMBLEMS.map((id) => [id, { category: "emblem" as const }])),
  ...Object.fromEntries(COSMETIC_HELMETS.map((id) => [id, { category: "helmet" as const }])),
  ...Object.fromEntries(COSMETIC_SUITS.map((id) => [id, { category: "suit" as const }])),
  ...Object.fromEntries(COSMETIC_COLORS.map((id) => [id, { category: "color" as const }])),
  ...Object.fromEntries(COSMETIC_LIVERIES.map((id) => [id, { category: "livery" as const }])),
  // Bundle: subset of items
  "fantaf1.cosmetic.bundle.starter": {
    category: "bundle",
    contains: [
      "fantaf1.cosmetic.emblem.lightning",
      "fantaf1.cosmetic.emblem.flame",
      "fantaf1.cosmetic.emblem.wave",
      "fantaf1.cosmetic.emblem.compass",
      "fantaf1.cosmetic.helmet.carbon",
      "fantaf1.cosmetic.helmet.storm",
      "fantaf1.cosmetic.helmet.gold",
      "fantaf1.cosmetic.helmet.ocean",
      "fantaf1.cosmetic.color.electric",
      "fantaf1.cosmetic.color.emerald",
    ],
  },
  // Season Pass: everything above (helmets+emblems+suits+colors). Drops released
  // later require a separate admin endpoint to backfill pass holders.
  "fantaf1.cosmetic.pass.season2026": {
    category: "pass",
    contains: [
      ...COSMETIC_EMBLEMS,
      ...COSMETIC_HELMETS,
      ...COSMETIC_SUITS,
      ...COSMETIC_COLORS,
      ...COSMETIC_LIVERIES,
    ],
  },
};

const isEquipCategory = (
  cat: string,
): cat is "emblem" | "helmet" | "suit" | "color" | "livery" =>
  cat === "emblem" || cat === "helmet" || cat === "suit" || cat === "color" || cat === "livery";

// Expand a purchased product ID into the concrete list of equippable product
// IDs it grants. Bundles/passes expand recursively (one level deep suffices
// given current catalog shape).
const expandCosmeticProduct = (productId: string): string[] => {
  const entry = COSMETIC_CATALOG[productId];
  if (!entry) return [];
  if (isEquipCategory(entry.category)) return [productId];
  return (entry.contains ?? []).flatMap((c) => expandCosmeticProduct(c));
};

const ensureUserCosmeticTable = async (db: SqlExecutor): Promise<boolean> => {
  try {
    await db`
      CREATE TABLE IF NOT EXISTS "UserCosmetic" (
        "id"          TEXT PRIMARY KEY,
        "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "productId"   TEXT NOT NULL,
        "category"    TEXT NOT NULL CHECK ("category" IN ('emblem','helmet','suit','color','livery')),
        "purchasedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
    `;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS "UserCosmetic_user_product_idx" ON "UserCosmetic"("userId","productId");`;
    await db`CREATE INDEX IF NOT EXISTS "UserCosmetic_user_idx" ON "UserCosmetic"("userId");`;
    return true;
  } catch (e) {
    console.error("UserCosmetic table unavailable:", e);
    return false;
  }
};

const ensureTeamCosmeticColumns = async (db: SqlExecutor): Promise<boolean> => {
  try {
    await db`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "emblemProductId" TEXT;`;
    await db`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "helmetProductId" TEXT;`;
    await db`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "suitProductId" TEXT;`;
    await db`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "colorProductId" TEXT;`;
    await db`ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "liveryProductId" TEXT;`;
    return true;
  } catch (e) {
    console.error("Team cosmetic columns unavailable:", e);
    return false;
  }
};

const ensureWebhookEventTable = async (db: SqlExecutor): Promise<boolean> => {
  try {
    await db`
      CREATE TABLE IF NOT EXISTS "WebhookEvent" (
        "id"         TEXT PRIMARY KEY,
        "source"     TEXT NOT NULL,
        "receivedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      );
    `;
    return true;
  } catch (e) {
    console.error("WebhookEvent table unavailable:", e);
    return false;
  }
};

const syncTeamTotalPoints = async (db: SqlExecutor, teamId: string, includePenalties = true) => {
  const rows = includePenalties
    ? await db`
      SELECT
        COALESCE((SELECT SUM(points) FROM "TeamResult" WHERE "teamId" = ${teamId}), 0)
        + COALESCE((SELECT SUM(points) FROM "TeamPenalty" WHERE "teamId" = ${teamId}), 0) AS total
    `
    : await db`
      SELECT
        COALESCE((SELECT SUM(points) FROM "TeamResult" WHERE "teamId" = ${teamId}), 0) AS total
    `;
  const total = Number((rows[0] as { total?: number | string | null } | undefined)?.total ?? 0);
  await db`UPDATE "Team" SET "totalPoints" = ${total} WHERE id = ${teamId}`;
};

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
        message: "Questo nome Ã¨ giÃ  in uso (anche con diversa combinazione di maiuscole/minuscole). Scegline un altro o fai il Login." 
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

app.post("/auth/login", async (c) => {
  try {
    const { name, password } = await c.req.json();
    if (!name || !password) return c.json({ error: "missing_credentials" }, 400);

    const [user] = await sql`SELECT id, "authToken", "password", "displayName" FROM "User" WHERE "displayName" = ${name}`;
    
    if (!user) {
      return c.json({ error: "invalid_credentials", message: "Utente non trovato." }, 404);
    }

    if (!user.password) {
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
      rules: m.rules || DEFAULT_SCORING_RULES, 
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
  const races = await autocloseStaleRaces();
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

  // Check lock against the active race. Old stale races auto-close.
  const races = await autocloseStaleRaces();
  const activeRace = pickActiveRace(races);

  if (activeRace) {
    const lockDate = getRaceLockDate(activeRace);
    if (lockDate && new Date() > lockDate) return c.json({ error: "market_locked" }, 403);
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

  const races = await autocloseStaleRaces();
  const activeRace = pickActiveRace(races);

  if (activeRace) {
    const lockDate = getRaceLockDate(activeRace);
    if (lockDate && new Date() > lockDate) return c.json({ error: "lineup_locked" }, 403);
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
  let standings: Array<Record<string, unknown>> = [];
  try {
    standings = await sql`
      SELECT
        t."userId",
        t.id AS "teamId",
        t.name AS "teamName",
        t."emblemProductId",
        t."helmetProductId",
        t."suitProductId",
        t."colorProductId",
        t."liveryProductId",
        u."displayName" AS "userName",
        (COALESCE(tr."basePoints", 0) + COALESCE(tp."penaltyPoints", 0))::double precision AS "totalPoints",
        COALESCE(tp."penaltyPoints", 0)::double precision AS "penaltyPoints"
      FROM "Team" t
      JOIN "User" u ON t."userId" = u.id
      LEFT JOIN (
        SELECT "teamId", SUM(points)::double precision AS "basePoints"
        FROM "TeamResult"
        GROUP BY "teamId"
      ) tr ON tr."teamId" = t.id
      LEFT JOIN (
        SELECT "teamId", SUM(points)::double precision AS "penaltyPoints"
        FROM "TeamPenalty"
        GROUP BY "teamId"
      ) tp ON tp."teamId" = t.id
      WHERE t."leagueId" = ${leagueId}
      ORDER BY "totalPoints" DESC
    `;
  } catch (_e) {
    // Fallback: older DBs without cosmetic columns or TeamResult/TeamPenalty missing
    try {
      standings = await sql`
        SELECT
          t."userId",
          t.id AS "teamId",
          t.name AS "teamName",
          t."emblemProductId",
          t."helmetProductId",
          t."suitProductId",
          t."colorProductId",
          t."liveryProductId",
          u."displayName" as "userName",
          t."totalPoints",
          0::double precision AS "penaltyPoints"
        FROM "Team" t
        JOIN "User" u ON t."userId" = u.id
        WHERE t."leagueId" = ${leagueId}
        ORDER BY t."totalPoints" DESC
      `;
    } catch (_e2) {
      standings = await sql`
        SELECT
          t."userId",
          t.id AS "teamId",
          t.name AS "teamName",
          u."displayName" as "userName",
          t."totalPoints",
          0::double precision AS "penaltyPoints"
        FROM "Team" t
        JOIN "User" u ON t."userId" = u.id
        WHERE t."leagueId" = ${leagueId}
        ORDER BY t."totalPoints" DESC
      `;
    }
  }

  return c.json(standings.map((s, idx) => {
    const row = s as {
      userId?: string;
      teamId?: string | null;
      teamName?: string | null;
      emblemProductId?: string | null;
      helmetProductId?: string | null;
      suitProductId?: string | null;
      colorProductId?: string | null;
      liveryProductId?: string | null;
      userName?: string | null;
      totalPoints?: number | string | null;
      penaltyPoints?: number | string | null;
    };
    return {
      ...row,
      totalPoints: Number(row.totalPoints ?? 0),
      penaltyPoints: Number(row.penaltyPoints ?? 0),
      rank: idx + 1,
      userName: row.userName || "User " + String(row.userId || "").slice(0, 4),
      emblemProductId: row.emblemProductId ?? null,
      helmetProductId: row.helmetProductId ?? null,
      suitProductId: row.suitProductId ?? null,
      colorProductId: row.colorProductId ?? null,
      liveryProductId: row.liveryProductId ?? null,
    };
  }));
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
  
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND "leagueId" = ${leagueId} AND role = 'ADMIN' LIMIT 1` ;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);

  if (user.id === userId) return c.json({ error: "cannot_kick_self" }, 400);

  await sql.begin(async sql => {
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

  const hasPenaltyTable = await ensureTeamPenaltyTable(sql as unknown as SqlExecutor);

  await sql.begin(async (tx) => {
      if (hasPenaltyTable) {
        await tx`
          INSERT INTO "TeamPenalty" (id, "teamId", "leagueId", points, comment)
          VALUES (${penaltyId}, ${teamId}, ${leagueId}, ${pts}, ${comment})
        `;
        await syncTeamTotalPoints(tx as unknown as SqlExecutor, teamId, true);
      } else {
        await tx`
          UPDATE "Team"
          SET "totalPoints" = "totalPoints" + ${pts}
          WHERE id = ${teamId}
        `;
      }
  });

  if (!hasPenaltyTable) {
    return c.json({ ok: true, warning: "penalty_table_unavailable" });
  }
  return c.json({ ok: true });
});

app.post("/league/delete", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId } = await c.req.json();
  if (!leagueId) return c.json({ error: "missing_fields" }, 400);

  const admins = await sql`SELECT role FROM "LeagueMember" WHERE "leagueId" = ${leagueId} AND "userId" = ${user.id} AND role = 'ADMIN'`;
  if (admins.length === 0) return c.json({ error: "not_admin" }, 403);

  await sql.begin(async sql => {
      const teams = await sql`SELECT id FROM "Team" WHERE "leagueId" = ${leagueId}`;
      const teamIds = teams.map(t => t.id);
      if (teamIds.length > 0) {
        await sql`DELETE FROM "TeamResult" WHERE "teamId" IN ${sql(teamIds)}`;
      }
      try {
        await sql`DELETE FROM "TeamPenalty" WHERE "leagueId" = ${leagueId}`;
      } catch (_e) { }
      await sql`DELETE FROM "Team" WHERE "leagueId" = ${leagueId}`;
      await sql`DELETE FROM "LeagueMember" WHERE "leagueId" = ${leagueId}`;
      await sql`DELETE FROM "League" WHERE id = ${leagueId}`;
  });

  return c.json({ ok: true });
});

// Helper constants for Sync
const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchOpenF1Json(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt <= OPENF1_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 && attempt < OPENF1_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 600;
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("openf1_http_error", { url, status: res.status, body: body.slice(0, 120) });
        if (res.status >= 500 && attempt < OPENF1_MAX_RETRIES) {
          await sleep((attempt + 1) * 600);
          continue;
        }
        return null;
      }
      return await res.json();
    } catch (e) {
      if (attempt < OPENF1_MAX_RETRIES) {
        await sleep((attempt + 1) * 600);
        continue;
      }
      console.error("openf1_fetch_error", { url, error: (e as Error).message });
      return null;
    }
  }
  return null;
}

interface OpenF1SessionRow {
  meeting_key?: number | string | null;
  meeting_name?: string | null;
  country_name?: string | null;
  location?: string | null;
  date_start?: string | null;
  session_name?: string | null;
  session_type?: string | null;
}

interface OpenF1MeetingCalendar {
  meetingName: string;
  country: string | null;
  city: string | null;
  raceUtc: string;
  qualifyingUtc: string | null;
  sprintQualifyingUtc: string | null;
  isSprint: boolean;
}

const RACE_CALENDAR_SYNC_COOLDOWN_MS = 10 * 60 * 1000;
let lastRaceCalendarSyncAt = 0;
let raceCalendarSyncInFlight: Promise<void> | null = null;

function hasStoredResults(race: RaceRow): boolean {
  if (!race.results || typeof race.results !== "object") return false;
  const results = race.results as Record<string, unknown>;
  const classificationKeys = ["race", "quali", "sprint", "sprintQuali"];
  for (const key of classificationKeys) {
    const value = results[key];
    if (value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0) {
      return true;
    }
  }
  const driverPoints = results.driverPoints;
  if (driverPoints && typeof driverPoints === "object") {
    for (const value of Object.values(driverPoints as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n) && Math.abs(n) > 0) return true;
    }
  }
  return false;
}

function getSessionNameLower(session: OpenF1SessionRow): string {
  return String(session.session_name || session.session_type || "").trim().toLowerCase();
}

function parseCsvSet(value: string | undefined): Set<string> {
  if (!value) return new Set<string>();
  return new Set(
    value
      .split(",")
      .map((s) => normalizeText(s))
      .filter((s) => s.length > 0),
  );
}

function isMeetingCancelledByRule(season: number, meeting: OpenF1MeetingCalendar): boolean {
  const forcedCancelled = parseCsvSet(Deno.env.get("CANCELLED_RACE_MEETINGS"));
  const candidates = [
    meeting.meetingName,
    meeting.country || "",
    meeting.city || "",
  ].map((x) => normalizeText(x));
  for (const c of candidates) {
    if (c && forcedCancelled.has(c)) return true;
  }

  // 2026 emergency cancellation fallback:
  // Bahrain and Saudi Arabia races do not take place in April.
  if (season === 2026) {
    const raceTs = Date.parse(meeting.raceUtc);
    const isApril = Number.isFinite(raceTs) && (new Date(raceTs).getUTCMonth() === 3);
    if (!isApril) return false;
    const fingerprint = normalizeText(`${meeting.meetingName} ${meeting.country || ""} ${meeting.city || ""}`);
    if (
      fingerprint.includes("bahrain")
      || fingerprint.includes("sakhir")
      || fingerprint.includes("saudi arabia")
      || fingerprint.includes("jeddah")
    ) return true;
  }

  return false;
}

function pickEarliestSessionByName(sessions: OpenF1SessionRow[], targetName: string): OpenF1SessionRow | null {
  const target = targetName.toLowerCase();
  const matches = sessions
    .filter((s) => getSessionNameLower(s) === target && s.date_start)
    .sort((a, b) => Date.parse(String(a.date_start || 0)) - Date.parse(String(b.date_start || 0)));
  return matches[0] || null;
}

async function fetchOpenF1CalendarMeetings(season: number): Promise<OpenF1MeetingCalendar[]> {
  const data = await fetchOpenF1Json(`${OPENF1_BASE}/sessions?year=${season}`);
  if (!Array.isArray(data)) return [];

  const byMeeting = new Map<string, OpenF1SessionRow[]>();
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const session = raw as OpenF1SessionRow;
    const meetingKey = Number.isFinite(Number(session.meeting_key))
      ? String(Number(session.meeting_key))
      : normalizeText(String(session.meeting_name || ""));
    if (!meetingKey) continue;
    const arr = byMeeting.get(meetingKey) || [];
    arr.push(session);
    byMeeting.set(meetingKey, arr);
  }

  const meetings: OpenF1MeetingCalendar[] = [];
  for (const sessions of byMeeting.values()) {
    const raceSession = pickEarliestSessionByName(sessions, "Race");
    if (!raceSession?.date_start) continue;
    const qualifyingSession = pickEarliestSessionByName(sessions, "Qualifying");
    const sprintQualifyingSession = pickEarliestSessionByName(sessions, "Sprint Qualifying");
    const hasSprint = sessions.some((s) => getSessionNameLower(s) === "sprint");

    const country = raceSession.country_name ? String(raceSession.country_name).trim() : null;
    const city = raceSession.location ? String(raceSession.location).trim() : null;
    const meetingNameRaw = raceSession.meeting_name ? String(raceSession.meeting_name).trim() : "";
    const meetingName = meetingNameRaw
      || (city ? `Grand Prix of ${city}` : null)
      || (country ? `Grand Prix of ${country}` : "Grand Prix");

    meetings.push({
      meetingName,
      country,
      city,
      raceUtc: String(raceSession.date_start),
      qualifyingUtc: qualifyingSession?.date_start ? String(qualifyingSession.date_start) : null,
      sprintQualifyingUtc: sprintQualifyingSession?.date_start ? String(sprintQualifyingSession.date_start) : null,
      isSprint: Boolean(hasSprint || sprintQualifyingSession),
    });
  }

  meetings.sort((a, b) => Date.parse(a.raceUtc) - Date.parse(b.raceUtc));
  return meetings.filter((m) => !isMeetingCancelledByRule(season, m));
}

async function syncRaceCalendarFromOpenF1(): Promise<void> {
  const [seasonRow] = await sql<{ season?: number }[]>`
    SELECT season
    FROM "Race"
    WHERE season IS NOT NULL
    ORDER BY season DESC, round DESC
    LIMIT 1
  `;
  const season = Number(seasonRow?.season) || new Date().getUTCFullYear();
  const meetings = await fetchOpenF1CalendarMeetings(season);
  if (meetings.length === 0) return;

  const dbRaces = await sql<RaceRow[]>`
    SELECT id, name, country, city, season, round, "isSprint", "qualifyingUtc", "sprintQualifyingUtc", date, "isCompleted", results
    FROM "Race"
    WHERE season = ${season}
    ORDER BY round ASC
  `;
  if (dbRaces.length === 0) return;

  const nowTs = Date.now();
  const lockedHistoricalRaceIds = new Set(
    dbRaces
      .filter((r) => {
        if (hasStoredResults(r)) return true;
        const ts = Date.parse(String(r.date || 0));
        return Boolean(r.isCompleted) && Number.isFinite(ts) && ts < (nowTs - 12 * 60 * 60 * 1000);
      })
      .map((r) => r.id),
  );

  const lockedHistoricalRaces = dbRaces.filter((r) => lockedHistoricalRaceIds.has(r.id));
  const pivotTs = lockedHistoricalRaces.length > 0
    ? Math.max(...lockedHistoricalRaces.map((r) => Date.parse(String(r.date || 0))).filter(Number.isFinite))
    : NaN;
  const upcomingMeetings = Number.isFinite(pivotTs)
    ? meetings.filter((m) => Date.parse(m.raceUtc) > pivotTs)
    : meetings;

  const mutableRaces = dbRaces.filter((r) => !lockedHistoricalRaceIds.has(r.id));

  await sql.begin(async (tx) => {
    for (let index = 0; index < mutableRaces.length; index++) {
      const race = mutableRaces[index];
      const meeting = upcomingMeetings[index];
      if (!meeting) {
        // Hide local placeholder races that are no longer present in OpenF1.
        if (!hasStoredResults(race) && !race.isCompleted) {
          await tx`UPDATE "Race" SET "isCompleted" = true WHERE id = ${race.id}`;
        }
        continue;
      }

      const raceTs = Date.parse(meeting.raceUtc);
      const isPastAndStale = Number.isFinite(raceTs) && (raceTs + AUTO_CLOSE_MS) < nowTs;
      const newIsCompleted = Boolean(isPastAndStale);

      await tx`
        UPDATE "Race"
        SET
          name = ${meeting.meetingName || race.name},
          country = ${meeting.country},
          city = ${meeting.city},
          season = ${season},
          round = ${race.round},
          "isSprint" = ${meeting.isSprint},
          "qualifyingUtc" = ${meeting.qualifyingUtc},
          "sprintQualifyingUtc" = ${meeting.sprintQualifyingUtc},
          date = ${meeting.raceUtc},
          "isCompleted" = ${newIsCompleted}
        WHERE id = ${race.id}
      `;
    }
  });
}

async function maybeSyncRaceCalendarFromOpenF1(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRaceCalendarSyncAt < RACE_CALENDAR_SYNC_COOLDOWN_MS) return;
  if (raceCalendarSyncInFlight) {
    await raceCalendarSyncInFlight;
    return;
  }

  raceCalendarSyncInFlight = (async () => {
    try {
      await syncRaceCalendarFromOpenF1();
    } catch (e) {
      console.error("openf1_calendar_sync_error", e);
    } finally {
      lastRaceCalendarSyncAt = Date.now();
      raceCalendarSyncInFlight = null;
    }
  })();

  await raceCalendarSyncInFlight;
}

const DRIVER_NUMBER_FALLBACK: Record<number, string> = {
  1: "nor", 3: "ver", 5: "bor", 6: "had", 10: "gas", 11: "per", 12: "ant", 14: "alo", 16: "lec", 18: "str",
  22: "tsu", 23: "alb", 27: "hul", 30: "law", 31: "oco", 41: "lin", 43: "col", 44: "ham", 55: "sai",
  63: "rus", 77: "bot", 81: "pia", 87: "bea", 38: "bea", 50: "bea"
};

const DRIVER_NAME_ID_ALIASES: Record<string, string> = {
  "andrea kimi antonelli": "ant", "kimi antonelli": "ant", "max verstappen": "ver", "lando norris": "nor",
  "charles leclerc": "lec", "lewis hamilton": "ham", "george russell": "rus", "oscar piastri": "pia",
  "fernando alonso": "alo", "lance stroll": "str", "pierre gasly": "gas", "franco colapinto": "col",
  "alexander albon": "alb", "alex albon": "alb", "carlos sainz": "sai", "arvid lindblad": "lin",
  "liam lawson": "law", "oliver bearman": "bea", "esteban ocon": "oco", "gabriel bortoleto": "bor",
  "nico hulkenberg": "hul", "sergio perez": "per", "valtteri bottas": "bot", "isack hadjar": "had"
};

function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function resolveDriverIdByNumber(driverNumber: number, sessionMap: Record<number, string>, knownDriverIds: Set<string>): string | null {
  const fromSession = sessionMap[driverNumber];
  if (fromSession && knownDriverIds.has(fromSession)) return fromSession;
  const fromFallback = DRIVER_NUMBER_FALLBACK[driverNumber];
  if (fromFallback && knownDriverIds.has(fromFallback)) return fromFallback;
  return null;
}

function buildDriverLookup(allDrivers: Driver[]) {
  const byId = new Map<string, string>();
  const byFullName = new Map<string, string>();
  const byLastName = new Map<string, string>();
  const knownIds = new Set<string>();
  for (const d of allDrivers) {
    const idNorm = normalizeText(d.id);
    const fullNorm = normalizeText(d.name);
    knownIds.add(d.id);
    if (idNorm) byId.set(idNorm, d.id);
    if (fullNorm) {
      byFullName.set(fullNorm, d.id);
      const parts = fullNorm.split(" ");
      if (parts.length > 0) byLastName.set(parts[parts.length - 1], d.id);
      const aliasId = DRIVER_NAME_ID_ALIASES[fullNorm];
      if (aliasId && knownIds.has(aliasId)) byFullName.set(fullNorm, aliasId);
    }
  }
  for (const [aliasName, aliasId] of Object.entries(DRIVER_NAME_ID_ALIASES)) {
    if (!knownIds.has(aliasId)) continue;
    const aliasNorm = normalizeText(aliasName);
    if (!aliasNorm) continue;
    byFullName.set(aliasNorm, aliasId);
    const aliasParts = aliasNorm.split(" ");
    if (aliasParts.length > 0) byLastName.set(aliasParts[aliasParts.length - 1], aliasId);
  }
  return { byId, byFullName, byLastName, knownIds };
}

async function getOpenF1DriverNumberMap(sessionKey: number, allDrivers: Driver[]): Promise<Record<number, string>> {
  const map: Record<number, string> = {};
  const { byId, byFullName, byLastName, knownIds } = buildDriverLookup(allDrivers);
  const url = `${OPENF1_BASE}/drivers?session_key=${sessionKey}`;
  try {
    const data = await fetchOpenF1Json(url);
    if (!Array.isArray(data)) return map;
    for (const rawRecord of data) {
      const record = rawRecord as Record<string, unknown>;
      const driverNumber = Number(record.driver_number);
      if (!Number.isFinite(driverNumber)) continue;
      const acronym = normalizeText(String(record.name_acronym || ""));
      const fullName = normalizeText(String(record.full_name || ""));
      const broadcastName = normalizeText(String(record.broadcast_name || ""));
      let driverId: string | undefined;
      if (acronym) driverId = byId.get(acronym);
      if (!driverId && fullName) {
         driverId = byFullName.get(fullName);
         if (!driverId) {
           const parts = fullName.split(" ");
           if (parts.length > 0) driverId = byLastName.get(parts[parts.length - 1]);
         }
      }
      if (!driverId && broadcastName) {
        const parts = broadcastName.split(" ");
        if (parts.length > 0) driverId = byLastName.get(parts[parts.length - 1]);
      }
      if (!driverId) {
        const fallback = DRIVER_NUMBER_FALLBACK[driverNumber];
        if (fallback && knownIds.has(fallback)) driverId = fallback;
      }
      if (driverId && knownIds.has(driverId)) map[driverNumber] = driverId;
    }
  } catch (e) { console.error("openf1_driver_map_error", e); }
  return map;
}

const DEFAULT_RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const DEFAULT_SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const DEFAULT_SCORING_RULES: ScoringRules = {
  racePositionPoints: DEFAULT_RACE_POINTS, raceFastestLap: 0, raceLastPlaceMalus: -3, qualiQ1Eliminated: -3,
  qualiQ2Reached: 1, qualiQ3Reached: 3, qualiPole: 3, qualiGridPenalty: 0, raceDNF: -5, racePenalty: -5,
  teammateBeat: 2, teammateLost: -2, teammateBeatDNF: 1, positionGainedPos1_10: 1.0, positionGainedPos11_Plus: 0.5,
  positionLostPos1_10: -1.0, positionLostPos11_Plus: -0.5, sprintPositionPoints: DEFAULT_SPRINT_POINTS, sprintPole: 1,
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

app.post("/admin/migrate-rules", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  try {
    await sql`ALTER TABLE "League" ADD COLUMN IF NOT EXISTS "rules" JSONB`;
    const leagues = await sql`SELECT id FROM "League" WHERE "rules" IS NULL`;
    for (const l of leagues) {
      const rulesJson = sql.json(DEFAULT_SCORING_RULES as any);
      await sql`UPDATE "League" SET "rules" = ${rulesJson} WHERE id = ${l.id}`;
    }
    return c.json({ ok: true, migrated: leagues.length });
  } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

app.post("/admin/sync-calendar", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  await maybeSyncRaceCalendarFromOpenF1(true);
  const races = await loadRacesOrdered();
  return c.json({ ok: true, races });
});

app.post("/league/rules", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, rules } = await c.req.json();
  if (!leagueId || !rules) return c.json({ error: "missing_fields" }, 400);
  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND "leagueId" = ${leagueId} AND role = 'ADMIN'`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  try {
    const rulesJson = sql.json(rules as any);
    await sql`UPDATE "League" SET "rules" = ${rulesJson} WHERE id = ${leagueId}`;
    return c.json({ ok: true });
  } catch(e) { return c.json({ error: (e as Error).message }, 500); }
});

async function getOpenF1SessionKey(year: number, location: string, type: 'Race' | 'Qualifying' | 'Sprint' | 'Sprint Qualifying', country?: string | null, raceDate?: string | Date | null): Promise<number | null> {
  const candidates: string[] = [];
  const loc = (location || "").trim();
  const ctry = (country || "").trim();
  if (loc) candidates.push(`${OPENF1_BASE}/sessions?year=${year}&location=${encodeURIComponent(loc)}&session_name=${encodeURIComponent(type)}`);
  if (ctry) candidates.push(`${OPENF1_BASE}/sessions?year=${year}&country_name=${encodeURIComponent(ctry)}&session_name=${encodeURIComponent(type)}`);
  candidates.push(`${OPENF1_BASE}/sessions?year=${year}&session_name=${encodeURIComponent(type)}`);
  const targetTs = raceDate ? Date.parse(String(raceDate)) : NaN;
  for (let idx = 0; idx < candidates.length; idx++) {
    const url = candidates[idx];
    try {
      const data = await fetchOpenF1Json(url);
      if (!Array.isArray(data) || data.length === 0) continue;
      const sessions = data.map((x) => x as Record<string, unknown>).filter((x) => Number.isFinite(Number(x.session_key))).map((x) => ({ key: Number(x.session_key), ts: Date.parse(String(x.date_start || 0)) }));
      if (sessions.length === 0) continue;
      if (idx === candidates.length - 1 && Number.isFinite(targetTs)) {
        const sorted = sessions.filter((s) => Number.isFinite(s.ts)).sort((a, b) => Math.abs(a.ts - targetTs) - Math.abs(b.ts - targetTs));
        if (sorted.length > 0) return sorted[0].key;
      }
      sessions.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      return sessions[0].key;
    } catch (e) { console.error("sessions_key_error", e); }
  }
  return null;
}

async function getOpenF1Classification(sessionKey: number, sessionDriverMap: Record<number, string>, knownDriverIds: Set<string>): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  let hasActualClassification = false;
  try {
    const data = await fetchOpenF1Json(`${OPENF1_BASE}/position?session_key=${sessionKey}`);
    if (Array.isArray(data)) {
      const latest: Record<number, number> = {};
      const tss: Record<number, string> = {};
      for (const r of data) {
        const n = Number(r.driver_number); const p = Number(r.position); const t = String(r.date || "");
        if (Number.isFinite(n) && Number.isFinite(p) && p > 0 && t && (!tss[n] || t > tss[n])) { tss[n] = t; latest[n] = p; }
      }
      for (const [n, p] of Object.entries(latest)) {
        const id = resolveDriverIdByNumber(Number(n), sessionDriverMap, knownDriverIds);
        if (id) {
          results[id] = p;
          hasActualClassification = true;
        }
      }
    }
  } catch (e) { console.error("pos_err", e); }
  try {
    const data = await fetchOpenF1Json(`${OPENF1_BASE}/session_result?session_key=${sessionKey}`);
    if (Array.isArray(data)) {
      for (const r of data) {
        const n = Number(r.driver_number); const p = Number(r.position);
        if (Number.isFinite(n) && Number.isFinite(p) && p > 0) {
          const id = resolveDriverIdByNumber(n, sessionDriverMap, knownDriverIds);
          if (id && !results[id]) {
            results[id] = p;
            hasActualClassification = true;
          }
        }
      }
    }
  } catch (e) { console.error("res_err", e); }

  if (!hasActualClassification) {
    return {};
  }

  // Keep unclassified drivers visible in the UI without turning 999 into a real grid slot.
  for (const driverId of new Set(Object.values(sessionDriverMap))) {
    if (!results[driverId]) {
      results[driverId] = 999;
    }
  }

  return results;
}

async function getOpenF1SessionFlags(sessionKey: number, sessionDriverMap: Record<number, string>, knownDriverIds: Set<string>) {
  const dns = new Set<string>(); const dnf = new Set<string>();
  try {
    const data = await fetchOpenF1Json(`${OPENF1_BASE}/session_result?session_key=${sessionKey}`);
    if (Array.isArray(data)) {
      for (const r of data) {
        const n = Number(r.driver_number);
        const id = resolveDriverIdByNumber(n, sessionDriverMap, knownDriverIds);
        if (id) {
          if (r.dns === true) dns.add(id);
          if (r.dnf === true) dnf.add(id);
        }
      }
    }
  } catch (e) { console.error("flag_err", e); }
  return { dnsDrivers: dns, dnfDrivers: dnf };
}

function isReserveActivatedByDns(teamDriverIds: string[], reserveId: string | null | undefined, dnsDrivers: Set<string>): boolean {
  if (!reserveId) return false;
  return teamDriverIds.some((id) => id !== reserveId && dnsDrivers.has(id));
}

function calculateWeekendPoints(combinedResults: CombinedResults, rules: ScoringRules, teammates: Record<string, string>, allDrivers: Driver[]) {
  const r = (v: number) => Math.round(v * 10) / 10;
  const driverPoints: Record<string, number> = {};
  const driverRacePoints: Record<string, number> = {};
  const driverQualiPoints: Record<string, number> = {};
  const driverSprintPoints: Record<string, number> = {};
  const driverSprintQualiPoints: Record<string, number> = {};
  const driverBreakdown: Record<string, DriverBreakdown> = {};

  const raceRes = combinedResults.race || {};
  const qualiRes = combinedResults.quali || {};
  const sprintRes = combinedResults.sprint || {};
  const sqRes = combinedResults.sprintQuali || {};
  const dnfL = combinedResults.dnfDrivers || [];
  const dnsL = combinedResults.dnsDrivers || [];

  for (const d of allDrivers) {
    const dId = d.id;
    let racePts = 0; let qualiPts = 0; let sprintPts = 0; let overtakes = 0; let teammatePts = 0; let dnfPts = 0; let lastPts = 0; let polePts = 0; let sqPolePts = 0;
    const pos = raceRes[dId]; const grid = qualiRes[dId];
    const hasValidRacePos = Number.isFinite(pos) && Number(pos) > 0 && Number(pos) < 900;
    const hasValidGridPos = Number.isFinite(grid) && Number(grid) > 0 && Number(grid) < 900;
    const hasUnclassifiedGrid = Number.isFinite(grid) && Number(grid) >= 900;

    if (hasValidRacePos) {
      racePts = (rules.racePositionPoints || DEFAULT_RACE_POINTS)[pos - 1] || 0;
      const vps = Object.values(raceRes).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 900) as number[];
      const mx = vps.length > 0 ? Math.max(...vps) : 0;
      if (pos === mx && mx > 10) lastPts = (rules.raceLastPlaceMalus ?? -3);
    }
    if (hasValidGridPos || hasUnclassifiedGrid) {
      if (grid === 1) polePts = (rules.qualiPole ?? 3);
      if (hasValidGridPos && grid <= 10) qualiPts += (rules.qualiQ3Reached ?? 3);
      else if (hasValidGridPos && grid <= 16) qualiPts += (rules.qualiQ2Reached ?? 1);
      else qualiPts += (rules.qualiQ1Eliminated ?? -3);
    }
    const retired = dnfL.includes(dId) || dnsL.includes(dId);
    if (hasValidGridPos && hasValidRacePos && !retired) {
      const diff = grid - pos;
      if (diff > 0) {
        for (let p = grid - 1; p >= pos; p--) overtakes += (p <= 10 ? (rules.positionGainedPos1_10 ?? 1.0) : (rules.positionGainedPos11_Plus ?? 0.5));
      } else if (diff < 0) {
        for (let p = grid + 1; p <= pos; p++) overtakes += (p <= 10 ? (rules.positionLostPos1_10 ?? -1.0) : (rules.positionLostPos11_Plus ?? -0.5));
      }
    }
    const sPos = sprintRes[dId]; if (sPos) sprintPts = (rules.sprintPositionPoints || DEFAULT_SPRINT_POINTS)[sPos - 1] || 0;
    if (sqRes[dId] === 1) sqPolePts = (rules.sprintPole ?? 1);
    if (retired) dnfPts = (rules.raceDNF ?? -5);
    const tmId = teammates[dId];
    if (tmId) {
      const myP = raceRes[dId]; const tmP = raceRes[tmId];
      const isMyR = retired;
      const isTmR = dnfL.includes(tmId) || dnsL.includes(tmId);
      const myHasValidPos = Number.isFinite(myP) && Number(myP) > 0 && Number(myP) < 900;
      const tmHasValidPos = Number.isFinite(tmP) && Number(tmP) > 0 && Number(tmP) < 900;
      if (myHasValidPos && tmHasValidPos) {
        if (isMyR && !isTmR) teammatePts += (rules.teammateLost ?? -2);
        else if (!isMyR && isTmR) teammatePts += (rules.teammateBeatDNF !== undefined ? rules.teammateBeatDNF : (rules.teammateBeat ?? 2));
        else if (myP < tmP) teammatePts += (rules.teammateBeat ?? 2);
        else if (myP > tmP) teammatePts += (rules.teammateLost ?? -2);
      } else if (!isMyR && isTmR) {
        teammatePts += (rules.teammateBeatDNF !== undefined ? rules.teammateBeatDNF : (rules.teammateBeat ?? 2));
      } else if (isMyR && !isTmR) {
        teammatePts += (rules.teammateLost ?? -2);
      }
    }
    let mult = 1.0;
    const cId = d.constructorId;
    if (rules.constructors && cId) {
      const cR = (rules.constructors as ConstructorRule[]).find(c => c.id === cId);
      if (cR) mult = cR.multiplier;
    }
    const fRace = (racePts > 0 ? racePts * mult : racePts) + overtakes + dnfPts + lastPts + teammatePts;
    const fQuali = (qualiPts > 0 ? qualiPts * mult : qualiPts) + (polePts > 0 ? polePts * mult : polePts);
    const fSprint = (sprintPts > 0 ? sprintPts * mult : sprintPts);
    const fSq = (sqPolePts > 0 ? sqPolePts * mult : sqPolePts);
    const tot = r(fRace + fQuali + fSprint + fSq);
    driverPoints[dId] = tot; driverRacePoints[dId] = r(fRace); driverQualiPoints[dId] = r(fQuali); driverSprintPoints[dId] = r(fSprint); driverSprintQualiPoints[dId] = r(fSq);
    driverBreakdown[dId] = { racePosition: racePts, overtakes, teammate: teammatePts, sprint: sprintPts, sprintPole: sqPolePts, dnf: dnfPts, lastPlace: lastPts, qualiPole: polePts, qualiSession: qualiPts, total: tot, constructorMult: mult };
  }
  return { driverPoints, driverRacePoints, driverQualiPoints, driverSprintPoints, driverSprintQualiPoints, driverBreakdown };
}

app.get("/leagues/:leagueId/breakdown/:raceId", requireUser, async (c) => {
  const user = c.get("user");
  const { leagueId, raceId } = c.req.param();

  const membership = await sql`SELECT role FROM "LeagueMember" WHERE "userId" = ${user.id} AND "leagueId" = ${leagueId} LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_member" }, 403);

  const [race] = await sql`SELECT id, name, results, "isCompleted" FROM "Race" WHERE id = ${raceId}`;
  if (!race) return c.json({ error: "race_not_found" }, 404);
  if (!race.results) return c.json({ error: "no_results_stored" }, 404);

  const [league] = await sql<{ rules: ScoringRules }[]>`SELECT rules FROM "League" WHERE id = ${leagueId}`;
  const rules = (league?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;
  const allDrivers = await sql<Driver[]>`SELECT id, name, "constructorId" FROM "Driver"`;

  const teammates: Record<string, string> = {};
  const byConstructor: Record<string, string[]> = {};
  for (const d of allDrivers) {
    if (!byConstructor[d.constructorId]) byConstructor[d.constructorId] = [];
    byConstructor[d.constructorId].push(d.id);
  }
  for (const drivers of Object.values(byConstructor)) {
    if (drivers.length === 2) {
      teammates[drivers[0]] = drivers[1];
      teammates[drivers[1]] = drivers[0];
    }
  }

  const stored = race.results as Record<string, unknown>;
  const combinedResults: CombinedResults = {
    race: typeof stored.race === "object" && stored.race !== null ? stored.race as Record<string, number> : undefined,
    quali: typeof stored.quali === "object" && stored.quali !== null ? stored.quali as Record<string, number> : undefined,
    sprint: typeof stored.sprint === "object" && stored.sprint !== null ? stored.sprint as Record<string, number> : undefined,
    sprintQuali: typeof stored.sprintQuali === "object" && stored.sprintQuali !== null ? stored.sprintQuali as Record<string, number> : undefined,
    dnfDrivers: Array.isArray(stored.dnfDrivers) ? stored.dnfDrivers.filter((x): x is string => typeof x === "string") : [],
    dnsDrivers: Array.isArray(stored.dnsDrivers) ? stored.dnsDrivers.filter((x): x is string => typeof x === "string") : [],
  };

  const points = calculateWeekendPoints(combinedResults, rules, teammates, allDrivers);

  return c.json({
    raceId: race.id,
    raceName: race.name,
    isCompleted: Boolean(race.isCompleted),
    results: {
      ...combinedResults,
      driverPoints: points.driverPoints,
      driverRacePoints: points.driverRacePoints,
      driverQualiPoints: points.driverQualiPoints,
      driverSprintPoints: points.driverSprintPoints,
      driverSprintQualiPoints: points.driverSprintQualiPoints,
      driverBreakdown: points.driverBreakdown,
    }
  });
});

app.post("/admin/sync-race", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT "leagueId", role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  const { raceId } = await c.req.json();
  if (!raceId) return c.json({ error: "missing_raceId" }, 400);
  const [race] = await sql`SELECT * FROM "Race" WHERE id = ${raceId}`;
  if (!race) return c.json({ error: "race_not_found" }, 404);
  try {
    await sql`ALTER TABLE "TeamResultDriver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
    await sql`ALTER TABLE "Driver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
    await sql`ALTER TABLE "Team" ALTER COLUMN "totalPoints" TYPE DOUBLE PRECISION USING "totalPoints"::double precision`;
    await sql`ALTER TABLE "TeamResult" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points"::double precision`;
  } catch (_e) {}
  const allDrivers = await sql<Driver[]>`SELECT id, name, "constructorId" FROM "Driver"`;
  if (allDrivers.length === 0) return c.json({ error: "no_drivers_found" }, 400);
  const teammates: Record<string, string> = {};
  const byC: Record<string, string[]> = {};
  for (const d of allDrivers) {
    if (!byC[d.constructorId]) byC[d.constructorId] = [];
    byC[d.constructorId].push(d.id);
  }
  for (const drvs of Object.values(byC)) if (drvs.length === 2) { teammates[drvs[0]] = drvs[1]; teammates[drvs[1]] = drvs[0]; }
  const season = Number(race.season) || 2026; const loc = race.city || race.country || ""; const known = new Set(allDrivers.map((d) => d.id));
  const res: CombinedResults = {};
  const qK = await getOpenF1SessionKey(season, loc, "Qualifying", race.country, race.date);
  if (qK) {
    const map = await getOpenF1DriverNumberMap(qK, allDrivers);
    const pos = await getOpenF1Classification(qK, map, known);
    if (Object.keys(pos).length > 0) res.quali = pos;
  }
  if (race.isSprint) {
    const sqK = await getOpenF1SessionKey(season, loc, "Sprint Qualifying", race.country, race.date);
    if (sqK) {
      const map = await getOpenF1DriverNumberMap(sqK, allDrivers);
      const pos = await getOpenF1Classification(sqK, map, known);
      if (Object.keys(pos).length > 0) res.sprintQuali = pos;
    }
    const sK = await getOpenF1SessionKey(season, loc, "Sprint", race.country, race.date);
    if (sK) {
      const map = await getOpenF1DriverNumberMap(sK, allDrivers);
      const pos = await getOpenF1Classification(sK, map, known);
      if (Object.keys(pos).length > 0) res.sprint = pos;
    }
  }
  let pub = false; let dnsD = new Set<string>(); let dnfD = new Set<string>();
  const rK = await getOpenF1SessionKey(season, loc, "Race", race.country, race.date);
  if (rK) {
    const map = await getOpenF1DriverNumberMap(rK, allDrivers);
    const pos = await getOpenF1Classification(rK, map, known);
    if (Object.keys(pos).length > 0) { res.race = pos; pub = true; }
    const flg = await getOpenF1SessionFlags(rK, map, known);
    dnsD = flg.dnsDrivers; dnfD = flg.dnfDrivers;
  }
  res.dnsDrivers = Array.from(dnsD); res.dnfDrivers = Array.from(dnfD);
  if (Object.keys(res).length === 0) return c.json({ error: "no_data", loc, season }, 404);
  const lId = membership[0].leagueId;
  const [lD] = await sql<{ rules: ScoringRules }[]>`SELECT rules FROM "League" WHERE id = ${lId}`;
  const rules = (lD?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;
  const lPts = calculateWeekendPoints(res, rules, teammates, allDrivers);
  const hasPenaltyTable = await ensureTeamPenaltyTable(sql as unknown as SqlExecutor);
  await sql.begin(async (sql) => {
    const teams = await sql`SELECT id, "captainId", "reserveId" FROM "Team" WHERE "leagueId" = ${lId}`;
    const tIds = teams.map((t) => t.id);
    if (tIds.length > 0) {
      const old = await sql`SELECT id FROM "TeamResult" WHERE "raceId" = ${race.id} AND "teamId" IN ${sql(tIds)}`;
      if (old.length > 0) {
        const oIds = old.map((r) => r.id);
        await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN ${sql(oIds)}`;
        await sql`DELETE FROM "TeamResult" WHERE id IN ${sql(oIds)}`;
      }
    }
    for (const t of teams) {
      const td = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${t.id}`;
      const tdIds = td.map((x) => x.driverId);
      const resA = isReserveActivatedByDns(tdIds, t.reserveId, dnsD);
      let tP = 0; const rD = [];
      for (const dId of tdIds) {
        let p = Number(lPts.driverPoints[dId] || 0);
        if (dId === t.reserveId) p = resA ? p * 0.5 : 0;
        if (dId === t.captainId) p = p * 2.0;
        tP += p; rD.push({ driverId: dId, points: p });
      }
      const trId = crypto.randomUUID();
      await sql`INSERT INTO "TeamResult" (id, "raceId", "teamId", points, "captainId", "reserveId", "createdAt") VALUES (${trId}, ${race.id}, ${t.id}, ${tP}, ${t.captainId}, ${t.reserveId}, ${new Date().toISOString()})`;
      for (const d of rD) await sql`INSERT INTO "TeamResultDriver" (id, "teamResultId", "driverId", points) VALUES (${crypto.randomUUID()}, ${trId}, ${d.driverId}, ${d.points})`;
      await syncTeamTotalPoints(sql as unknown as SqlExecutor, t.id, hasPenaltyTable);
    }
    const offP = calculateWeekendPoints(res, DEFAULT_SCORING_RULES, teammates, allDrivers);
    const finalR = { ...res, driverPoints: offP.driverPoints, driverRacePoints: offP.driverRacePoints, driverQualiPoints: offP.driverQualiPoints, driverSprintPoints: offP.driverSprintPoints, driverSprintQualiPoints: offP.driverSprintQualiPoints, driverBreakdown: offP.driverBreakdown };
    await sql`UPDATE "Race" SET "isCompleted" = ${pub}, "results" = ${sql.json(finalR as any)} WHERE id = ${race.id}`;
    const allR = await sql`SELECT results FROM "Race" WHERE results IS NOT NULL`;
    const dTot: Record<string, number> = {};
    for (const r of allR) {
      const rp = r.results?.driverPoints || {};
      for (const [id, v] of Object.entries(rp)) dTot[id] = (dTot[id] || 0) + Number(v || 0);
    }
    for (const d of allDrivers) await sql`UPDATE "Driver" SET points = ${dTot[d.id] || 0} WHERE id = ${d.id}`;
  });
  return c.json({ ok: true, loc, season });
});

app.post("/admin/recalculate-race", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT "leagueId" FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  const { raceId } = await c.req.json(); if (!raceId) return c.json({ error: "missing_raceId" }, 400);
  try {
    const [race] = await sql`SELECT * FROM "Race" WHERE id = ${raceId}`;
    if (!race || !race.results) return c.json({ error: "no_results" }, 400);
    const cRes: CombinedResults = { quali: race.results.quali, race: race.results.race, sprint: race.results.sprint, sprintQuali: race.results.sprintQuali, dnfDrivers: race.results.dnfDrivers || [], dnsDrivers: race.results.dnsDrivers || [] };
    const lId = membership[0].leagueId; const [lD] = await sql`SELECT rules FROM "League" WHERE id = ${lId}`;
    const rules = (lD?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;
    const allD = await sql<Driver[]>`SELECT id, name, "constructorId" FROM "Driver"`;
    const teammates: Record<string, string> = {}; const byC: Record<string, string[]> = {};
    for (const d of allD) { if (!byC[d.constructorId]) byC[d.constructorId] = []; byC[d.constructorId].push(d.id); }
    for (const drvs of Object.values(byC)) if (drvs.length === 2) { teammates[drvs[0]] = drvs[1]; teammates[drvs[1]] = drvs[0]; }
    const recalculated = calculateWeekendPoints(cRes, rules, teammates, allD);
    const points = recalculated.driverPoints;
    const hasPenaltyTable = await ensureTeamPenaltyTable(sql as unknown as SqlExecutor);
    await sql.begin(async (sql) => {
      const teams = await sql`SELECT id, "captainId", "reserveId" FROM "Team" WHERE "leagueId" = ${lId}`;
      const tIds = teams.map(t => t.id);
      if (tIds.length > 0) {
        const old = await sql`SELECT id FROM "TeamResult" WHERE "raceId" = ${race.id} AND "teamId" IN ${sql(tIds)}`;
        if (old.length > 0) {
          const oIds = old.map(r => r.id);
          await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN ${sql(oIds)}`;
          await sql`DELETE FROM "TeamResult" WHERE id IN ${sql(oIds)}`;
        }
      }
      for (const t of teams) {
        const td = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${t.id}`;
        const dnsS = new Set<string>(cRes.dnsDrivers); const resA = isReserveActivatedByDns(td.map(x=>x.driverId), t.reserveId, dnsS);
        let tP = 0; const rD = [];
        for (const drv of td) {
          let p = Number(points[drv.driverId]) || 0;
          if (t.captainId === drv.driverId) p *= 2.0; else if (t.reserveId === drv.driverId) p = resA ? p * 0.5 : 0;
          tP += p; rD.push({ driverId: drv.driverId, points: p });
        }
        const trId = crypto.randomUUID();
        await sql`INSERT INTO "TeamResult" (id, "raceId", "teamId", points, "captainId", "reserveId") VALUES (${trId}, ${race.id}, ${t.id}, ${tP}, ${t.captainId}, ${t.reserveId})`;
        for (const rd of rD) await sql`INSERT INTO "TeamResultDriver" (id, "teamResultId", "driverId", points) VALUES (${crypto.randomUUID()}, ${trId}, ${rd.driverId}, ${rd.points})`;
        await syncTeamTotalPoints(sql as unknown as SqlExecutor, t.id, hasPenaltyTable);
      }
    });
    return c.json({ ok: true });
  } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

app.post("/admin/simulate-race", requireUser, async (c) => {
  const user = c.get("user");
  const membership = await sql`SELECT "leagueId", role FROM "LeagueMember" WHERE "userId" = ${user.id} AND role = 'ADMIN' LIMIT 1`;
  if (membership.length === 0) return c.json({ error: "not_admin" }, 403);
  const { raceId } = await c.req.json(); if (!raceId) return c.json({ error: "missing_raceId" }, 400);
  try {
    const [race] = await sql`SELECT * FROM "Race" WHERE id = ${raceId}`; if (!race) return c.json({ error: "not_found" }, 404);
    const allD = await sql<Driver[]>`SELECT id, name, "constructorId" FROM "Driver"`;
    const shuffle = <T>(a: T[]) => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };
    const bld = (ds: { id: string }[]) => { const s = shuffle(ds); const o: Record<string, number> = {}; s.forEach((d, i) => { o[d.id] = i + 1; }); return o; };
    const dnsIds = shuffle(allD).slice(0, 1).map(d => d.id); const participants = allD.filter(d => !dnsIds.includes(d.id));
    const cRes: CombinedResults = { quali: bld(allD), race: bld(participants), dnfDrivers: [], dnsDrivers: dnsIds };
    if (race.isSprint) { cRes.sprintQuali = bld(allD); cRes.sprint = bld(allD); }
    const teammates: Record<string, string> = {}; const byC: Record<string, string[]> = {};
    for (const d of allD) { if (!byC[d.constructorId]) byC[d.constructorId] = []; byC[d.constructorId].push(d.id); }
    for (const drvs of Object.values(byC)) if (drvs.length === 2) { teammates[drvs[0]] = drvs[1]; teammates[drvs[1]] = drvs[0]; }
    const lId = membership[0].leagueId; const [lD] = await sql<{ rules: ScoringRules }[]>`SELECT rules FROM "League" WHERE id = ${lId}`;
    const rules = (lD?.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;
    const points = calculateWeekendPoints(cRes, rules, teammates, allD);
    const dnsSet = new Set(dnsIds);
    const hasPenaltyTable = await ensureTeamPenaltyTable(sql as unknown as SqlExecutor);
    await sql.begin(async (sql) => {
      const teams = await sql`SELECT id, "captainId", "reserveId" FROM "Team" WHERE "leagueId" = ${lId}`;
      for (const t of teams) {
        const td = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${t.id}`;
        const tdIds = td.map(x => x.driverId); const resA = isReserveActivatedByDns(tdIds, t.reserveId, dnsSet);
        let teamP = 0; const rD = [];
        for (const dId of tdIds) {
          let p = Number(points.driverPoints[dId] || 0); if (t.captainId === dId) p *= 2.0; else if (t.reserveId === dId) p = resA ? p * 0.5 : 0;
          teamP += p; rD.push({ driverId: dId, points: p });
        }
        const trId = crypto.randomUUID();
        await sql`INSERT INTO "TeamResult" (id, "raceId", "teamId", points, "captainId", "reserveId") VALUES (${trId}, ${race.id}, ${t.id}, ${teamP}, ${t.captainId}, ${t.reserveId})`;
        for (const rd of rD) await sql`INSERT INTO "TeamResultDriver" (id, "teamResultId", "driverId", points) VALUES (${crypto.randomUUID()}, ${trId}, ${rd.driverId}, ${rd.points})`;
        await syncTeamTotalPoints(sql as unknown as SqlExecutor, t.id, hasPenaltyTable);
      }
      const finalR = { ...cRes, driverPoints: points.driverPoints, driverRacePoints: points.driverRacePoints, driverQualiPoints: points.driverQualiPoints, driverSprintPoints: points.driverSprintPoints, driverSprintQualiPoints: points.driverSprintQualiPoints, driverBreakdown: points.driverBreakdown };
      await sql`UPDATE "Race" SET "isCompleted" = true, "results" = ${sql.json(finalR as any)} WHERE id = ${race.id}`;
      const allR = await sql`SELECT results FROM "Race" WHERE results IS NOT NULL`;
      const dTot: Record<string, number> = {};
      for (const r of allR) { const rp = r.results?.driverPoints || {}; for (const [id, v] of Object.entries(rp)) dTot[id] = (dTot[id] || 0) + Number(v || 0); }
      for (const d of allD) await sql`UPDATE "Driver" SET points = ${dTot[d.id] || 0} WHERE id = ${d.id}`;
    });
    return c.json({ ok: true });
  } catch (error) { return c.json({ error: (error as Error).message }, 500); }
});

app.post("/cron/sync-all", async (c) => {
  const authHeader = c.req.header("Authorization") || c.req.header("cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET") || "fanta-cron-2026";
  if (authHeader !== `Bearer ${expectedSecret}` && authHeader !== expectedSecret) return c.json({ error: "unauthorized" }, 401);
  try {
    const races = await autocloseStaleRaces();
    const race = pickActiveRace(races);
    if (!race || race.isCompleted) return c.json({ message: "No active races" }, 200);

    const allD = await sql<Driver[]>`SELECT id, name, "constructorId" FROM "Driver"`;
    if (allD.length === 0) return c.json({ error: "no_drivers" }, 400);
    const teammates: Record<string, string> = {}; const byC: Record<string, string[]> = {};
    for (const d of allD) { if (!byC[d.constructorId]) byC[d.constructorId] = []; byC[d.constructorId].push(d.id); }
    for (const drvs of Object.values(byC)) if (drvs.length === 2) { teammates[drvs[0]] = drvs[1]; teammates[drvs[1]] = drvs[0]; }
    const season = Number(race.season) || 2026; const loc = race.city || race.country || ""; const known = new Set(allD.map((d) => d.id));
    const cRes: CombinedResults = {};
    const qK = await getOpenF1SessionKey(season, loc, "Qualifying", race.country, race.date);
    if (qK) { const map = await getOpenF1DriverNumberMap(qK, allD); const pos = await getOpenF1Classification(qK, map, known); if (Object.keys(pos).length > 0) cRes.quali = pos; }
    if (race.isSprint) {
      const sqK = await getOpenF1SessionKey(season, loc, "Sprint Qualifying", race.country, race.date);
      if (sqK) { const map = await getOpenF1DriverNumberMap(sqK, allD); const pos = await getOpenF1Classification(sqK, map, known); if (Object.keys(pos).length > 0) cRes.sprintQuali = pos; }
      const sK = await getOpenF1SessionKey(season, loc, "Sprint", race.country, race.date);
      if (sK) { const map = await getOpenF1DriverNumberMap(sK, allD); const pos = await getOpenF1Classification(sK, map, known); if (Object.keys(pos).length > 0) cRes.sprint = pos; }
    }
    let pub = false; const rK = await getOpenF1SessionKey(season, loc, "Race", race.country, race.date);
    if (rK) {
      const map = await getOpenF1DriverNumberMap(rK, allD); const pos = await getOpenF1Classification(rK, map, known);
      if (Object.keys(pos).length > 0) { cRes.race = pos; pub = true; }
      const flg = await getOpenF1SessionFlags(rK, map, known); cRes.dnsDrivers = Array.from(flg.dnsDrivers); cRes.dnfDrivers = Array.from(flg.dnfDrivers);
    }
    if (Object.keys(cRes).length === 0) return c.json({ message: "No data" }, 200);
    const allL = await sql`SELECT id, rules FROM "League"`;
    const hasPenaltyTable = await ensureTeamPenaltyTable(sql as unknown as SqlExecutor);
    await sql.begin(async (sql) => {
      for (const l of allL) {
        const rules = (l.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;
        const pts = calculateWeekendPoints(cRes, rules, teammates, allD);
        const teams = await sql`SELECT id, "captainId", "reserveId" FROM "Team" WHERE "leagueId" = ${l.id}`;
        const teamIds = teams.map((t) => t.id);
        if (teamIds.length > 0) {
          const old = await sql`SELECT id FROM "TeamResult" WHERE "raceId" = ${race.id} AND "teamId" IN ${sql(teamIds)}`;
          if (old.length > 0) {
            const oldIds = old.map((r) => r.id);
            await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN ${sql(oldIds)}`;
            await sql`DELETE FROM "TeamResult" WHERE id IN ${sql(oldIds)}`;
          }
        }
        for (const t of teams) {
          const td = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = ${t.id}`;
          const dnsS = new Set<string>(cRes.dnsDrivers || []); const resA = isReserveActivatedByDns(td.map(x=>x.driverId), t.reserveId, dnsS);
          let teamP = 0; const rD = [];
          for (const dId of td.map(x=>x.driverId)) {
            let p = Number(pts.driverPoints[dId]) || 0; if (t.captainId === dId) p *= 2.0; else if (t.reserveId === dId) p = resA ? p * 0.5 : 0;
            teamP += p; rD.push({ driverId: dId, points: p });
          }
          const trId = crypto.randomUUID();
          await sql`INSERT INTO "TeamResult" (id, "raceId", "teamId", points, "captainId", "reserveId", "createdAt") VALUES (${trId}, ${race.id}, ${t.id}, ${teamP}, ${t.captainId}, ${t.reserveId}, ${new Date().toISOString()})`;
          for (const rd of rD) await sql`INSERT INTO "TeamResultDriver" (id, "teamResultId", "driverId", points) VALUES (${crypto.randomUUID()}, ${trId}, ${rd.driverId}, ${rd.points})`;
          await syncTeamTotalPoints(sql as unknown as SqlExecutor, t.id, hasPenaltyTable);
        }
      }
      const defP = calculateWeekendPoints(cRes, DEFAULT_SCORING_RULES, teammates, allD);
      const finalR = { ...cRes, driverPoints: defP.driverPoints, driverRacePoints: defP.driverRacePoints, driverQualiPoints: defP.driverQualiPoints, driverSprintPoints: defP.driverSprintPoints, driverSprintQualiPoints: defP.driverSprintQualiPoints, driverBreakdown: defP.driverBreakdown };
      await sql`UPDATE "Race" SET "isCompleted" = ${pub}, "results" = ${sql.json(finalR as any)} WHERE id = ${race.id}`;
      const allR = await sql`SELECT results FROM "Race" WHERE results IS NOT NULL`;
      const dTot: Record<string, number> = {};
      for (const r of allR) { const rp = r.results?.driverPoints || {}; for (const [id, v] of Object.entries(rp)) dTot[id] = (dTot[id] || 0) + Number(v || 0); }
      for (const d of allD) await sql`UPDATE "Driver" SET points = ${dTot[d.id] || 0} WHERE id = ${d.id}`;
    });
    return c.json({ ok: true, raceId: race.id });
  } catch (e) { return c.json({ error: (e as Error).message }, 500); }
});

// --- Cosmetics endpoints (Phase 4a, added 2026-04-17) -------------------

// GET /me/cosmetics — list the authenticated user's owned cosmetic items
// plus the currently-equipped product IDs across all of their teams.
app.get("/me/cosmetics", requireUser, async (c) => {
  try {
    const user = c.get("user");
    await ensureUserCosmeticTable(sql as unknown as SqlExecutor);
    await ensureTeamCosmeticColumns(sql as unknown as SqlExecutor);

    const owned = await sql`
      SELECT "productId", "category", "purchasedAt"
      FROM "UserCosmetic"
      WHERE "userId" = ${user.id}
      ORDER BY "purchasedAt" ASC
    `;

    const teams = await sql`
      SELECT id, "leagueId", "emblemProductId", "helmetProductId", "suitProductId", "colorProductId", "liveryProductId"
      FROM "Team"
      WHERE "userId" = ${user.id}
    `;

    return c.json({
      owned: owned.map((r) => ({
        productId: r.productId,
        category: r.category,
        purchasedAt: r.purchasedAt,
      })),
      equipped: teams.map((t) => ({
        teamId: t.id,
        leagueId: t.leagueId,
        emblemProductId: t.emblemProductId,
        helmetProductId: t.helmetProductId,
        suitProductId: t.suitProductId,
        colorProductId: t.colorProductId,
        liveryProductId: t.liveryProductId,
      })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /me/cosmetics/equip — set or clear an equipped cosmetic on the
// caller's team. Body: { teamId, category, productId|null }.
// - productId null clears the slot (revert to default).
// - productId must be owned by the caller.
// - category must be one of emblem|helmet|suit|color and must match the
//   product's category.
app.post("/me/cosmetics/equip", requireUser, async (c) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const teamId = typeof body?.teamId === "string" ? body.teamId : null;
    const category = typeof body?.category === "string" ? body.category : null;
    const productId = body?.productId === null ? null : (typeof body?.productId === "string" ? body.productId : undefined);

    if (!teamId || !category || productId === undefined) {
      return c.json({ error: "missing_fields" }, 400);
    }
    if (!isEquipCategory(category)) {
      return c.json({ error: "invalid_category" }, 400);
    }

    await ensureTeamCosmeticColumns(sql as unknown as SqlExecutor);

    // Team must belong to caller
    const [team] = await sql`
      SELECT id FROM "Team" WHERE id = ${teamId} AND "userId" = ${user.id}
    `;
    if (!team) return c.json({ error: "team_not_found" }, 404);

    // If setting a product, verify ownership and category match.
    if (productId !== null) {
      const entry = COSMETIC_CATALOG[productId];
      if (!entry || entry.category !== category) {
        return c.json({ error: "product_category_mismatch" }, 400);
      }
      await ensureUserCosmeticTable(sql as unknown as SqlExecutor);
      const [owned] = await sql`
        SELECT 1 FROM "UserCosmetic"
        WHERE "userId" = ${user.id} AND "productId" = ${productId}
        LIMIT 1
      `;
      if (!owned) return c.json({ error: "not_owned" }, 403);
    }

    const column =
      category === "emblem" ? "emblemProductId" :
      category === "helmet" ? "helmetProductId" :
      category === "suit"   ? "suitProductId"   :
      category === "color"  ? "colorProductId"  :
      "liveryProductId";

    // Postgres.js does not allow dynamic column names inside tagged templates,
    // so we branch. The value is still safely parameterised.
    if (category === "emblem") {
      await sql`UPDATE "Team" SET "emblemProductId" = ${productId}, "updatedAt" = ${new Date().toISOString()} WHERE id = ${teamId}`;
    } else if (category === "helmet") {
      await sql`UPDATE "Team" SET "helmetProductId" = ${productId}, "updatedAt" = ${new Date().toISOString()} WHERE id = ${teamId}`;
    } else if (category === "suit") {
      await sql`UPDATE "Team" SET "suitProductId"   = ${productId}, "updatedAt" = ${new Date().toISOString()} WHERE id = ${teamId}`;
    } else if (category === "color") {
      await sql`UPDATE "Team" SET "colorProductId"  = ${productId}, "updatedAt" = ${new Date().toISOString()} WHERE id = ${teamId}`;
    } else {
      await sql`UPDATE "Team" SET "liveryProductId" = ${productId}, "updatedAt" = ${new Date().toISOString()} WHERE id = ${teamId}`;
    }

    return c.json({ ok: true, teamId, category, productId, column });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /revenuecat/webhook — server-to-server callback from RevenueCat.
// Auth: `Authorization: Bearer ${REVENUECAT_WEBHOOK_AUTH_SECRET}`. Set the
// same secret in the RevenueCat dashboard webhook config.
// Idempotency: deduped by event.id via WebhookEvent table.
// Payload contract (v1): https://www.revenuecat.com/docs/integrations/webhooks
//   event.type         — "INITIAL_PURCHASE" | "NON_RENEWING_PURCHASE" | ...
//   event.id           — unique per delivery
//   event.product_id   — the SKU purchased
//   event.app_user_id  — the User.id we set via Purchases.logIn(user.id)
//                        on the client BEFORE purchase. Required.
app.post("/revenuecat/webhook", async (c) => {
  try {
    const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH_SECRET");
    if (!expected) {
      console.error("REVENUECAT_WEBHOOK_AUTH_SECRET not set in function env");
      return c.json({ error: "server_misconfigured" }, 500);
    }
    const authHeader = c.req.header("Authorization") || "";
    const provided = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    if (provided !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = await c.req.json();
    const event = body?.event;
    const eventId: string | undefined = event?.id;
    const eventType: string | undefined = event?.type;
    const productId: string | undefined = event?.product_id;
    const appUserId: string | undefined = event?.app_user_id;

    if (!eventId || !eventType || !productId || !appUserId) {
      return c.json({ error: "malformed_event" }, 400);
    }

    // Only act on purchase-type events. Ignore TEST, RENEWAL of subscriptions,
    // CANCELLATION, etc. Non-consumables only fire INITIAL_PURCHASE once per user.
    const purchaseTypes = new Set([
      "INITIAL_PURCHASE",
      "NON_RENEWING_PURCHASE",
      "UNCANCELLATION",
    ]);
    if (!purchaseTypes.has(eventType)) {
      return c.json({ ok: true, ignored: true, type: eventType });
    }

    // Only act on our cosmetic products. Anything else (e.g. the existing
    // ad-removal "premium" entitlement) is handled elsewhere.
    if (!productId.startsWith("fantaf1.cosmetic.")) {
      return c.json({ ok: true, ignored: true, reason: "non_cosmetic_product" });
    }

    const catalogEntry = COSMETIC_CATALOG[productId];
    if (!catalogEntry) {
      console.warn("Unknown cosmetic product in webhook:", productId);
      return c.json({ ok: true, ignored: true, reason: "unknown_product" });
    }

    await ensureWebhookEventTable(sql as unknown as SqlExecutor);
    await ensureUserCosmeticTable(sql as unknown as SqlExecutor);

    // Idempotency gate — one row per event id.
    const inserted = await sql`
      INSERT INTO "WebhookEvent" (id, source)
      VALUES (${eventId}, 'revenuecat')
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      return c.json({ ok: true, deduped: true });
    }

    // User must exist (client should call Purchases.logIn(user.id) pre-purchase).
    const [user] = await sql`SELECT id FROM "User" WHERE id = ${appUserId}`;
    if (!user) {
      return c.json({ error: "user_not_found", appUserId }, 404);
    }

    // Expand bundle/pass to individual product IDs.
    const productsToGrant = expandCosmeticProduct(productId);
    if (productsToGrant.length === 0) {
      return c.json({ ok: true, granted: 0 });
    }

    let grantedCount = 0;
    await sql.begin(async (tx) => {
      for (const pid of productsToGrant) {
        const entry = COSMETIC_CATALOG[pid];
        if (!entry || !isEquipCategory(entry.category)) continue;
        const id = crypto.randomUUID();
        const result = await tx`
          INSERT INTO "UserCosmetic" (id, "userId", "productId", category)
          VALUES (${id}, ${appUserId}, ${pid}, ${entry.category})
          ON CONFLICT ("userId","productId") DO NOTHING
          RETURNING id
        `;
        if (result.length > 0) grantedCount += 1;
      }
    });

    return c.json({ ok: true, granted: grantedCount, productId });
  } catch (e) {
    console.error("RevenueCat webhook error:", e);
    return c.json({ error: (e as Error).message }, 500);
  }
});

serve(app.fetch);
