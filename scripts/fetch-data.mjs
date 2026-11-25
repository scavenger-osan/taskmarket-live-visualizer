#!/usr/bin/env node
/**
 * Fetches live Taskmarket public market data for Tempo (4217) and Base (8453),
 * computes exact derived metrics (distinct weekly posters, poster concentration,
 * completion funnel, active swarm tasks), and writes public/data/market.json.
 *
 * Zero dependencies. Node 22+ built-in fetch only.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, '../public/data/market.json')

export const API_BASE = 'https://api.taskmarket.dev'
export const CHAINS = [
  { id: 4217, key: 'tempo', name: 'Tempo', token: 'OUSD', decimals: 6 },
  { id: 8453, key: 'base', name: 'Base', token: 'USDC', decimals: 6 },
]

export const ENDPOINTS_USED = [
  '/api/market/stats?chainId={chainId}',
  '/api/stats/breakdowns?chainId={chainId}',
  '/api/stats/platform-time-series?chainId={chainId}&range={7d|30d|90d|all}&bucket={day|week}',
  '/api/stats/activity-heatmap?chainId={chainId}&range=30d&dimension={hourOfWeek|mode}',
  '/api/stats/activity-feed?chainId={chainId}&limit=40',
  '/api/tasks?chainId={chainId}&sort=newest&limit=100&cursor={cursor}',
]

async function fetchJson(path, retries = 3) {
  const url = `${API_BASE}${path}`
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'taskmarket-live-visualizer/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
      return await res.json()
    } catch (err) {
      lastErr = err
      await new Promise(r => setTimeout(r, 600 * (i + 1)))
    }
  }
  throw lastErr
}

function isoWeekStart(isoString) {
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return null
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = utc.getUTCDay() // 0 = Sun, 1 = Mon
  const diff = (day + 6) % 7 // days since Monday
  utc.setUTCDate(utc.getUTCDate() - diff)
  return utc.toISOString().slice(0, 10)
}

function toUsd(baseUnits, decimals = 6) {
  const n = Number(baseUnits ?? 0)
  return Number.isFinite(n) ? n / 10 ** decimals : 0
}

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string' || addr.length < 10) return 'unknown'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

async function fetchAllTasks(chainId, maxPages = 35) {
  const all = []
  let cursor = null
  for (let page = 0; page < maxPages; page++) {
    const qs = cursor
      ? `/api/tasks?chainId=${chainId}&sort=newest&limit=100&cursor=${encodeURIComponent(cursor)}`
      : `/api/tasks?chainId=${chainId}&sort=newest&limit=100`
    const data = await fetchJson(qs)
    const items = Array.isArray(data.tasks) ? data.tasks : (Array.isArray(data) ? data : [])
    if (items.length === 0) break
    all.push(...items)
    cursor = data.nextCursor ?? data.cursor ?? null
    if (!cursor || items.length < 100) break
  }
  return all
}

function computeTaskAnalytics(tasks, decimals = 6) {
  const weeklyMap = new Map() // weekStart -> { posters: Set, tasks: number, rewardUsd: number }
  const posterMap = new Map() // addr -> { tasks: number, rewardUsd: number, completed: number, open: number }
  let totalRewardUsd = 0
  let expiredCount = 0
  let expiredZeroSubs = 0
  let completedCount = 0
  let totalSubmissions = 0
  const openSwarm = []

  for (const t of tasks) {
    const req = (t.requester || '').toLowerCase()
    const rew = toUsd(t.reward, decimals)
    const subs = Number(t.submissionCount ?? 0)
    totalRewardUsd += rew
    totalSubmissions += subs

    const wk = isoWeekStart(t.createdAt)
    if (wk) {
      let bucket = weeklyMap.get(wk)
      if (!bucket) {
        bucket = { posters: new Set(), tasks: 0, rewardUsd: 0 }
        weeklyMap.set(wk, bucket)
      }
      if (req) bucket.posters.add(req)
      bucket.tasks += 1
      bucket.rewardUsd += rew
    }

    if (req) {
      let p = posterMap.get(req)
      if (!p) {
        p = { address: req, tasks: 0, rewardUsd: 0, completed: 0, open: 0 }
        posterMap.set(req, p)
      }
      p.tasks += 1
      p.rewardUsd += rew
      if (t.status === 'completed') p.completed += 1
      if (t.status === 'open') p.open += 1
    }

    if (t.status === 'expired') {
      expiredCount += 1
      if (subs === 0) expiredZeroSubs += 1
    }
    if (t.status === 'completed') completedCount += 1

    if (t.status === 'open') {
      const titleLine = (t.description || '').split('\n')[0].trim().slice(0, 100)
      openSwarm.push({
        ref: t.referenceCode || shortAddr(t.id),
        id: t.id,
        title: titleLine,
        mode: t.mode || 'bounty',
        rewardUsd: Number(rew.toFixed(2)),
        submissions: subs,
        requesterShort: shortAddr(t.requester),
        createdAt: t.createdAt,
        expiryTime: t.expiryTime,
      })
    }
  }

  const weeklyPosters = [...weeklyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, v]) => ({
      week,
      distinctPosters: v.posters.size,
      tasksPosted: v.tasks,
      rewardUsd: Number(v.rewardUsd.toFixed(2)),
    }))

  const postersSortedByTasks = [...posterMap.values()].sort((a, b) => b.tasks - a.tasks)
  const postersSortedByReward = [...posterMap.values()].sort((a, b) => b.rewardUsd - a.rewardUsd)
  const totalTasks = tasks.length || 1
  const safeTotalReward = totalRewardUsd || 1

  const top5TasksShare = postersSortedByTasks.slice(0, 5).reduce((s, p) => s + p.tasks, 0) / totalTasks
  const top5RewardShare = postersSortedByReward.slice(0, 5).reduce((s, p) => s + p.rewardUsd, 0) / safeTotalReward

  openSwarm.sort((a, b) => (b.submissions * 2 + b.rewardUsd) - (a.submissions * 2 + a.rewardUsd))

  return {
    sampledTasks: tasks.length,
    distinctPostersAllTime: posterMap.size,
    totalRewardPostedUsd: Number(totalRewardUsd.toFixed(2)),
    totalSubmissions,
    expiredCount,
    expiredZeroSubs,
    completedCount,
    posterConcentration: {
      top1TasksShare: Number(((postersSortedByTasks[0]?.tasks ?? 0) / totalTasks).toFixed(4)),
      top5TasksShare: Number(top5TasksShare.toFixed(4)),
      top5RewardShare: Number(top5RewardShare.toFixed(4)),
      topPosters: postersSortedByReward.slice(0, 8).map(p => ({
        addressShort: shortAddr(p.address),
        tasks: p.tasks,
        rewardUsd: Number(p.rewardUsd.toFixed(2)),
        completed: p.completed,
        open: p.open,
      })),
    },
    weeklyPosters,
    activeSwarm: openSwarm.slice(0, 14),
    _rawWeeklySets: weeklyMap,
  }
}

async function fetchChainData(chain) {
  const cid = chain.id
  const [
    stats,
    breakdowns,
    ts7d,
    ts30d,
    ts90d,
    tsAllDay,
    tsAllWeek,
    hmHour,
    hmMode,
    feed,
    tasks,
  ] = await Promise.all([
    fetchJson(`/api/market/stats?chainId=${cid}`),
    fetchJson(`/api/stats/breakdowns?chainId=${cid}`),
    fetchJson(`/api/stats/platform-time-series?chainId=${cid}&range=7d&bucket=day`),
    fetchJson(`/api/stats/platform-time-series?chainId=${cid}&range=30d&bucket=day`),
    fetchJson(`/api/stats/platform-time-series?chainId=${cid}&range=90d&bucket=day`),
    fetchJson(`/api/stats/platform-time-series?chainId=${cid}&range=all&bucket=day`),
    fetchJson(`/api/stats/platform-time-series?chainId=${cid}&range=all&bucket=week`),
    fetchJson(`/api/stats/activity-heatmap?chainId=${cid}&range=30d&dimension=hourOfWeek`),
    fetchJson(`/api/stats/activity-heatmap?chainId=${cid}&range=30d&dimension=mode`),
    fetchJson(`/api/stats/activity-feed?chainId=${cid}&limit=40`),
    fetchAllTasks(cid),
  ])

  const normalizeTs = arr =>
    (Array.isArray(arr) ? arr : []).map(row => ({
      bucket: row.bucket,
      tasksCreated: Number(row.tasksCreated ?? 0),
      completedTasks: Number(row.completedTasks ?? 0),
      newAgents: Number(row.newAgents ?? 0),
      activeAgents: Number(row.activeAgents ?? 0),
      rewardVolumeUsd: Number(toUsd(row.rewardVolume, chain.decimals).toFixed(2)),
      paidVolumeUsd: Number(toUsd(row.paidVolume, chain.decimals).toFixed(2)),
      settlements: Number(row.settlements ?? 0),
    }))

  const cleanFeed = (Array.isArray(feed.items) ? feed.items : []).map(item => ({
    type: item.type,
    timestamp: item.timestamp,
    taskId: item.taskId,
    taskTitle: (item.taskTitle || '').slice(0, 110),
    chainId: item.chainId ?? cid,
    chainKey: chain.key,
    token: chain.token,
    actorShort: shortAddr(item.actor),
    actorType: item.actorType || null,
    amountUsd: item.amount != null ? Number(toUsd(item.amount, chain.decimals).toFixed(2)) : null,
  }))

  const analytics = computeTaskAnalytics(tasks, chain.decimals)

  return {
    meta: chain,
    stats,
    breakdowns,
    timeSeries: {
      '7d': normalizeTs(ts7d),
      '30d': normalizeTs(ts30d),
      '90d': normalizeTs(ts90d),
      all: normalizeTs(tsAllDay),
      allWeekly: normalizeTs(tsAllWeek),
    },
    heatmaps: {
      hourOfWeek: hmHour,
      mode: hmMode,
    },
    feed: cleanFeed,
    analytics,
    _tasks: tasks,
  }
}

export async function buildMarketSnapshot() {
  const asOf = new Date().toISOString()
  const [tempo, base] = await Promise.all(CHAINS.map(fetchChainData))

  // Combine weekly distinct posters across both chains accurately
  const combinedWeekly = new Map()
  for (const chain of [tempo, base]) {
    for (const [wk, v] of chain.analytics._rawWeeklySets.entries()) {
      let b = combinedWeekly.get(wk)
      if (!b) {
        b = { posters: new Set(), tasks: 0, rewardUsd: 0 }
        combinedWeekly.set(wk, b)
      }
      for (const p of v.posters) b.posters.add(p)
      b.tasks += v.tasks
      b.rewardUsd += v.rewardUsd
    }
  }

  // Strip internal helpers before serializing
  const strip = c => {
    const { _rawWeeklySets, ...cleanAnalytics } = c.analytics
    return {
      meta: c.meta,
      stats: c.stats,
      breakdowns: c.breakdowns,
      timeSeries: c.timeSeries,
      heatmaps: c.heatmaps,
      feed: c.feed,
      analytics: cleanAnalytics,
    }
  }

  const combinedFeed = [...tempo.feed, ...base.feed]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 50)

  const snapshot = {
    asOf,
    apiBase: API_BASE,
    endpoints: ENDPOINTS_USED,
    chains: {
      tempo: strip(tempo),
      base: strip(base),
    },
    combined: {
      weeklyPosters: [...combinedWeekly.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, v]) => ({
          week,
          distinctPosters: v.posters.size,
          tasksPosted: v.tasks,
          rewardUsd: Number(v.rewardUsd.toFixed(2)),
        })),
      feed: combinedFeed,
    },
  }

  return snapshot
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirect) {
  const snapshot = await buildMarketSnapshot()
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(snapshot), 'utf8')
  const t = snapshot.chains.tempo
  const b = snapshot.chains.base
  console.log(
    JSON.stringify(
      {
        asOf: snapshot.asOf,
        out: OUT_PATH,
        tempo: {
          openTasks: t.stats.openTasks,
          activeAgents7d: t.stats.activeAgents7d,
          sampledTasks: t.analytics.sampledTasks,
          distinctPostersAllTime: t.analytics.distinctPostersAllTime,
          weeks: t.analytics.weeklyPosters.length,
        },
        base: {
          openTasks: b.stats.openTasks,
          activeAgents7d: b.stats.activeAgents7d,
          sampledTasks: b.analytics.sampledTasks,
          distinctPostersAllTime: b.analytics.distinctPostersAllTime,
          weeks: b.analytics.weeklyPosters.length,
        },
      },
      null,
      2,
    ),
  )
}
