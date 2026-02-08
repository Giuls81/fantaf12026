import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "crypto";
import { syncRaceResults } from "./services/openf1";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const app = Fastify({ logger: true });

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getBearerToken(authHeader: unknown): string | null {
  if (typeof authHeader !== "string") return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length ? token : null;
}

async function requireUser(req: any, reply: any) {
  const token = getBearerToken(req.headers["authorization"]);
  if (!token)
    return {
      ok: false as const,
      replied: reply.code(401).send({ error: "missing_token" }),
    };

  const user = await prisma.user.findUnique({ where: { authToken: token } });
  if (!user)
    return {
      ok: false as const,
      replied: reply.code(401).send({ error: "invalid_token" }),
    };

  return { ok: true as const, user };
}

async function start() {
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
    credentials: true,
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/anon", async () => {
    const authToken = makeToken();
    const user = await prisma.user.create({
      data: { authToken },
      select: { id: true, authToken: true },
    });
    return user;
  });

  app.get("/me", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const memberships = await prisma.leagueMember.findMany({
      where: { userId: auth.user.id },
      include: {
        league: {
          include: {
            teams: {
              where: { userId: auth.user.id },
              include: { drivers: true }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      user: { id: auth.user.id },
      leagues: memberships.map((m) => {
        const team = m.league.teams[0]; // Filtered by where: { userId } above
        return {
          id: m.league.id,
          name: m.league.name,
          joinCode: m.league.joinCode,
          role: m.role,
          isAdmin: m.role === "ADMIN",
          team: team ? {
            id: team.id,
            budget: team.budget,
            captainId: team.captainId,
            reserveId: team.reserveId,
            driverIds: team.drivers.map(d => d.driverId)
          } : null
        };
      }),
    };
  });

  app.get("/races", async () => {
    const races = await prisma.race.findMany({
      orderBy: { round: "asc" },
      select: {
        id: true,
        name: true,
        country: true,
        city: true,
        season: true,
        round: true,
        isSprint: true,
        qualifyingUtc: true,
        sprintQualifyingUtc: true,
        date: true,
        isCompleted: true,
      },
    });

    return races;
  });

  app.get("/drivers", async () => {
    return (prisma as any).driver.findMany({
      orderBy: { price: 'desc' }
    });
  });

  app.post("/leagues", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const body = (req.body ?? {}) as { name?: string };
    const name = (body.name?.trim() || "League").slice(0, 64);

    const joinCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    const league = await prisma.league.create({
      data: {
        name,
        joinCode,
        members: {
          create: {
            userId: auth.user.id,
            role: "ADMIN",
          },
        },
        teams: {
          create: {
            userId: auth.user.id,
            budget: 100.0
          }
        }
      },
      select: { id: true, name: true, joinCode: true },
    });

    return league;
  });

  app.get("/leagues/:leagueId/standings", async (req, reply) => {
    const { leagueId } = req.params as { leagueId: string };
    
    const teams = await (prisma.team as any).findMany({
      where: { leagueId },
      include: {
        user: { select: { id: true, displayName: true } }
      },
      orderBy: { totalPoints: "desc" }
    });

    return teams.map((team: any, index: number) => ({
      rank: index + 1,
      userId: team.userId,
      userName: team.user.displayName || `User ${team.userId.slice(0, 4)}`,
      totalPoints: team.totalPoints
    }));
  });

  app.get("/leagues/:leagueId/results/:raceId", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const { leagueId, raceId } = req.params as { leagueId: string, raceId: string };
    
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return reply.code(404).send({ error: "race_not_found" });

    const results = await (prisma as any).teamResult.findMany({
      where: { raceId, team: { leagueId } },
      include: {
        team: { include: { user: { select: { id: true, displayName: true } } } },
        drivers: { include: { driver: true } }
      },
      orderBy: { points: "desc" }
    });

    // Privacy Logic: If race is not completed, Hide drivers for other users
    return results.map((res: any) => {
      const isOwner = res.team.userId === auth.user.id;
      const shouldHide = !race.isCompleted && !isOwner;

      return {
        id: res.id,
        userId: res.team.userId,
        userName: res.team.user.displayName || `User ${res.team.userId.slice(0, 4)}`,
        points: res.points,
        captainId: shouldHide ? null : res.captainId,
        reserveId: shouldHide ? null : res.reserveId,
        drivers: shouldHide ? [] : res.drivers.map((d: any) => ({
          id: d.driverId,
          name: d.driver.name,
          points: d.points
        }))
      };
    });
  });

  app.post("/leagues/join", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const body = (req.body ?? {}) as { joinCode?: string };
    const joinCode = (body.joinCode ?? "").toString().trim().toUpperCase();

    if (!joinCode) return reply.code(400).send({ error: "missing_joinCode" });

    const league = await prisma.league.findUnique({ where: { joinCode } });
    if (!league) return reply.code(404).send({ error: "league_not_found" });

    await prisma.leagueMember.upsert({
      where: {
        userId_leagueId: {
          userId: auth.user.id,
          leagueId: league.id,
        },
      },
      update: {},
      create: {
        userId: auth.user.id,
        leagueId: league.id,
        role: "MEMBER",
      },
    });

    // Create Team if not exists
    await prisma.team.upsert({
      where: {
        leagueId_userId: {
          leagueId: league.id,
          userId: auth.user.id
        }
      },
      update: {},
      create: {
        leagueId: league.id,
        userId: auth.user.id,
        budget: 100.0
      }
    });

    return { leagueId: league.id, name: league.name, joinCode: league.joinCode };
  });

  // --- Market & Lineup ---

  app.post("/team/market", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const { leagueId, driverIdIn, driverIdOut } = (req.body ?? {}) as {
      leagueId: string;
      driverIdIn?: string;
      driverIdOut?: string;
    };

    if (!leagueId) return reply.code(400).send({ error: "missing_leagueId" });

    // 1. Get current team and ALL drivers (for prices)
    const [team, allDrivers] = await Promise.all([
      prisma.team.findUnique({
        where: { leagueId_userId: { leagueId, userId: auth.user.id } },
        include: { drivers: true }
      }),
      (prisma as any).driver.findMany()
    ]);

    if (!team) return reply.code(404).send({ error: "team_not_found" });

    // 2. Validate move
    let newBudget = team.budget;
    const currentDriverIds = team.drivers.map(d => d.driverId);

    // SELL logic
    if (driverIdOut) {
      if (!currentDriverIds.includes(driverIdOut)) return reply.code(400).send({ error: "not_owned" });
      const p = (allDrivers as any[]).find(d => d.id === driverIdOut);
      if (!p) return reply.code(400).send({ error: "invalid_driver_out" });
      newBudget += p.price;
    }

    // BUY logic
    if (driverIdIn) {
      if (currentDriverIds.includes(driverIdIn) && driverIdIn !== driverIdOut) return reply.code(400).send({ error: "already_owned" });
      const p = (allDrivers as any[]).find(d => d.id === driverIdIn);
      if (!p) return reply.code(400).send({ error: "invalid_driver_in" });
      if (newBudget < p.price) return reply.code(400).send({ error: "insufficient_budget" });
      newBudget -= p.price;
    }

    // Team size check (max 5)
    const currentCount = currentDriverIds.length;
    let netChange = 0;
    if (driverIdOut) netChange--;
    if (driverIdIn) netChange++;
    if (currentCount + netChange > 5) return reply.code(400).send({ error: "team_full" });

    // 3. Apply changes (Transaction)
    await prisma.$transaction(async (tx) => {
      if (driverIdOut) {
        await tx.teamDriver.delete({
          where: { teamId_driverId: { teamId: team.id, driverId: driverIdOut } }
        });
      }
      if (driverIdIn) {
        await tx.teamDriver.create({
          data: { teamId: team.id, driverId: driverIdIn }
        });
      }
      await tx.team.update({
        where: { id: team.id },
        data: { budget: newBudget }
      });
    });

    return { ok: true, newBudget };
  });

  app.post("/team/lineup", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const { leagueId, captainId, reserveId } = (req.body ?? {}) as {
      leagueId: string;
      captainId?: string;
      reserveId?: string;
    };

    if (!leagueId) return reply.code(400).send({ error: "missing_leagueId" });

    // 1. Validate Lock (current race)
    const races = await prisma.race.findMany({ orderBy: { round: 'asc' } });
    const now = new Date();
    // Simple lock: find first incomplete race
    const nextRace = races.find(r => !r.isCompleted) || races[races.length - 1];
    
    // Lock logic: 5 mins before Quali or Sprint Quali
    if (nextRace) {
      const sessionStr = nextRace.isSprint ? nextRace.sprintQualifyingUtc : nextRace.qualifyingUtc;
      if (sessionStr) {
        const lockDate = new Date(new Date(sessionStr).getTime() - 5 * 60 * 1000);
        if (now > lockDate) return reply.code(403).send({ error: "lineup_locked" });
      }
    }

    // 2. Update roles
    await prisma.team.update({
      where: { leagueId_userId: { leagueId, userId: auth.user.id } },
      data: { 
        captainId: captainId ?? null, 
        reserveId: reserveId ?? null 
      }
    });

    return { ok: true };
  });

  app.post("/admin/drivers", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    // Simple role check (for now, eventually use leagueMember.role)
    const membership = await prisma.leagueMember.findFirst({
      where: { userId: auth.user.id, role: "ADMIN" }
    });
    if (!membership) return reply.code(403).send({ error: "not_admin" });

    const { updates } = (req.body ?? {}) as {
      updates: { id: string; price?: number; points?: number }[];
    };

    if (!updates || !Array.isArray(updates)) {
      return reply.code(400).send({ error: "invalid_updates" });
    }

    await prisma.$transaction(
      updates.map((u) =>
        (prisma as any).driver.update({
          where: { id: u.id },
          data: {
            price: u.price,
            points: u.points
          }
        })
      )
    );

    return { ok: true };
  });

  app.post("/admin/sync-race", async (req, reply) => {
    const auth = await requireUser(req, reply);
    if (!auth.ok) return auth.replied;

    const membership = await prisma.leagueMember.findFirst({
      where: { userId: auth.user.id, role: "ADMIN" }
    });
    if (!membership) return reply.code(403).send({ error: "not_admin" });

    const { raceId } = (req.body ?? {}) as { raceId: string };
    if (!raceId) return reply.code(400).send({ error: "missing_raceId" });

    try {
      const classification = await syncRaceResults(prisma, raceId);
      return { ok: true, classification };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  const host = "0.0.0.0";
  const port = Number(process.env.PORT ?? 3001);

  await app.listen({ host, port });
  app.log.info(`API listening on http://${host}:${port}`);
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
