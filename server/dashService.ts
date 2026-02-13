import { log } from "./index";
import { db } from "./db";
import { coreBlockFees, platformEpochFees, syncState } from "@shared/schema";
import { desc, gte, lte, asc, eq, sql } from "drizzle-orm";

const INSIGHT_BASE = "https://insight.dash.org/insight-api";
const PLATFORM_BASE = "https://platform-explorer.pshenmic.dev";

const CREDITS_PER_DASH = 100_000_000_000;
const SATOSHIS_PER_DASH = 100_000_000;

const JAN_1_2026_UNIX = 1767225600;

let backfillRunning = false;
let backfillProgress = { totalNeeded: 0, totalDone: 0, oldestHeight: 0, targetHeight: 0, status: "idle" as string };
let rpcAvailable: boolean | null = null;

let cachedDashPrice: { usd: number; fetchedAt: number } | null = null;
const PRICE_CACHE_MS = 120_000;

export async function fetchDashPriceUsd(): Promise<number> {
  if (cachedDashPrice && Date.now() - cachedDashPrice.fetchedAt < PRICE_CACHE_MS) {
    return cachedDashPrice.usd;
  }
  try {
    const data = await fetchJson("https://coincodex.com/api/coincodex/get_coin/dash", 10_000);
    const price = parseFloat(data?.last_price_usd) || 0;
    if (price > 0) {
      cachedDashPrice = { usd: price, fetchedAt: Date.now() };
    }
    return price;
  } catch (err: any) {
    log(`Dash price fetch error: ${err.message}`, "dashService");
    return cachedDashPrice?.usd || 0;
  }
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "DashPlatformStats/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function getRpcConfig() {
  const rawUrl = process.env.DASH_RPC_URL || "";
  const url = rawUrl.startsWith("http") ? rawUrl : "http://" + rawUrl;
  const user = process.env.DASH_RPC_USER || "";
  const pass = process.env.DASH_RPC_PASSWORD || "";
  const hasPort = rawUrl.replace(/^https?:\/\//, "").includes(":");
  const finalUrl = hasPort ? url : url + ":9998";
  return { url: finalUrl, user, pass, configured: !!(rawUrl && user && pass) };
}

async function rpcCall(method: string, params: any[] = [], timeoutMs = 30_000): Promise<any> {
  const config = getRpcConfig();
  if (!config.configured) throw new Error("RPC not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(config.user + ":" + config.pass).toString("base64"),
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: Date.now(), method, params }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function checkRpcAvailability(): Promise<boolean> {
  if (rpcAvailable !== null) return rpcAvailable;
  const config = getRpcConfig();
  if (!config.configured) {
    rpcAvailable = false;
    return false;
  }
  try {
    await rpcCall("getblockcount", [], 8000);
    rpcAvailable = true;
    log("Dash Core RPC connected successfully", "dashService");
    return true;
  } catch (err: any) {
    rpcAvailable = false;
    log(`Dash Core RPC unavailable: ${err.message} — falling back to Insight API`, "dashService");
    return false;
  }
}

setInterval(() => {
  if (!rpcAvailable) {
    rpcAvailable = null;
  }
}, 5 * 60 * 1000);

async function getSyncValue(key: string): Promise<string | null> {
  const rows = await db.select().from(syncState).where(eq(syncState.key, key));
  return rows.length > 0 ? rows[0].value : null;
}

async function setSyncValue(key: string, value: string): Promise<void> {
  await db.insert(syncState).values({
    key,
    value,
    updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: syncState.key,
    set: { value, updatedAt: Date.now() },
  });
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchPlatformStatus() {
  try {
    const data = await fetchJson(`${PLATFORM_BASE}/status`);
    return {
      epoch: data.epoch,
      totalCredits: Number(data.totalCredits),
      totalCollectedFeesDay: Number(data.totalCollectedFeesDay),
      transactionsCount: data.transactionsCount,
      identitiesCount: data.identitiesCount,
      dataContractsCount: data.dataContractsCount,
      documentsCount: data.documentsCount,
      network: data.network,
      tenderdashHeight: data.tenderdash?.block?.height,
    };
  } catch (err: any) {
    log(`Platform status fetch error: ${err.message}`, "dashService");
    return null;
  }
}

export async function fetchPlatformEpoch(epochNumber?: number) {
  try {
    const url = epochNumber != null
      ? `${PLATFORM_BASE}/epoch/${epochNumber}`
      : `${PLATFORM_BASE}/epoch`;
    return await fetchJson(url);
  } catch (err: any) {
    log(`Platform epoch fetch error: ${err.message}`, "dashService");
    return null;
  }
}

export async function fetchPlatformValidators() {
  try {
    const data = await fetchJson(`${PLATFORM_BASE}/validators?isActive=true&limit=0`);
    const validators = data.resultSet || [];
    const total = data.pagination?.total || validators.length;

    let evoCount = 0;
    let regularCount = 0;
    for (const v of validators) {
      if (v.proTxInfo?.type === "Evo") {
        evoCount++;
      } else {
        regularCount++;
      }
    }

    return { total, evoCount, regularCount, validators };
  } catch (err: any) {
    log(`Platform validators fetch error: ${err.message}`, "dashService");
    return { total: 0, evoCount: 0, regularCount: 0, validators: [] };
  }
}

let cachedMnCounts: { total: number; enabled: number; evoTotal: number; evoEnabled: number; fetchedAt: number } | null = null;
const MN_COUNT_CACHE_MS = 300_000;

export async function fetchMasternodeCounts(): Promise<{ totalMasternodes: number; evoNodes: number }> {
  if (cachedMnCounts && Date.now() - cachedMnCounts.fetchedAt < MN_COUNT_CACHE_MS) {
    return { totalMasternodes: cachedMnCounts.enabled, evoNodes: cachedMnCounts.evoEnabled };
  }

  try {
    const dcData = await fetchJson("https://www.dashcentral.org/api/v1/public");
    const unique = dcData?.general?.consensus_masternodes || 0;
    const weighted = dcData?.general?.consensus_masternodes_weighted || 0;
    if (unique > 0 && weighted > 0) {
      const evoCount = Math.round((weighted - unique) / 3);
      cachedMnCounts = { total: unique, enabled: unique, evoTotal: evoCount, evoEnabled: evoCount, fetchedAt: Date.now() };
      log(`DashCentral MN count: ${unique} unique, ${weighted} weighted, ${evoCount} EVO nodes`, "dashService");
      return { totalMasternodes: unique, evoNodes: evoCount };
    }
  } catch (err: any) {
    log(`DashCentral API failed: ${err.message}`, "dashService");
  }

  const useRpc = await checkRpcAvailability();
  if (useRpc) {
    try {
      const countResult = await rpcCall("masternode", ["count"]);
      const total = countResult?.total || 0;
      const enabled = countResult?.enabled || countResult?.stable || total;

      let evoEnabled = 0;
      const protxList = await rpcCall("protx", ["list", "registered", true]);
      if (Array.isArray(protxList)) {
        for (const entry of protxList) {
          const isEvo = entry.type === 1 || entry.type === "evo" || entry.state?.type === 1;
          if (isEvo && (entry.state?.status === 0 || entry.state?.PoSePenalty === 0)) {
            evoEnabled++;
          }
        }
      }

      cachedMnCounts = { total, enabled, evoTotal: evoEnabled, evoEnabled, fetchedAt: Date.now() };
      log(`RPC MN count: ${enabled} total MNs, ${evoEnabled} EVO nodes`, "dashService");
      return { totalMasternodes: enabled, evoNodes: evoEnabled };
    } catch (err: any) {
      log(`RPC masternode count failed: ${err.message}`, "dashService");
    }
  }

  try {
    const dbVal = await getSyncValue("masternode_counts");
    if (dbVal) {
      const parsed = JSON.parse(dbVal);
      if (parsed.evoNodes > 0 && parsed.totalMasternodes > 0) {
        cachedMnCounts = {
          total: parsed.totalMasternodes,
          enabled: parsed.totalMasternodes,
          evoTotal: parsed.evoNodes,
          evoEnabled: parsed.evoNodes,
          fetchedAt: Date.now(),
        };
        return parsed;
      }
    }
  } catch {}

  return { totalMasternodes: 3700, evoNodes: 334 };
}

export async function saveMasternodeCounts(counts: { totalMasternodes: number; evoNodes: number }) {
  await setSyncValue("masternode_counts", JSON.stringify(counts));
}

export async function fetchPlatformTxHistory(timespan: string) {
  try {
    return await fetchJson(`${PLATFORM_BASE}/transactions/history?timespan=${timespan}`);
  } catch (err: any) {
    log(`Platform tx history error: ${err.message}`, "dashService");
    return [];
  }
}

export async function fetchPlatformGasHistory(timespan: string) {
  try {
    return await fetchJson(`${PLATFORM_BASE}/transactions/gas/history?timespan=${timespan}`);
  } catch (err: any) {
    log(`Platform gas history error: ${err.message}`, "dashService");
    return [];
  }
}

export async function fetchCoreStatus(): Promise<{ height: number } | null> {
  const useRpc = await checkRpcAvailability();
  if (useRpc) {
    try {
      const height = await rpcCall("getblockcount");
      return { height };
    } catch (err: any) {
      log(`RPC getblockcount error: ${err.message}`, "dashService");
    }
  }
  try {
    const data = await fetchJson(`${INSIGHT_BASE}/status`);
    if (data?.info?.blocks) return { height: data.info.blocks };
  } catch {}
  try {
    const data = await fetchJson("https://dashblockexplorer.com/api/v2", 10_000);
    if (data?.blockbook?.bestHeight) return { height: data.blockbook.bestHeight };
  } catch {}
  log("All core status sources failed", "dashService");
  return null;
}

interface BlockData {
  hash: string;
  height: number;
  time: number;
  txCount: number;
  totalFees: number;
  subsidy: number;
}

async function fetchBlockViaRpc(height: number): Promise<BlockData | null> {
  try {
    const stats = await rpcCall("getblockstats", [height]);
    return {
      hash: stats.blockhash,
      height: stats.height,
      time: stats.time,
      txCount: stats.txs,
      totalFees: stats.totalfee / SATOSHIS_PER_DASH,
      subsidy: stats.subsidy / SATOSHIS_PER_DASH,
    };
  } catch (err: any) {
    return null;
  }
}

async function fetchBlockViaInsight(height: number): Promise<BlockData | null> {
  try {
    const indexData = await fetchJson(`${INSIGHT_BASE}/block-index/${height}`, 15_000);
    if (!indexData?.blockHash) return null;

    const block = await fetchJson(`${INSIGHT_BASE}/block/${indexData.blockHash}`, 15_000);
    if (!block) return null;

    const subsidy = getBlockSubsidy(block.height);
    const coinbaseSubsidy = isSuperblock(block.height) ? subsidy : subsidy * 0.8;

    let totalFees = 0;
    if (isSuperblock(block.height)) {
      totalFees = 0;
    } else if (block.tx?.[0]) {
      try {
        const cbTx = await fetchJson(`${INSIGHT_BASE}/tx/${block.tx[0]}`, 15_000);
        if (cbTx?.vout) {
          const coinbaseTotal = cbTx.vout.reduce((s: number, v: any) => s + (parseFloat(v.value) || 0), 0);
          totalFees = Math.max(0, coinbaseTotal - coinbaseSubsidy);
        }
      } catch {}
    }

    return {
      hash: block.hash,
      height: block.height,
      time: block.time,
      txCount: block.tx?.length || 0,
      totalFees,
      subsidy: coinbaseSubsidy,
    };
  } catch (err: any) {
    return null;
  }
}

async function fetchBlock(height: number): Promise<BlockData | null> {
  const useRpc = await checkRpcAvailability();
  if (useRpc) {
    const result = await fetchBlockViaRpc(height);
    if (result) return result;
  }
  return fetchBlockViaInsight(height);
}

export function getBlockSubsidy(height: number): number {
  const nSubsidyBase = 5;
  const reductionInterval = 210240;
  const reductions = Math.floor(height / reductionInterval);
  let subsidy = nSubsidyBase;
  for (let i = 0; i < reductions; i++) {
    subsidy = subsidy - subsidy / 14;
  }
  return subsidy;
}

function isSuperblock(height: number): boolean {
  const superblockCycle = 16616;
  return height % superblockCycle === 0;
}

function blockDataToRow(block: BlockData) {
  const fees = isSuperblock(block.height) ? 0 : block.totalFees;
  return {
    hash: block.hash,
    height: block.height,
    time: block.time,
    totalFees: fees,
    reward: block.subsidy + fees,
    txCount: block.txCount,
  };
}

async function insertBlockRow(row: ReturnType<typeof blockDataToRow>): Promise<boolean> {
  try {
    await db.insert(coreBlockFees).values(row).onConflictDoNothing();
    return true;
  } catch {
    return false;
  }
}

export async function syncNewCoreBlocks(): Promise<number> {
  try {
    const [maxRow] = await db.select({ maxH: sql<number>`MAX(${coreBlockFees.height})` }).from(coreBlockFees);
    const highestCached = maxRow?.maxH || 0;

    const status = await fetchCoreStatus();
    if (!status?.height) return 0;
    const currentHeight = status.height;

    if (highestCached && currentHeight <= highestCached) return 0;

    const toFetch = highestCached ? Math.min(currentHeight - highestCached, 50) : 20;
    const startHeight = currentHeight;
    let inserted = 0;

    const useRpc = await checkRpcAvailability();
    const batchSize = useRpc ? 10 : 2;
    const batchDelay = useRpc ? 100 : 2000;

    for (let i = 0; i < toFetch; i += batchSize) {
      const batch: Promise<BlockData | null>[] = [];
      for (let j = i; j < Math.min(i + batchSize, toFetch); j++) {
        batch.push(fetchBlock(startHeight - j));
      }
      const results = await Promise.allSettled(batch);
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          const row = blockDataToRow(r.value);
          if (await insertBlockRow(row)) inserted++;
        }
      }
      if (i + batchSize < toFetch) await delay(batchDelay);
    }

    if (inserted > 0) {
      log(`Forward sync: ${inserted} new core blocks (up to height ${currentHeight})`, "dashService");
    }
    return inserted;
  } catch (err: any) {
    log(`Forward sync error: ${err.message}`, "dashService");
    return 0;
  }
}

export async function startCoreBackfill(): Promise<void> {
  if (backfillRunning) {
    log("Backfill already running, skipping", "dashService");
    return;
  }

  backfillRunning = true;

  try {
    const [minRow] = await db.select({ minH: sql<number>`MIN(${coreBlockFees.height})` }).from(coreBlockFees);
    let oldestCached = minRow?.minH;

    if (!oldestCached) {
      log("No blocks cached yet, cannot start backfill", "dashService");
      backfillRunning = false;
      return;
    }

    const targetHeight = await estimateTargetHeight();
    if (oldestCached <= targetHeight) {
      log(`Backfill complete: oldest block ${oldestCached} <= target ${targetHeight}`, "dashService");
      backfillProgress.status = "complete";
      backfillRunning = false;
      return;
    }

    const totalNeeded = oldestCached - targetHeight;
    backfillProgress = {
      totalNeeded,
      totalDone: 0,
      oldestHeight: oldestCached,
      targetHeight,
      status: "running",
    };

    log(`Starting backfill: ${totalNeeded} blocks from height ${oldestCached} down to ${targetHeight}`, "dashService");

    let currentHeight = oldestCached - 1;
    let consecutiveErrors = 0;
    let totalInserted = 0;

    const useRpc = await checkRpcAvailability();
    const BATCH_SIZE = useRpc ? 20 : 2;
    const DELAY_MS = useRpc ? 50 : 2000;
    const ERROR_BACKOFF = useRpc ? 2000 : 15_000;

    log(`Backfill using ${useRpc ? "Dash Core RPC" : "Insight API"} (batch=${BATCH_SIZE})`, "dashService");

    while (currentHeight >= targetHeight && backfillRunning) {
      const batch: Promise<BlockData | null>[] = [];
      for (let i = 0; i < BATCH_SIZE && currentHeight - i >= targetHeight; i++) {
        batch.push(fetchBlock(currentHeight - i));
      }

      const results = await Promise.allSettled(batch);
      let batchInserted = 0;
      let anyFailed = false;

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          if (r.value.time >= JAN_1_2026_UNIX) {
            const row = blockDataToRow(r.value);
            if (await insertBlockRow(row)) batchInserted++;
          }
        } else {
          anyFailed = true;
        }
      }

      if (anyFailed && batchInserted === 0) {
        consecutiveErrors++;
        const backoff = ERROR_BACKOFF * Math.min(consecutiveErrors, 6);
        log(`Backfill batch failed, backing off ${backoff / 1000}s (attempt ${consecutiveErrors})`, "dashService");
        await delay(backoff);
        continue;
      }

      consecutiveErrors = 0;
      totalInserted += batchInserted;
      currentHeight -= BATCH_SIZE;

      backfillProgress.totalDone = (oldestCached - 1) - currentHeight;
      backfillProgress.oldestHeight = currentHeight + 1;

      if (totalInserted % 200 === 0 && totalInserted > 0) {
        await setSyncValue("backfill_oldest_height", String(currentHeight));
        const pct = ((backfillProgress.totalDone / backfillProgress.totalNeeded) * 100).toFixed(1);
        log(`Backfill progress: ${totalInserted} blocks, height ${currentHeight}, ${pct}%`, "dashService");
      }

      await delay(DELAY_MS);
    }

    await setSyncValue("backfill_oldest_height", String(currentHeight));
    backfillProgress.status = currentHeight <= targetHeight ? "complete" : "paused";
    log(`Backfill done: ${totalInserted} blocks inserted, now at height ${currentHeight}`, "dashService");
  } catch (err: any) {
    log(`Backfill error: ${err.message}`, "dashService");
    backfillProgress.status = "error";
  } finally {
    backfillRunning = false;
  }
}

