-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'agent',
ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE INDEX "Agent_ownerId_idx" ON "Agent"("ownerId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

