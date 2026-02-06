import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "crypto";

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

async function start() {
  await app.register(cors, {
    origin: true,
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

  app.post("/leagues", async (req, reply) => {
    const token = getBearerToken(req.headers["authorization"]);
    if (!token) return reply.code(401).send({ error: "missing_token" });

    const user = await prisma.user.findUnique({ where: { authToken: token } });
    if (!user) return reply.code(401).send({ error: "invalid_token" });

    const body = (req.body ?? {}) as { name?: string };
    const name = (body.name?.trim() || "League").slice(0, 64);

    const joinCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    const league = await prisma.league.create({
      data: {
        name,
        joinCode,
        members: {
          create: {
            userId: user.id,
            role: "ADMIN",
          },
        },
      },
      select: { id: true, name: true, joinCode: true },
    });

    return league;
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
