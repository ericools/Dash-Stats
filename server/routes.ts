import type { Express } from "express";
import { createServer, type Server } from "http";
import {
  fetchPlatformStatus,
  fetchPlatformValidators,
  fetchPlatformGasHistory,
  fetchPlatformTxHistory,
  fetchRecentPlatformEpochs,
  fetchCoreStatus,
  syncNewCoreBlocks,
  startCoreBackfill,
  syncAllPlatformEpochs,
  getCachedCoreFeeSeries,
  getCachedPlatformFeeSeries,
  getCoreHeightRange,
  getBackfillProgress,
  creditsToDash,
  fetchDashPriceUsd,
  fetchMasternodeCounts,
  saveMasternodeCounts,
  getBlockSubsidy,
} from "./dashService";
import { log } from "./index";
import { db } from "./db";
import { coreBlockFees } from "@shared/schema";

function rangeToSeconds(range: string): number {
  switch (range) {
    case "day": return 86400;
    case "week": return 7 * 86400;
    case "month": return 30 * 86400;
    case "year": return 365 * 86400;
    default: return 86400;
  }
}

function rangeToTimespan(range: string): string {
  switch (range) {
    case "day": return "24h";
    case "week": return "1w";
    case "month": return "1m";
    case "year": return "1y";
    default: return "24h";
  }
}

function getBucketKey(timestamp: number, range: string): number {
  const d = new Date(timestamp * 1000);
  switch (range) {
    case "day":
      d.setMinutes(0, 0, 0);
      return d.getTime();
    case "week":
    case "month":
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    case "year":
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    default:
      d.setMinutes(0, 0, 0);
      return d.getTime();
  }
}

interface AggregatedBlock {
  t: number;
  fees: number;
  reward: number;
  height: number;
  txCount: number;
  blockCount: number;
}

