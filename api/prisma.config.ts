import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: `prisma+postgres://localhost:51213/?api_key=${process.env["api_key"]}`,
  },
});
