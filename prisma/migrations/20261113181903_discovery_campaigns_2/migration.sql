-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchResult_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SearchResult" ("address", "audit", "auditScore", "category", "city", "clientId", "country", "createdAt", "emails", "enrichError", "enrichStatus", "enrichedAt", "externalId", "id", "lat", "lon", "name", "ownerId", "phone", "searchId", "website") SELECT "address", "audit", "auditScore", "category", "city", "clientId", "country", "createdAt", "emails", "enrichError", "enrichStatus", "enrichedAt", "externalId", "id", "lat", "lon", "name", "ownerId", "phone", "searchId", "website" FROM "SearchResult";
DROP TABLE "SearchResult";
ALTER TABLE "new_SearchResult" RENAME TO "SearchResult";
CREATE INDEX "SearchResult_ownerId_enrichStatus_idx" ON "SearchResult"("ownerId", "enrichStatus");
CREATE UNIQUE INDEX "SearchResult_searchId_externalId_key" ON "SearchResult"("searchId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
