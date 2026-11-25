#!/usr/bin/env node
/**
 * Zero-dependency HTTP server for Taskmarket Live Market Visualizer.
 * Fetches https://api.taskmarket.dev server-side, caches in memory for at least 60s,
 * refreshes automatically every 15 minutes, and serves static assets from public/.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMarketSnapshot } from './scripts/fetch-data.mjs'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const PUBLIC_DIR = join(__dirname, 'public')
const PORT = Number(process.env.PORT || 8080)
const REFRESH_MS = Math.max(60_000, Number(process.env.REFRESH_MS || 15 * 60_000))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

let cachedJson = null
let lastRefresh = 0
let refreshing = null

async function refreshSnapshot() {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const snap = await buildMarketSnapshot()
      cachedJson = JSON.stringify(snap)
      lastRefresh = Date.now()
      console.log(`[visualizer] refreshed snapshot asOf=${snap.asOf}`)
    } catch (err) {
      console.error('[visualizer] refresh error:', err.message)
      if (!cachedJson) {
        try {
          cachedJson = await readFile(join(PUBLIC_DIR, 'data/market.json'), 'utf8')
        } catch {}
      }
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

await refreshSnapshot()
setInterval(refreshSnapshot, REFRESH_MS).unref()

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/data/market.json' || pathname === '/api/snapshot') {
    if (!cachedJson || Date.now() - lastRefresh > REFRESH_MS) {
      refreshSnapshot().catch(() => {})
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    })
    res.end(cachedJson || '{}')
    return
  }

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const filePath = resolve(PUBLIC_DIR, rel)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const body = await readFile(filePath)
    const ext = extname(filePath)
    const cache = ext === '.html' ? 'public, max-age=60' : 'public, max-age=3600'
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache,
    })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`[visualizer] listening on http://localhost:${PORT}`)
})