async function estimateTargetHeight(): Promise<number> {
  const saved = await getSyncValue("backfill_target_height");
  if (saved) return parseInt(saved);

  const [maxRow] = await db.select({ maxH: sql<number>`MAX(${coreBlockFees.height})` }).from(coreBlockFees);

  if (maxRow?.maxH) {
    const latestHeight = maxRow.maxH;
    const now = Math.floor(Date.now() / 1000);
    const secondsSinceJan1 = now - JAN_1_2026_UNIX;
    const blocksPerSecond = 1 / 150;
    const blocksSinceJan1 = Math.ceil(secondsSinceJan1 * blocksPerSecond);
    const target = latestHeight - blocksSinceJan1;
    await setSyncValue("backfill_target_height", String(target));
    return target;
  }

  return 2396800;
}

export function getBackfillProgress() {
  return { ...backfillProgress, running: backfillRunning };
}

export async function fetchRecentPlatformEpochs(count: number = 20) {
  try {
    const status = await fetchPlatformStatus();
    if (!status?.epoch?.number) return [];

    const currentEpoch = status.epoch.number;
    const batchSize = 5;
    const allEpochs: any[] = [];

    for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
      const promises = [];
      for (let i = batchStart; i < Math.min(batchStart + batchSize, count); i++) {
        const epochNum = currentEpoch - i;
        if (epochNum < 0) break;
        promises.push(fetchPlatformEpoch(epochNum));
      }

      const results = await Promise.allSettled(promises);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          allEpochs.push(result.value);
        }
      }

      if (batchStart + batchSize < count) await delay(200);
    }

    return allEpochs;
  } catch (err: any) {
    log(`Recent epochs fetch error: ${err.message}`, "dashService");
    return [];
  }
}

