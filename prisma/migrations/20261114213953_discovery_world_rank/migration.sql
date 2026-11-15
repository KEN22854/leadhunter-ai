-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeadSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "osmFilter" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "scope" TEXT NOT NULL DEFAULT 'city',
    "limitN" INTEGER NOT NULL DEFAULT 0,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "heartbeatAt" DATETIME,
    "total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "LeadSearch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LeadSearch" ("category", "categoryLabel", "city", "country", "createdAt", "error", "finishedAt", "id", "osmFilter", "ownerId", "status", "total") SELECT "category", "categoryLabel", "city", "country", "createdAt", "error", "finishedAt", "id", "osmFilter", "ownerId", "status", "total" FROM "LeadSearch";
DROP TABLE "LeadSearch";
ALTER TABLE "new_LeadSearch" RENAME TO "LeadSearch";
CREATE INDEX "LeadSearch_ownerId_createdAt_idx" ON "LeadSearch"("ownerId", "createdAt");
CREATE TABLE "new_SearchResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "searchId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "lat" REAL,
    "lon" REAL,
    "website" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "hasSocial" BOOLEAN NOT NULL DEFAULT false,
    "emails" JSONB,
    "enrichStatus" TEXT NOT NULL DEFAULT 'pending',
    "enrichError" TEXT NOT NULL DEFAULT '',
    "audit" JSONB,
    "auditScore" INTEGER,
    "enrichedAt" DATETIME,
    "clientId" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "rankNote" TEXT NOT NULL DEFAULT '',
    "importance" REAL,
    "hasEmail" BOOLEAN NOT NULL DEFAULT false,
    "hasWebsite" BOOLEAN NOT NULL DEFAULT false,
    "opportunity" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchResult_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SearchResult" ("address", "audit", "auditScore", "category", "city", "clientId", "country", "createdAt", "emails", "enrichError", "enrichStatus", "enrichedAt", "externalId", "hasSocial", "id", "lat", "lon", "name", "ownerId", "phone", "searchId", "website") SELECT "address", "audit", "auditScore", "category", "city", "clientId", "country", "createdAt", "emails", "enrichError", "enrichStatus", "enrichedAt", "externalId", "hasSocial", "id", "lat", "lon", "name", "ownerId", "phone", "searchId", "website" FROM "SearchResult";
DROP TABLE "SearchResult";
ALTER TABLE "new_SearchResult" RENAME TO "SearchResult";
CREATE INDEX "SearchResult_ownerId_enrichStatus_idx" ON "SearchResult"("ownerId", "enrichStatus");
CREATE INDEX "SearchResult_searchId_rank_idx" ON "SearchResult"("searchId", "rank");
CREATE INDEX "SearchResult_enrichStatus_rank_idx" ON "SearchResult"("enrichStatus", "rank");
CREATE UNIQUE INDEX "SearchResult_searchId_externalId_key" ON "SearchResult"("searchId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
