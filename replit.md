# Dash Platform Stats Dashboard

## Overview
Real-time dashboard displaying Dash Platform and Core chain statistics including fees, payouts, and network metrics. Built with React + Express + PostgreSQL.

## Recent Changes
- 2026-02-12: Switched Core chain API from Dash Insight (403 blocked) to BlockCypher API
- 2026-02-12: Frontend now uses real API data instead of simulated series
- 2026-02-12: Added fees/rewards toggle on Core chart and "held in contracts" line on Platform chart
- 2026-02-12: Initial build with database caching, Platform Explorer integration

## Architecture
- **Frontend**: React + Vite on port 5000, Recharts for charts, Tailwind CSS + shadcn/ui
- **Backend**: Express API server with background sync every 5 minutes
- **Database**: PostgreSQL with Drizzle ORM caching core_block_fees and platform_epoch_fees
- **APIs**: BlockCypher (Core chain blocks/fees), Platform Explorer pshenmic.dev (epochs, validators, gas)

## Key Files
- `shared/schema.ts` - Drizzle schema for core_block_fees, platform_epoch_fees
- `server/dashService.ts` - API integrations (BlockCypher + Platform Explorer)
- `server/routes.ts` - Express API routes including /api/dashboard aggregated endpoint
- `client/src/pages/dash-platform-stats.tsx` - Main dashboard UI component

## Data Flow
1. Background sync fetches blocks from BlockCypher and epochs from Platform Explorer
2. Data cached in PostgreSQL tables
3. /api/dashboard endpoint aggregates cached data + live platform status
4. Frontend polls /api/dashboard every 60 seconds

## User Preferences
- Dark glass telemetry aesthetic with Montserrat (headings) + Open Sans (body) + Roboto Condensed (data/GUI) fonts
- Cyan/purple neon accents for Core/Platform distinction
- Fees shown by default, toggle to include block rewards in different color
- Platform chart shows fees to EVO nodes + dashed line for held-in-contracts amount
