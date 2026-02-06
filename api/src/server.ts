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

  const host = "0.0.0.0";
  const port = Number(process.env.PORT ?? 3001);

  await app.listen({ host, port });
  app.log.info(`API listening on http://${host}:${port}`);
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
