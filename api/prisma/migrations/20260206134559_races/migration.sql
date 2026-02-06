-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "season" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "isSprint" BOOLEAN NOT NULL DEFAULT false,
    "qualifyingUtc" TIMESTAMP(3),
    "sprintQualifyingUtc" TIMESTAMP(3),

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);
