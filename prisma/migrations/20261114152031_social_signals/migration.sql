-- CreateTable
CREATE TABLE "SignalCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "languages" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "excludeWords" JSONB,
    "businessType" TEXT NOT NULL DEFAULT '',
    "orderType" TEXT NOT NULL DEFAULT 'any',
    "periodDays" INTEGER NOT NULL DEFAULT 14,
    "maxResults" INTEGER NOT NULL DEFAULT 100,
    "minScore" INTEGER NOT NULL DEFAULT 40,
    "schedule" TEXT NOT NULL DEFAULT 'once',
    "feeds" JSONB,
    "channels" JSONB,
    "useAI" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SignalCampaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'running',
    "stats" JSONB,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "saved" INTEGER NOT NULL DEFAULT 0,
    "newLeads" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "SignalRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SignalCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SocialLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "profileUrl" TEXT NOT NULL DEFAULT '',
    "primarySource" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "service" TEXT NOT NULL DEFAULT '',
    "intent" TEXT NOT NULL DEFAULT 'unknown',
    "temperature" TEXT NOT NULL DEFAULT 'potential',
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreFactors" JSONB,
    "scoreExplanation" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstContactAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadIdentity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SocialLead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadSignal" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SocialLead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadSignal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SignalCampaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "signalId" TEXT,
    "generationId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "evidence" JSONB,
    "warnings" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'ai',
    "model" TEXT NOT NULL DEFAULT '',
    "promptVersion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutreachDraft_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SocialLead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "draftId" TEXT,
    "signalId" TEXT,
    "mode" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "outcome" TEXT NOT NULL DEFAULT 'none',
    "error" TEXT NOT NULL DEFAULT '',
    "outboundId" TEXT,
    "idempotencyKey" TEXT,
    "preparedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" DATETIME,
    "sentAt" DATETIME,
    "repliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutreachAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SocialLead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessingLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT,
    "subject" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SourceState" (
    "source" TEXT NOT NULL PRIMARY KEY,
    "lastRequestAt" DATETIME,
    "lastOkAt" DATETIME,
    "lastErrorAt" DATETIME,
    "lastError" TEXT NOT NULL DEFAULT '',
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "backoffUntil" DATETIME,
    "requestsToday" INTEGER NOT NULL DEFAULT 0,
    "dayKey" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SignalCampaign_ownerId_status_idx" ON "SignalCampaign"("ownerId", "status");

-- CreateIndex
CREATE INDEX "SignalCampaign_status_nextRunAt_idx" ON "SignalCampaign"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "SignalRun_campaignId_startedAt_idx" ON "SignalRun"("campaignId", "startedAt");

-- CreateIndex
CREATE INDEX "SocialLead_ownerId_temperature_score_idx" ON "SocialLead"("ownerId", "temperature", "score");

-- CreateIndex
CREATE INDEX "SocialLead_ownerId_status_idx" ON "SocialLead"("ownerId", "status");

-- CreateIndex
CREATE INDEX "LeadIdentity_leadId_idx" ON "LeadIdentity"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadIdentity_ownerId_kind_value_key" ON "LeadIdentity"("ownerId", "kind", "value");

-- CreateIndex
CREATE INDEX "LeadSignal_leadId_idx" ON "LeadSignal"("leadId");

-- CreateIndex
CREATE INDEX "LeadSignal_campaignId_createdAt_idx" ON "LeadSignal"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSignal_ownerId_source_externalId_key" ON "LeadSignal"("ownerId", "source", "externalId");

-- CreateIndex
CREATE INDEX "OutreachDraft_leadId_createdAt_idx" ON "OutreachDraft"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachAttempt_idempotencyKey_key" ON "OutreachAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutreachAttempt_leadId_idx" ON "OutreachAttempt"("leadId");

-- CreateIndex
CREATE INDEX "OutreachAttempt_status_idx" ON "OutreachAttempt"("status");

-- CreateIndex
CREATE INDEX "ProcessingLog_ownerId_createdAt_idx" ON "ProcessingLog"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessingLog_leadId_idx" ON "ProcessingLog"("leadId");
