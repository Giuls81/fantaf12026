/*
  Warnings:

  - Added the required column `date` to the `Race` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "League" ADD COLUMN     "rules" JSONB;

-- AlterTable
ALTER TABLE "Race" ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "isCompleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "totalPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "budget" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "password" TEXT;

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "constructorId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamResult" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "captainId" TEXT,
    "reserveId" TEXT,

    CONSTRAINT "TeamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamResultDriver" (
    "id" TEXT NOT NULL,
    "teamResultId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TeamResultDriver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamResult_raceId_idx" ON "TeamResult"("raceId");

-- CreateIndex
CREATE INDEX "TeamResult_teamId_idx" ON "TeamResult"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamResult_raceId_teamId_key" ON "TeamResult"("raceId", "teamId");

-- CreateIndex
CREATE INDEX "TeamResultDriver_teamResultId_idx" ON "TeamResultDriver"("teamResultId");

-- CreateIndex
CREATE INDEX "TeamResultDriver_driverId_idx" ON "TeamResultDriver"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamResultDriver_teamResultId_driverId_key" ON "TeamResultDriver"("teamResultId", "driverId");

-- CreateIndex
CREATE INDEX "TeamDriver_driverId_idx" ON "TeamDriver"("driverId");

-- AddForeignKey
ALTER TABLE "TeamDriver" ADD CONSTRAINT "TeamDriver_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResult" ADD CONSTRAINT "TeamResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResult" ADD CONSTRAINT "TeamResult_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResultDriver" ADD CONSTRAINT "TeamResultDriver_teamResultId_fkey" FOREIGN KEY ("teamResultId") REFERENCES "TeamResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResultDriver" ADD CONSTRAINT "TeamResultDriver_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
