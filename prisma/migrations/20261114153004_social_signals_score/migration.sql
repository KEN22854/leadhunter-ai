-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeadSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "runId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT '',
    "authorUrl" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "language" TEXT NOT NULL DEFAULT '',
    "budget" TEXT NOT NULL DEFAULT '',
    "matchedTerms" JSONB,
    "intent" TEXT NOT NULL DEFAULT 'unknown',
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "intentReasons" JSONB,
    "aiIntent" JSONB,
    "serviceMatch" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreFactors" JSONB,
    "temperature" TEXT NOT NULL DEFAULT 'potential',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SocialLead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadSignal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SignalCampaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeadSignal" ("aiIntent", "authorName", "authorUrl", "budget", "campaignId", "createdAt", "externalId", "id", "intent", "intentReasons", "intentScore", "language", "leadId", "matchedTerms", "ownerId", "publishedAt", "runId", "serviceMatch", "source", "text", "title", "url") SELECT "aiIntent", "authorName", "authorUrl", "budget", "campaignId", "createdAt", "externalId", "id", "intent", "intentReasons", "intentScore", "language", "leadId", "matchedTerms", "ownerId", "publishedAt", "runId", "serviceMatch", "source", "text", "title", "url" FROM "LeadSignal";
DROP TABLE "LeadSignal";
ALTER TABLE "new_LeadSignal" RENAME TO "LeadSignal";
CREATE INDEX "LeadSignal_leadId_idx" ON "LeadSignal"("leadId");
CREATE INDEX "LeadSignal_campaignId_createdAt_idx" ON "LeadSignal"("campaignId", "createdAt");
CREATE UNIQUE INDEX "LeadSignal_ownerId_source_externalId_key" ON "LeadSignal"("ownerId", "source", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
