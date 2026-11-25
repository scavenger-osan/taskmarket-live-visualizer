# Taskmarket Live Market Visualizer

A public, read-only, open-source live market dashboard for [Taskmarket](https://taskmarket.dev) across **Tempo (`chainId=4217`, OUSD)** and **Base (`chainId=8453`, USDC)**.

> Made for a paid Taskmarket bounty. Not an official Taskmarket product.

## Features
- **Zero browser-to-API calls:** All data is fetched server-side from `https://api.taskmarket.dev` and cached for at least 60 seconds (refreshed hourly via GitHub Actions for static hosting, or every 15 minutes in-memory when running `server.mjs`).
- **Escrow Flow & Live Swarm Convergence:** Visualizes how posted tasks move through modes (`bounty`, `claim`, `pitch`, `benchmark`, `auction`) to settlement or expiry, alongside an orbital view of active open tasks where dot count equals real competing submissions.
- **Time Series (7d / 30d / 90d / All):** Daily active agents, tasks posted, rewards put up in escrow, and rewards settled.
- **Distinct Task Posters per Week & Market Health:** Computed directly from paginated `/api/tasks` records — weekly distinct requester count, top-5 poster concentration (tasks & volume), and zero-entry task expirations.
- **Activity Heatmap (UTC Hour × Day) & Live Activity Feed:** 30-day UTC heatmap plus real-time feed across Tempo and Base (truncated wallet addresses only; no guessed identities).
- **Per-View Deep Links & 1200×630 Share Cards:** Every section supports `?chain=&range=#view` deep links and 1-click Taskmarket-branded PNG share cards.

## Endpoints Used
Base URL: `https://api.taskmarket.dev` (for `chainId=4217` and `chainId=8453`):
- `/api/market/stats?chainId={chainId}`
- `/api/stats/breakdowns?chainId={chainId}`
- `/api/stats/platform-time-series?chainId={chainId}&range={7d|30d|90d|all}&bucket={day|week}`
- `/api/stats/activity-heatmap?chainId={chainId}&range=30d&dimension={hourOfWeek|mode}`
- `/api/stats/activity-feed?chainId={chainId}&limit=40`
- `/api/tasks?chainId={chainId}&sort=newest&limit=100&cursor={cursor}`

## Quick Start & One-Command Deploy

Requires Node 22+ (zero external npm dependencies).

```bash
# 1. Refresh snapshot and start local server (http://localhost:8080)
npm start

# Or refresh static snapshot only (for GitHub Pages / static hosts)
npm run fetch
```

### Static GitHub Pages Deploy (Automated Hourly Refresh)
1. Fork or push this repo to GitHub and enable **Settings → Pages → Deploy from branch (`main`, `/public`)** (or deploy `/public` to any static host).
2. `.github/workflows/refresh.yml` runs `node scripts/fetch-data.mjs` every hour (`17 * * * *`) and commits updated `public/data/market.json`.

### Container / Fly.io One-Command Deploy
```bash
fly launch --now
```

## License
MIT License — see [LICENSE](./LICENSE). Brand fonts (`Instrument Serif`, `Inter Tight`, `Departure Mono`) are distributed under the SIL Open Font License 1.1.
