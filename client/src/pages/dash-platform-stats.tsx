import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dashEvoLogo from "@assets/logo_dash_evo_full_color_512px_1770933674709.png";
import dashLogo from "@assets/dash_logo_2018_rgb_for_screens_1770933767158.png";
import dogeImage from "@assets/Remove_background_doge2_1770963210773.png";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  Activity,
  ChevronDown,
  CircleDot,
  Coins,
  DatabaseZap,
  RefreshCcw,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

type RangeKey = "day" | "week" | "month" | "year";

interface SankeyData {
  monthlyMinedCoins: number;
  monthlyCoreFees: number;
  monthlyPlatformFees: number;
  totalReward: number;
  toMiners: number;
  toMasternodes: number;
  toDao: number;
  masternodeRewards: number;
  platformCreditPool: number;
  toStandardMN: number;
  toEvoFromRewards: number;
  toEvoTotal: number;
  dashPriceUsd: number;
  currentHeight: number;
  subsidy: number;
  regularMasternodes: number;
  evoNodes: number;
  generatedAt: number;
}

interface DashboardData {
  totals: {
    totalCoreFees: number;
    totalCoreRewards: number;
    totalPlatformFeesDash: number;
    totalCreditsOnPlatformDash: number;
    totalMasternodes: number;
    regularMasternodes: number;
    evoCount: number;
    totalValidators: number;
    payoutPerMasternode: number;
    payoutPerEvo: number;
  };
  coreFeeSeries: Array<{
    t: number;
    fees: number;
    reward: number;
    height: number;
    txCount: number;
    blockCount?: number;
  }>;
  platformFeeSeries: Array<{
    t: number;
    fees: number;
    epochNumber: number;
  }>;
  platformGasSeries: Array<{
    t: number;
    gas: number;
    blockHeight: number;
  }>;
  platformStatus: {
    epoch: {
      number: number;
      firstBlockHeight: string;
      firstCoreBlockHeight: number;
      startTime: number;
      feeMultiplier: string;
      endTime: number;
    };
    totalCredits: number;
    totalCollectedFeesDay: number;
    transactionsCount: number;
    identitiesCount: number;
    dataContractsCount: number;
    documentsCount: number;
    network: string;
    tenderdashHeight: number;
  } | null;
  coreHeight: number;
  dashPriceUsd: number;
  range: string;
}

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

function formatDash(amount: number) {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M DASH`;
  if (abs >= 10_000) return `${(amount / 1_000).toFixed(1)}k DASH`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(2)}k DASH`;
  if (abs >= 10) return `${amount.toFixed(2)} DASH`;
  if (abs >= 1) return `${amount.toFixed(4)} DASH`;
  if (abs >= 0.001) return `${amount.toFixed(5)} DASH`;
  return `${amount.toFixed(8)} DASH`;
}

function formatUsd(amount: number) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 10_000) return `$${(amount / 1_000).toFixed(1)}k`;
  if (amount >= 1_000) return `$${amount.toFixed(0)}`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(6)}`;
}

function formatDashCompact(amount: number) {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(amount / 1_000).toFixed(1)}k`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(2)}k`;
  if (abs >= 10) return amount.toFixed(2);
  if (abs >= 1) return amount.toFixed(3);
  if (abs >= 0.001) return amount.toFixed(5);
  return amount.toFixed(8);
}

function tickLabel(d: Date, range: RangeKey) {
  if (range === "day") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (range === "week") return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (range === "month") return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { year: "numeric", month: "short" });
}

function StatTile(props: {
  title: string;
  value: string;
  usdValue?: string;
  hint: string;
  icon: React.ReactNode;
  tone: "core" | "platform" | "neutral";
  testId: string;
  logo?: string;
}) {
  const toneClass =
    props.tone === "core"
      ? "from-[hsl(var(--primary)/0.22)] to-transparent"
      : props.tone === "platform"
        ? "from-[hsl(var(--accent)/0.22)] to-transparent"
        : "from-white/10 to-transparent";

  const dotClass =
    props.tone === "core"
      ? "bg-[hsl(var(--primary))]"
      : props.tone === "platform"
        ? "bg-[hsl(var(--accent))]"
        : "bg-white/40";

  return (
    <div
      className={`glass noise group relative overflow-hidden rounded-2xl p-4 sm:p-5`}
      data-testid={props.testId}
    >
      <div
        className={`pointer-events-none absolute inset-0 opacity-80 [mask-image:radial-gradient(380px_circle_at_30%_15%,black,transparent_60%)] bg-gradient-to-b ${toneClass}`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${dotClass}`} />
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              {props.title}
            </p>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="truncate font-serif text-2xl leading-none tracking-tight sm:text-3xl">
              {props.value}
            </p>
          </div>
          {props.usdValue && (
            <p className="mt-1 text-sm text-muted-foreground/70 font-mono" data-testid={`${props.testId}-usd`}>
              {props.usdValue}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground/90">{props.hint}</p>
        </div>
        <div className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-foreground/90 shadow-[0_0_0_1px_rgba(255,255,255,.04)_inset] transition-transform duration-300 group-hover:scale-[1.02]">
          {props.icon}
        </div>
      </div>
      {props.logo && (
        <img src={props.logo} alt="" className="absolute bottom-2 right-2 h-5 w-auto opacity-40" />
      )}
    </div>
  );
}

