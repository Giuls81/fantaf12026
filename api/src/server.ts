import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

async function start() {
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.get("/health", async () => {
    return { ok: true };
  });

  const host = "0.0.0.0";
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ host, port });
  app.log.info(`API listening on http://${host}:${port}`);
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