function aggregateCoreBlocks(
  blocks: Array<{ time: number; totalFees: number; reward: number; height: number; txCount: number }>,
  range: string
): AggregatedBlock[] {
  const buckets = new Map<number, AggregatedBlock>();
  for (const b of blocks) {
    const key = getBucketKey(b.time, range);
    const existing = buckets.get(key);
    if (existing) {
      existing.fees += b.totalFees;
      existing.reward += b.reward;
      existing.txCount += b.txCount;
      existing.blockCount++;
      existing.height = Math.max(existing.height, b.height);
    } else {
      buckets.set(key, {
        t: key,
        fees: b.totalFees,
        reward: b.reward,
        height: b.height,
        txCount: b.txCount,
        blockCount: 1,
      });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/platform/status", async (_req, res) => {
    try {
      const [status, validators] = await Promise.all([
        fetchPlatformStatus(),
        fetchPlatformValidators(),
      ]);
      res.json({ status, validators });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/platform/epochs", async (req, res) => {
    try {
      const count = Math.min(parseInt(req.query.count as string) || 20, 100);
      const epochs = await fetchRecentPlatformEpochs(count);
      const mapped = epochs
        .filter((e: any) => e?.epoch)
        .map((e: any) => ({
          number: e.epoch.number,
          startTime: Number(e.epoch.startTime),
          endTime: Number(e.epoch.endTime),
          totalCollectedFees: Number(e.totalCollectedFees || 0),
          totalCollectedFeesDash: creditsToDash(Number(e.totalCollectedFees || 0)),
          feeMultiplier: Number(e.epoch.feeMultiplier || 1),
          tps: e.tps || 0,
        }))
        .sort((a: any, b: any) => a.startTime - b.startTime);
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/platform/gas-history", async (req, res) => {
    try {
      const range = (req.query.range as string) || "day";
      const timespan = rangeToTimespan(range);
      const data = await fetchPlatformGasHistory(timespan);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/platform/tx-history", async (req, res) => {
    try {
      const range = (req.query.range as string) || "day";
      const timespan = rangeToTimespan(range);
      const data = await fetchPlatformTxHistory(timespan);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/core/status", async (_req, res) => {
    try {
      const data = await fetchCoreStatus();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/core/fees", async (req, res) => {
    try {
      const range = (req.query.range as string) || "day";
      const sinceTs = Math.floor(Date.now() / 1000) - rangeToSeconds(range);
      const series = await getCachedCoreFeeSeries(sinceTs);
      res.json(series);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/platform/fees", async (req, res) => {
    try {
      const range = (req.query.range as string) || "day";
      const sinceTs = (Date.now() - rangeToSeconds(range) * 1000);
      const series = await getCachedPlatformFeeSeries(sinceTs);
      const mapped = series.map((e) => ({
        ...e,
        totalCollectedFeesDash: creditsToDash(e.totalCollectedFees),
      }));
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sync/status", async (_req, res) => {
    try {
      const [heightRange, progress] = await Promise.all([
        getCoreHeightRange(),
        Promise.resolve(getBackfillProgress()),
      ]);
      res.json({
        coreBlocks: heightRange,
        backfill: progress,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/dashboard", async (req, res) => {
    try {
      const range = (req.query.range as string) || "day";
      const timespan = rangeToTimespan(range);
      const sinceCoreTsSeconds = Math.floor(Date.now() / 1000) - rangeToSeconds(range);
      const sincePlatformTsMs = Date.now() - rangeToSeconds(range) * 1000;

      const [
        platformStatus,
        validators,
        coreFees,
        platformFees,
        gasHistory,
        heightRange,
        dashPriceUsd,
        mnCounts,
      ] = await Promise.all([
        fetchPlatformStatus(),
        fetchPlatformValidators(),
        getCachedCoreFeeSeries(sinceCoreTsSeconds),
        getCachedPlatformFeeSeries(sincePlatformTsMs),
        fetchPlatformGasHistory(timespan),
        getCoreHeightRange(),
        fetchDashPriceUsd(),
        fetchMasternodeCounts(),
      ]);

      const totalCoreFees = coreFees.reduce((sum, b) => sum + b.totalFees, 0);
      const totalCoreRewards = coreFees.reduce((sum, b) => sum + b.reward, 0);

      const totalPlatformCredits = platformFees.reduce(
        (sum, e) => sum + e.totalCollectedFees,
        0
      );
      const totalPlatformFeesDash = creditsToDash(totalPlatformCredits);

      const totalCreditsOnPlatform = platformStatus?.totalCredits || 0;
      const totalCreditsOnPlatformDash = creditsToDash(totalCreditsOnPlatform);

      const evoCount = mnCounts.evoNodes || 1;
      const totalValidators = validators.total || 1;
      const totalMasternodes = mnCounts.totalMasternodes || 3700;
      const regularMasternodes = totalMasternodes - evoCount;

      const corePayPerNode = totalMasternodes > 0 ? totalCoreFees / totalMasternodes : 0;
      const payoutPerMasternode = corePayPerNode;
      const payoutPerEvo = corePayPerNode + (totalPlatformFeesDash / evoCount);

      const aggregated = aggregateCoreBlocks(coreFees, range);
      const coreFeeSeries = aggregated.map((b) => ({
        t: b.t,
        fees: b.fees,
        reward: b.reward,
        height: b.height,
        txCount: b.txCount,
        blockCount: b.blockCount,
      }));

      const platformFeeSeries = platformFees.map((e) => ({
        t: e.startTime,
        fees: creditsToDash(e.totalCollectedFees),
        epochNumber: e.epochNumber,
      }));

      const platformGasSeries = (gasHistory || []).map((g: any) => ({
        t: new Date(g.timestamp).getTime(),
        gas: g.data?.gas || 0,
        blockHeight: g.data?.blockHeight || 0,
      }));

      res.json({
        totals: {
          totalCoreFees,
          totalCoreRewards,
          totalPlatformFeesDash,
          totalCreditsOnPlatformDash,
          totalMasternodes,
          regularMasternodes,
          evoCount,
          totalValidators,
          payoutPerMasternode,
          payoutPerEvo,
        },
        dashPriceUsd,
        coreFeeSeries,
        platformFeeSeries,
        platformGasSeries,
        platformStatus,
        coreHeight: heightRange.max,
        coreBlocksCached: heightRange.count,
        backfillProgress: getBackfillProgress(),
        range,
      });
    } catch (err: any) {
      log(`Dashboard error: ${err.message}`, "routes");
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sankey", async (_req, res) => {
    try {
      const BLOCKS_PER_MONTH = 17280;

      const [heightRange, dashPriceUsd, mnCounts, coreFees, platformFees] = await Promise.all([
        getCoreHeightRange(),
        fetchDashPriceUsd(),
        fetchMasternodeCounts(),
        getCachedCoreFeeSeries(Math.floor(Date.now() / 1000) - 30 * 86400),
        getCachedPlatformFeeSeries(Date.now() - 30 * 86400 * 1000),
      ]);

      const currentHeight = heightRange.max || 2420000;
      const subsidy = getBlockSubsidy(currentHeight);

      const monthlyMinedCoins = subsidy * BLOCKS_PER_MONTH;
      const monthlyCoreFees = coreFees.reduce((s, b) => s + b.totalFees, 0);
      const monthlyPlatformCredits = platformFees.reduce((s, e) => s + e.totalCollectedFees, 0);
      const monthlyPlatformFees = creditsToDash(monthlyPlatformCredits);

      const totalReward = monthlyMinedCoins + monthlyCoreFees;

      const toMiners = totalReward * 0.20;
      const toMasternodes = totalReward * 0.60;
      const toDao = totalReward * 0.20;

      const masternodeRewards = toMasternodes * 0.625;
      const platformCreditPool = toMasternodes * 0.375;

      const regularCount = mnCounts.totalMasternodes - mnCounts.evoNodes;
      const evoCount = mnCounts.evoNodes;

      const totalMN = regularCount + evoCount;
      const regularFraction = totalMN > 0 ? regularCount / totalMN : 0.5;
      const evoFraction = totalMN > 0 ? evoCount / totalMN : 0.5;

      const toStandardMN = masternodeRewards * regularFraction;
      const toEvoFromRewards = masternodeRewards * evoFraction;
      const toEvoTotal = toEvoFromRewards + platformCreditPool + monthlyPlatformFees;

      const platformCreditPoolTotal = platformCreditPool + monthlyPlatformFees;

      res.json({
        monthlyMinedCoins,
        monthlyCoreFees,
        monthlyPlatformFees,
        totalReward,
        toMiners,
        toMasternodes,
        toDao,
        masternodeRewards,
        platformCreditPool: platformCreditPoolTotal,
        toStandardMN,
        toEvoFromRewards,
        toEvoTotal,
        dashPriceUsd,
        currentHeight,
        subsidy,
        regularMasternodes: regularCount,
        evoNodes: evoCount,
        generatedAt: Date.now(),
      });
    } catch (err: any) {
      log(`Sankey error: ${err.message}`, "routes");
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/import-backfill", async (_req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const candidates = [
        path.join(process.cwd(), "server", "backfill-data.json"),
        path.join(process.cwd(), "dist", "backfill-data.json"),
        path.join(process.cwd(), "backfill-data.json"),
      ];
      let filePath = "";
      for (const c of candidates) {
        if (fs.existsSync(c)) { filePath = c; break; }
      }
      if (!filePath) {
        return res.status(404).json({ error: "No backfill data file found", checked: candidates });
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const rows = JSON.parse(raw) as Array<{
        hash: string;
        height: number;
        time: number;
        totalFees: number;
        reward: number;
        txCount: number;
      }>;

      let inserted = 0;
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const values = chunk.map((r) => ({
          hash: r.hash,
          height: r.height,
          time: r.time,
          totalFees: r.totalFees,
          reward: r.reward,
          txCount: r.txCount,
        }));
        await db.insert(coreBlockFees).values(values).onConflictDoNothing();
        inserted += chunk.length;
      }

      res.json({ imported: inserted, total: rows.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sync", async (_req, res) => {
    try {
      const coreCount = await syncNewCoreBlocks();
      res.json({ synced: { coreBlocks: coreCount } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  syncAllPlatformEpochs().catch(() => {});

  async function seedAndBackfill() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const count = await syncNewCoreBlocks().catch(() => 0);
      if (count > 0) break;
      log(`Seed attempt ${attempt + 1}: waiting to retry...`, "dashService");
      await new Promise(r => setTimeout(r, 5000 + attempt * 3000));
    }
    startCoreBackfill().catch((err: any) => log(`Backfill start error: ${err.message}`, "dashService"));
  }
  seedAndBackfill();

  setInterval(() => {
    syncNewCoreBlocks().catch(() => {});
  }, 5 * 60 * 1000);

  setInterval(() => {
    syncAllPlatformEpochs().catch(() => {});
  }, 15 * 60 * 1000);

  return httpServer;
}