function RangeMenu(props: {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  testId: string;
}) {
  const label = RANGES.find((r) => r.key === props.value)?.label ?? "Range";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          className="h-9 gap-2 rounded-full px-3"
          data-testid={props.testId}
        >
          <span className="text-xs font-semibold tracking-wide">{label}</span>
          <ChevronDown className="h-4 w-4 opacity-80" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-36 rounded-2xl border-white/10 bg-[hsl(var(--popover)/0.92)] p-1 backdrop-blur"
      >
        {RANGES.map((r) => (
          <DropdownMenuItem
            key={r.key}
            className="cursor-pointer rounded-xl"
            onClick={() => props.onChange(r.key)}
            data-testid={`menu-range-${r.key}`}
          >
            {r.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CoreFeesChart(props: {
  series: DashboardData["coreFeeSeries"];
  range: RangeKey;
  showRewards: boolean;
  updatedAt: number;
}) {
  const chartData = useMemo(() => {
    const series = props.series;
    if (series.length === 0) return [];

    return series.map((p) => {
      const d = new Date(p.t);
      const label = tickLabel(d, props.range);
      return {
        label,
        fees: p.fees,
        rewards: props.showRewards ? p.reward - p.fees : undefined,
        height: p.height,
      };
    });
  }, [props.series, props.range, props.showRewards]);

  const totalFees = props.series.reduce((s, p) => s + p.fees, 0);
  const totalBlocks = props.series.reduce((s, p) => s + (p.blockCount || 1), 0);

  return (
    <Card
      className="glass noise overflow-hidden rounded-3xl border-white/10 bg-transparent"
      data-testid="card-chart-core"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <img src={dashLogo} alt="Dash" className="h-5 w-auto sm:h-6" />
              <h2 className="font-serif text-lg tracking-tight sm:text-xl">Core Chain Fees</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Actual transaction fees on the Core chain from BlockCypher
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="rounded-full border border-white/10 bg-white/5"
                data-testid="badge-total-core"
              >
                Total: {formatDash(totalFees)}
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full border border-white/10 bg-white/5"
                data-testid="badge-blocks-core"
              >
                {totalBlocks.toLocaleString()} blocks
              </Badge>
              <Separator orientation="vertical" className="mx-1 h-5 bg-white/10" />
              <span className="text-xs text-muted-foreground" data-testid="text-updated-core">
                Updated {formatDistanceToNowStrict(props.updatedAt)} ago
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="h-[280px] w-full px-2 pb-4 sm:h-[320px] sm:px-4" data-testid="chart-core">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="g-core-fees" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="g-core-rewards" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--chart-3))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border) / 0.6)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              tickLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              tickLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              width={60}
              tickFormatter={(v) => formatDashCompact(Number(v))}
            />
            <Tooltip
              cursor={{ stroke: "hsl(var(--border) / 0.9)", strokeDasharray: "4 4" }}
              contentStyle={{
                background: "hsl(var(--popover) / 0.92)",
                border: "1px solid hsl(var(--border) / 0.7)",
                borderRadius: 16,
                backdropFilter: "blur(10px)",
                color: "hsl(var(--foreground))",
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              formatter={(value: unknown, name: string) => {
                const label = name === "fees" ? "Fees" : "Block Rewards";
                return [formatDash(Number(value)), label];
              }}
            />
            {props.showRewards && (
              <Area
                type="monotone"
                dataKey="rewards"
                stroke="hsl(var(--chart-3))"
                strokeWidth={1.5}
                fill="url(#g-core-rewards)"
                fillOpacity={1}
                dot={false}
                stackId="1"
                name="rewards"
              />
            )}
            <Area
              type="monotone"
              dataKey="fees"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#g-core-fees)"
              fillOpacity={1}
              dot={false}
              stackId={props.showRewards ? "1" : undefined}
              activeDot={{ r: 4, stroke: "hsl(var(--primary))", strokeWidth: 2, fill: "hsl(var(--background))" }}
              name="fees"
            />
            {(props.showRewards) && (
              <Legend
                verticalAlign="top"
                height={28}
                formatter={(value: string) => (
                  <span className="text-xs text-muted-foreground">
                    {value === "fees" ? "Transaction Fees" : "Block Rewards (subsidy)"}
                  </span>
                )}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function PlatformFeesChart(props: {
  series: DashboardData["platformFeeSeries"];
  totalCreditsOnPlatformDash: number;
  range: RangeKey;
  showRewards: boolean;
  updatedAt: number;
}) {
  const chartData = useMemo(() => {
    const series = props.series;
    if (series.length === 0) return [];
    const tMin = series[0].t;
    const tMax = series[series.length - 1].t;
    const spanMs = tMax - tMin;

    return series.map((p) => {
      const d = new Date(p.t);
      let label: string;
      if (spanMs < 3600_000) {
        label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } else if (spanMs < 86400_000) {
        label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } else if (spanMs < 7 * 86400_000) {
        label = d.toLocaleDateString([], { weekday: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit" });
      } else if (spanMs < 90 * 86400_000) {
        label = d.toLocaleDateString([], { month: "short", day: "numeric" });
      } else {
        label = d.toLocaleDateString([], { year: "numeric", month: "short" });
      }
      return {
        label,
        fees: p.fees,
        heldInContracts: props.totalCreditsOnPlatformDash,
        epochNumber: p.epochNumber,
      };
    });
  }, [props.series, props.totalCreditsOnPlatformDash]);

  const totalFees = props.series.reduce((s, p) => s + p.fees, 0);

  return (
    <Card
      className="glass noise overflow-hidden rounded-3xl border-white/10 bg-transparent"
      data-testid="card-chart-platform"
    >
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <img src={dashEvoLogo} alt="Dash Evolution" className="h-6 w-auto sm:h-7" />
              <h2 className="font-serif text-lg tracking-tight sm:text-xl">Platform Chain Fees</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Fees paid to EVO masternodes per epoch from Platform Explorer
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="rounded-full border border-white/10 bg-white/5"
                data-testid="badge-total-platform"
              >
                Total: {formatDash(totalFees)}
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full border border-white/10 bg-white/5"
                data-testid="badge-epochs-platform"
              >
                {props.series.length} epochs
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full border border-[hsl(var(--chart-4)/0.3)] bg-[hsl(var(--chart-4)/0.08)]"
                data-testid="badge-held-platform"
              >
                Held in contracts: {formatDash(props.totalCreditsOnPlatformDash)}
              </Badge>
              <Separator orientation="vertical" className="mx-1 h-5 bg-white/10" />
              <span className="text-xs text-muted-foreground" data-testid="text-updated-platform">
                Updated {formatDistanceToNowStrict(props.updatedAt)} ago
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="h-[280px] w-full px-2 pb-4 sm:h-[320px] sm:px-4" data-testid="chart-platform">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="g-platform-fees" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border) / 0.6)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              tickLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              axisLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              tickLine={{ stroke: "hsl(var(--border) / 0.75)" }}
              width={60}
              tickFormatter={(v) => formatDashCompact(Number(v))}
            />
            {props.showRewards && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "hsl(var(--chart-4))", fontSize: 11 }}
                axisLine={{ stroke: "hsl(var(--chart-4) / 0.4)" }}
                tickLine={{ stroke: "hsl(var(--chart-4) / 0.4)" }}
                width={72}
                tickFormatter={(v) => formatDashCompact(Number(v))}
              />
            )}
            <Tooltip
              cursor={{ stroke: "hsl(var(--border) / 0.9)", strokeDasharray: "4 4" }}
              contentStyle={{
                background: "hsl(var(--popover) / 0.92)",
                border: "1px solid hsl(var(--border) / 0.7)",
                borderRadius: 16,
                backdropFilter: "blur(10px)",
                color: "hsl(var(--foreground))",
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              labelFormatter={(label: string, payload: any[]) => {
                const epoch = payload?.[0]?.payload?.epochNumber;
                return epoch != null ? `${label} — Epoch ${epoch}` : label;
              }}
              formatter={(value: unknown, name: string) => {
                const displayName = name === "fees" ? "Epoch Fees" : "Held in Contracts";
                return [formatDash(Number(value)), displayName];
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="fees"
              stroke="hsl(var(--accent))"
              strokeWidth={2}
              fill="url(#g-platform-fees)"
              fillOpacity={1}
              dot={false}
              activeDot={{ r: 4, stroke: "hsl(var(--accent))", strokeWidth: 2, fill: "hsl(var(--background))" }}
              name="fees"
            />
            {props.showRewards && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="heldInContracts"
                stroke="hsl(var(--chart-4))"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                name="heldInContracts"
              />
            )}
            <Legend
              verticalAlign="top"
              height={28}
              formatter={(value: string) => (
                <span className="text-xs text-muted-foreground">
                  {value === "fees" ? "Epoch Fees (to EVO nodes)" : "Held in Contracts (future payout)"}
                </span>
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function sankeyPath(x0: number, y0: number, x1: number, y1: number, thickness0: number, thickness1: number): string {
  const mx = (x0 + x1) / 2;
  return [
    `M ${x0},${y0}`,
    `C ${mx},${y0} ${mx},${y1} ${x1},${y1}`,
    `L ${x1},${y1 + thickness1}`,
    `C ${mx},${y1 + thickness1} ${mx},${y0 + thickness0} ${x0},${y0 + thickness0}`,
    `Z`,
  ].join(" ");
}

function RewardFlowSankey({ data }: { data: SankeyData | null }) {
  if (!data) return null;

  const price = data.dashPriceUsd;
  const fmtDash = (v: number) => v >= 1 ? `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} DASH` : `${v.toFixed(4)} DASH`;
  const fmtUsd = (v: number) => `$${(v * price).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const W = 1200;
  const H = 900;
  const nodeW = 20;
  const colX = [160, 340, 560, 780, 1000];
  const gap = 20;
  const minH = 6;

  const mnToPool = data.toMasternodes - data.masternodeRewards;
  const creditPoolTotal = mnToPool + data.monthlyPlatformFees;

  const nodesDef = [
    { id: "mined", label: "Mined Coins", col: 0, color: "#c96b6b" },
    { id: "fees", label: "Core Fees", col: 0, color: "#5b8abf" },
    { id: "total", label: "Total Reward", col: 1, color: "#6b82b5" },
    { id: "miners", label: "Miners", col: 2, color: "#c46480" },
    { id: "masternodes", label: "Masternodes", col: 2, color: "#5b8abf" },
    { id: "dao", label: "DAO Budget", col: 2, color: "#b5a04a" },
    { id: "pfees", label: "Platform Fees", col: 2, color: "#9b6db7" },
    { id: "mnrewards", label: "MN Rewards", col: 3, color: "#5895b0" },
    { id: "creditpool", label: "Credit Pool", col: 3, color: "#4a9b7a" },
    { id: "standard", label: "Standard MNs", col: 4, color: "#c47840" },
    { id: "evo", label: "EVO Nodes", col: 4, color: "#3abbc0" },
  ];

  const linksDef = [
    { from: "mined", to: "total", value: data.monthlyMinedCoins, color: "#c96b6b" },
    { from: "fees", to: "total", value: data.monthlyCoreFees, color: "#5b8abf" },
    { from: "total", to: "miners", value: data.toMiners, color: "#c46480" },
    { from: "total", to: "masternodes", value: data.toMasternodes, color: "#5b8abf" },
    { from: "total", to: "dao", value: data.toDao, color: "#b5a04a" },
    { from: "masternodes", to: "mnrewards", value: data.masternodeRewards, color: "#5895b0" },
    { from: "masternodes", to: "creditpool", value: mnToPool, color: "#4a9b7a" },
    { from: "pfees", to: "creditpool", value: data.monthlyPlatformFees, color: "#9b6db7" },
    { from: "mnrewards", to: "standard", value: data.toStandardMN, color: "#c47840" },
    { from: "mnrewards", to: "evo", value: data.toEvoFromRewards, color: "#3abbc0" },
    { from: "creditpool", to: "evo", value: creditPoolTotal, color: "#4a9b7a" },
  ];

  const nodeFlow: Record<string, number> = {};
  for (const n of nodesDef) nodeFlow[n.id] = 0;
  for (const l of linksDef) {
    nodeFlow[l.from] = (nodeFlow[l.from] || 0) + l.value;
    nodeFlow[l.to] = (nodeFlow[l.to] || 0) + l.value;
  }
  for (const n of nodesDef) {
    const outSum = linksDef.filter((l) => l.from === n.id).reduce((s, l) => s + l.value, 0);
    const inSum = linksDef.filter((l) => l.to === n.id).reduce((s, l) => s + l.value, 0);
    nodeFlow[n.id] = Math.max(outSum, inSum);
  }

  const maxFlow = Math.max(...Object.values(nodeFlow));
  const availH = H - 400;
  const scale = availH / maxFlow;
  const ht = (v: number) => Math.max(v * scale, minH);

  const colGroups: Record<number, typeof nodesDef> = {};
  for (const n of nodesDef) {
    if (!colGroups[n.col]) colGroups[n.col] = [];
    colGroups[n.col].push(n);
  }

  const nodePos: Record<string, { x: number; y: number; h: number }> = {};
  for (const col of Object.keys(colGroups).map(Number)) {
    const group = colGroups[col];
    const colGap = col === 2 ? gap + 50 : gap;
    const totalH = group.reduce((s, n) => s + ht(nodeFlow[n.id]), 0) + (group.length - 1) * colGap;
    let y = (H - totalH) / 2;
    for (const n of group) {
      const h = ht(nodeFlow[n.id]);
      nodePos[n.id] = { x: colX[col], y, h };
      y += h + colGap;
    }
  }

  const outOffsets: Record<string, number> = {};
  const inOffsets: Record<string, number> = {};
  for (const n of nodesDef) {
    outOffsets[n.id] = 0;
    inOffsets[n.id] = 0;
  }

  const sortedBySource: Record<string, typeof linksDef> = {};
  for (const l of linksDef) {
    if (!sortedBySource[l.from]) sortedBySource[l.from] = [];
    sortedBySource[l.from].push(l);
  }
  for (const key of Object.keys(sortedBySource)) {
    sortedBySource[key].sort((a, b) => {
      const ay = nodePos[a.to]?.y ?? 0;
      const by = nodePos[b.to]?.y ?? 0;
      return ay - by;
    });
  }

  const sortedByTarget: Record<string, typeof linksDef> = {};
  for (const l of linksDef) {
    if (!sortedByTarget[l.to]) sortedByTarget[l.to] = [];
    sortedByTarget[l.to].push(l);
  }
  for (const key of Object.keys(sortedByTarget)) {
    sortedByTarget[key].sort((a, b) => {
      const ay = nodePos[a.from]?.y ?? 0;
      const by = nodePos[b.from]?.y ?? 0;
      return ay - by;
    });
  }

  const linkOutY: Record<string, Record<string, number>> = {};
  for (const [srcId, links] of Object.entries(sortedBySource)) {
    let off = 0;
    for (const l of links) {
      const thick = ht(l.value);
      if (!linkOutY[srcId]) linkOutY[srcId] = {};
      linkOutY[srcId][l.to] = nodePos[srcId].y + off;
      off += thick;
    }
  }

  const linkInY: Record<string, Record<string, number>> = {};
  for (const [tgtId, links] of Object.entries(sortedByTarget)) {
    let off = 0;
    for (const l of links) {
      const thick = ht(l.value);
      if (!linkInY[tgtId]) linkInY[tgtId] = {};
      linkInY[tgtId][l.from] = nodePos[tgtId].y + off;
      off += thick;
    }
  }

  const renderedLinks = linksDef.map((link, i) => {
    const fromP = nodePos[link.from];
    const toP = nodePos[link.to];
    if (!fromP || !toP) return null;

    const rawThick = link.value * scale;
    const visThick = Math.max(rawThick, minH);
    const outY = linkOutY[link.from]?.[link.to] ?? fromP.y;
    const inY = linkInY[link.to]?.[link.from] ?? toP.y;
    const x0 = fromP.x + nodeW;
    const x1 = toP.x;
    const y0 = rawThick < minH ? outY + rawThick / 2 - visThick / 2 : outY;
    const y1 = rawThick < minH ? inY + rawThick / 2 - visThick / 2 : inY;

    return (
      <path
        key={i}
        d={sankeyPath(x0, y0, x1, y1, visThick, visThick)}
        fill={link.color}
        fillOpacity={0.3}
        stroke={link.color}
        strokeOpacity={0.45}
        strokeWidth={0.5}
      />
    );
  });

  const nodeValue: Record<string, number> = {};
  for (const n of nodesDef) nodeValue[n.id] = nodeFlow[n.id];

  const renderedNodes = nodesDef.map((n) => {
    const pos = nodePos[n.id];
    if (!pos) return null;
    const isLeft = n.col <= 1;
    const isRight = n.col >= 3;
    const labelX = isRight ? pos.x + nodeW + 10 : isLeft ? pos.x - 10 : pos.x + nodeW / 2;
    const anchor: "start" | "end" | "middle" = isRight ? "start" : isLeft ? "end" : "middle";
    const labelY = pos.y + pos.h / 2;
    const val = nodeValue[n.id];

    return (
      <g key={n.id}>
        <rect
          x={pos.x}
          y={pos.y}
          width={nodeW}
          height={pos.h}
          rx={4}
          fill={n.color}
          fillOpacity={0.9}
          stroke={n.color}
          strokeWidth={1}
        />
        <text x={labelX} y={labelY - 16} textAnchor={anchor} fill="#ffffff" fontSize={27} fontFamily="'Roboto Condensed', sans-serif" fontWeight={600}>
          {n.label}
        </text>
        <text x={labelX} y={labelY + 12} textAnchor={anchor} fill="#ffffff" fontSize={25} fontFamily="'Roboto Condensed', sans-serif">
          {fmtDash(val)}
        </text>
        <text x={labelX} y={labelY + 38} textAnchor={anchor} fill="#ffffff" fontSize={22} fontFamily="'Roboto Condensed', sans-serif" opacity={0.75}>
          {fmtUsd(val)}
        </text>
      </g>
    );
  });

  return (
    <Card className="glass noise overflow-hidden rounded-3xl border-white/10 bg-transparent" data-testid="card-sankey">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg tracking-tight sm:text-xl" data-testid="text-sankey-title">
              Dash Network Reward Distribution
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Previous 30 days &middot; {data.regularMasternodes.toLocaleString()} standard + {data.evoNodes.toLocaleString()} EVO masternodes &middot; Block subsidy {data.subsidy.toFixed(4)} DASH
            </p>
          </div>
          <Badge variant="secondary" className="rounded-full border border-white/10 bg-white/5" data-testid="badge-sankey-updated">
            {new Date(Date.now() - 30 * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </Badge>
        </div>
      </div>
      <div className="w-full overflow-x-auto px-2 pb-6 sm:px-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[1200px]" style={{ minWidth: 700 }}>
          {renderedLinks}
          {renderedNodes}
        </svg>
      </div>
    </Card>
  );
}

export default function DashPlatformStats() {
  const [range, setRange] = useState<RangeKey>("month");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCoreRewards, setShowCoreRewards] = useState(false);
  const [showPlatformHeld, setShowPlatformHeld] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [sankeyData, setSankeyData] = useState<SankeyData | null>(null);
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sankey")
      .then((r) => r.json())
      .then(setSankeyData)
      .catch(() => {});
  }, []);

  const fetchDashboard = useCallback(async (r: RangeKey, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/dashboard?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setUpdatedAt(Date.now());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard(range);
  }, [range, fetchDashboard]);

  useEffect(() => {
    const id = setInterval(() => fetchDashboard(range, true), 60_000);
    return () => clearInterval(id);
  }, [range, fetchDashboard]);

  const handleRangeChange = useCallback((r: RangeKey) => setRange(r), []);

  const totals = data?.totals;
  const dashPrice = data?.dashPriceUsd || 0;

  return (
    <div className="min-h-dvh grid-glow">
      <img
        src={dogeImage}
        alt="Doge mascot"
        className="fixed bottom-0 left-0 z-50 hidden w-48 object-contain opacity-90 pointer-events-none xl:block"
        data-testid="img-doge-mascot"
      />
      <header className="mx-auto w-full max-w-[90rem] px-4 pb-5 pt-10 sm:px-6 sm:pb-7 sm:pt-14 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
              data-testid="status-network"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--chart-3))]" />
              {data?.platformStatus?.network === "evo1" ? "Mainnet" : "Testnet"} &middot; Core block {data?.coreHeight?.toLocaleString() || "..."} &middot; Platform block {data?.platformStatus?.tenderdashHeight?.toLocaleString() || "..."}
            </p>
            <h1 className="mt-4 flex items-center gap-3 font-serif text-3xl font-light leading-[1.05] tracking-tight sm:text-5xl" data-testid="text-title">
              <img src={dashLogo} alt="Dash" className="h-8 w-auto sm:h-11" data-testid="img-logo" />
              <span className="text-gradient">Stats</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base" data-testid="text-subtitle">
              Live fee telemetry from Dash Core and Platform chains with payout estimates per node.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a href="https://www.dashmarket.net" target="_blank" rel="noopener noreferrer" data-testid="link-dash-merch">
              <Button
                variant="secondary"
                className="h-10 rounded-full border border-white/10 bg-white/5 px-4 backdrop-blur"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Dash Merch
              </Button>
            </a>
            <a href="https://ecosystem.dashmarket.net" target="_blank" rel="noopener noreferrer" data-testid="link-dash-ecosystem">
              <Button
                variant="secondary"
                className="h-10 rounded-full border border-white/10 bg-white/5 px-4 backdrop-blur"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Dash Ecosystem
              </Button>
            </a>
            <Button
              variant="secondary"
              className="h-10 rounded-full border border-white/10 bg-white/5 px-4 backdrop-blur"
              onClick={() => fetchDashboard(range, true)}
              disabled={refreshing}
              data-testid="button-refresh"
            >
              <RefreshCcw className={"mr-2 h-4 w-4 " + (refreshing ? "animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" data-testid="text-error">
            Failed to load data: {error}
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:mt-8 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            title="Total Dash Core Fees"
            value={totals ? formatDash(totals.totalCoreFees) : "Loading..."}
            usdValue={totals && dashPrice ? formatUsd(totals.totalCoreFees * dashPrice) : undefined}
            hint={`Window: ${RANGES.find((r) => r.key === range)?.label}`}
            icon={<Coins className="h-5 w-5" />}
            tone="core"
            testId="tile-total-core"
            logo={dashLogo}
          />
          <StatTile
            title="Fee Payout Per Masternode"
            value={totals ? formatDash(totals.payoutPerMasternode) : "Loading..."}
            usdValue={totals && dashPrice ? formatUsd(totals.payoutPerMasternode * dashPrice) : undefined}
            hint={`Core fees / ${totals?.totalMasternodes?.toLocaleString() || "..."} total masternodes`}
            icon={<CircleDot className="h-5 w-5" />}
            tone="core"
            testId="tile-payout-mn"
            logo={dashLogo}
          />
          <StatTile
            title="Total Dash Platform Fees"
            value={totals ? formatDash(totals.totalPlatformFeesDash) : "Loading..."}
            usdValue={totals && dashPrice ? formatUsd(totals.totalPlatformFeesDash * dashPrice) : undefined}
            hint={`Window: ${RANGES.find((r) => r.key === range)?.label}`}
            icon={<DatabaseZap className="h-5 w-5" />}
            tone="platform"
            testId="tile-total-platform"
            logo={dashEvoLogo}
          />
          <StatTile
            title="Fee Payout Per Evo Node"
            value={totals ? formatDash(totals.payoutPerEvo) : "Loading..."}
            usdValue={totals && dashPrice ? formatUsd(totals.payoutPerEvo * dashPrice) : undefined}
            hint={`Core fees / ${totals?.totalMasternodes?.toLocaleString() || "..."} all MNs + platform fees / ${totals?.evoCount?.toLocaleString() || "..."} EVO nodes`}
            icon={<CircleDot className="h-5 w-5" />}
            tone="platform"
            testId="tile-payout-evo"
            logo={dashEvoLogo}
          />
        </div>

      </header>

      <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 sm:px-6 lg:px-10">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
            <div className="flex flex-col items-center gap-4">
              <RefreshCcw className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Fetching live data from Dash network...</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2" data-testid="controls-bar">
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-white/10"
                onClick={() => setShowCoreRewards((v) => !v)}
                data-testid="toggle-rewards-core"
              >
                {showCoreRewards ? (
                  <ToggleRight className="h-4 w-4 text-[hsl(var(--chart-3))]" />
                ) : (
                  <ToggleLeft className="h-4 w-4" />
                )}
                {showCoreRewards ? "Core: Fees + Rewards" : "Core: Fees Only"}
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-white/10"
                onClick={() => setShowPlatformHeld((v) => !v)}
                data-testid="toggle-held-platform"
              >
                {showPlatformHeld ? (
                  <ToggleRight className="h-4 w-4 text-[hsl(var(--chart-4))]" />
                ) : (
                  <ToggleLeft className="h-4 w-4" />
                )}
                {showPlatformHeld ? "Platform: Show Held" : "Platform: Fees Only"}
              </button>
              {refreshing ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground" data-testid="status-syncing">
                  <CircleDot className="h-4 w-4 animate-pulse" />
                  Syncing
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground" data-testid="status-live">
                  <Activity className="h-4 w-4" />
                  Live
                </span>
              )}
              <RangeMenu value={range} onChange={handleRangeChange} testId="select-range-global" />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <CoreFeesChart
                series={data?.coreFeeSeries || []}
                range={range}
                showRewards={showCoreRewards}
                updatedAt={updatedAt}
              />
              <PlatformFeesChart
                series={data?.platformFeeSeries || []}
                totalCreditsOnPlatformDash={data?.totals?.totalCreditsOnPlatformDash || 0}
                range={range}
                showRewards={showPlatformHeld}
                updatedAt={updatedAt}
              />
            </div>

            <div className="mt-6">
              <RewardFlowSankey data={sankeyData} />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <Card className="glass noise rounded-3xl border-white/10 bg-transparent" data-testid="card-network">
                <div className="p-5 sm:p-6">
                  <h3 className="font-serif text-lg tracking-tight" data-testid="text-network-title">Platform Network Info</h3>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Transactions</span>
                      <span className="font-mono text-foreground/90">
                        {data?.platformStatus?.transactionsCount?.toLocaleString() || "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Identities</span>
                      <span className="font-mono text-foreground/90">
                        {data?.platformStatus?.identitiesCount?.toLocaleString() || "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Data Contracts</span>
                      <span className="font-mono text-foreground/90">
                        {data?.platformStatus?.dataContractsCount?.toLocaleString() || "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Documents</span>
                      <span className="font-mono text-foreground/90">
                        {data?.platformStatus?.documentsCount?.toLocaleString() || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="glass noise rounded-3xl border-white/10 bg-transparent" data-testid="card-formulas">
                <div className="p-5 sm:p-6">
                  <h3 className="font-serif text-lg tracking-tight" data-testid="text-formulas-title">Payout Estimates</h3>
                  <p className="mt-2 text-sm text-muted-foreground" data-testid="text-formulas-body">
                    <span className="text-foreground/90">Per masternode</span> = core fees / {totals?.totalMasternodes?.toLocaleString() || "..."} total masternodes (regular + EVO)
                    <br /><br />
                    <span className="text-foreground/90">Per EVO node</span> = core fees per MN + platform fees / {totals?.evoCount?.toLocaleString() || "..."} EVO nodes
                  </p>
                </div>
              </Card>

              <Card className="glass noise rounded-3xl border-white/10 bg-transparent" data-testid="card-status">
                <div className="p-5 sm:p-6">
                  <h3 className="font-serif text-lg tracking-tight" data-testid="text-status-title">Data Sources</h3>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>Core Chain</span>
                      <span className="font-mono text-foreground/90">BlockCypher API</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Platform Chain</span>
                      <span className="font-mono text-foreground/90">Platform Explorer</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Current Epoch</span>
                      <span className="font-mono text-foreground/90">
                        #{data?.platformStatus?.epoch?.number || "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Updated</span>
                      <span className="font-mono text-foreground/90">
                        {formatDistanceToNowStrict(updatedAt)} ago
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}

        <footer className="mt-10 border-t border-white/10 pb-8 pt-6">
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-footer-creator">
              Created by <span className="font-medium text-foreground/80">ageofdoge</span>
            </p>
            <div className="flex items-center gap-4" data-testid="footer-social-links">
              <a
                href="https://x.com/evilduck92"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                data-testid="link-x"
              >
                X
              </a>
              <span className="text-white/20">|</span>
              <a
                href="https://www.youtube.com/@ageofdoge"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                data-testid="link-youtube"
              >
                YouTube
              </a>
              <span className="text-white/20">|</span>
              <a
                href="https://www.twitch.tv/ageofdoge"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                data-testid="link-twitch"
              >
                Twitch
              </a>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/60" data-testid="text-footer-hint">
              Data refreshes automatically every 60 seconds.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