export async function syncAllPlatformEpochs(): Promise<number> {
  try {
    const status = await fetchPlatformStatus();
    if (!status?.epoch?.number) return 0;

    const currentEpoch = status.epoch.number;
    let inserted = 0;

    for (let epochNum = currentEpoch; epochNum >= 0; epochNum--) {
      const ep = await fetchPlatformEpoch(epochNum);
      if (!ep?.epoch) continue;

      const epochStartMs = Number(ep.epoch.startTime);
      const epochStartUnix = epochStartMs / 1000;
      if (epochStartUnix < JAN_1_2026_UNIX) {
        break;
      }

      try {
        await db.insert(platformEpochFees).values({
          epochNumber: ep.epoch.number,
          startTime: epochStartMs,
          endTime: Number(ep.epoch.endTime),
          totalCollectedFees: Number(ep.totalCollectedFees || 0),
          feeMultiplier: Number(ep.epoch.feeMultiplier || 1),
        }).onConflictDoUpdate({
          target: platformEpochFees.epochNumber,
          set: {
            totalCollectedFees: Number(ep.totalCollectedFees || 0),
            endTime: Number(ep.epoch.endTime),
          },
        });
        inserted++;
      } catch {}

      await delay(200);
    }

    log(`Synced ${inserted} platform epochs (all since Jan 1 2026)`, "dashService");
    return inserted;
  } catch (err: any) {
    log(`Platform full sync error: ${err.message}`, "dashService");
    return 0;
  }
}

export async function getCachedCoreFeeSeries(sinceTimestamp: number) {
  return db.select()
    .from(coreBlockFees)
    .where(gte(coreBlockFees.time, sinceTimestamp))
    .orderBy(coreBlockFees.time);
}

export async function getCachedPlatformFeeSeries(sinceTimestamp: number) {
  return db.select()
    .from(platformEpochFees)
    .where(gte(platformEpochFees.startTime, sinceTimestamp))
    .orderBy(platformEpochFees.startTime);
}

export async function getCoreHeightRange() {
  const [row] = await db.select({
    minH: sql<number>`MIN(${coreBlockFees.height})`,
    maxH: sql<number>`MAX(${coreBlockFees.height})`,
    count: sql<number>`COUNT(*)`,
  }).from(coreBlockFees);
  return { min: row?.minH || 0, max: row?.maxH || 0, count: row?.count || 0 };
}

export function creditsToDash(credits: number): number {
  return credits / CREDITS_PER_DASH;
}
