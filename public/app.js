const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtInt = n => Number(n ?? 0).toLocaleString('en-US')
const fmtUsd = n => '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = r => `${(Number(r ?? 0) * 100).toFixed(1)}%`

const state = {
  data: null,
  chain: 'both', // 'both' | 'tempo' | 'base'
  range: '30d',  // '7d' | '30d' | '90d' | 'all'
}

const $ = sel => document.querySelector(sel)
const $$ = sel => [...document.querySelectorAll(sel)]

function readUrlState() {
  const params = new URLSearchParams(location.search)
  const c = params.get('chain')
  const r = params.get('range')
  if (['both', 'tempo', 'base'].includes(c)) state.chain = c
  if (['7d', '30d', '90d', 'all'].includes(r)) state.range = r
}

function syncUrlState() {
  const params = new URLSearchParams(location.search)
  params.set('chain', state.chain)
  params.set('range', state.range)
  const hash = location.hash || ''
  history.replaceState(null, '', `?${params.toString()}${hash}`)
}

function showToast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(showToast._t)
  showToast._t = setTimeout(() => { el.hidden = true }, 2400)
}

function showTip(evt, html) {
  const tip = $('#tooltip')
  tip.innerHTML = html
  tip.hidden = false
  const pad = 14
  const x = Math.min(window.innerWidth - tip.offsetWidth - pad, evt.clientX + pad)
  const y = Math.min(window.innerHeight - tip.offsetHeight - pad, evt.clientY + pad)
  tip.style.left = `${Math.max(pad, x)}px`
  tip.style.top = `${Math.max(pad, y)}px`
}
function hideTip() {
  $('#tooltip').hidden = true
}

function getScopedView() {
  const d = state.data
  const tempo = d.chains.tempo
  const base = d.chains.base

  if (state.chain !== 'both') {
    const c = d.chains[state.chain]
    return {
      label: `${c.meta.name} (${c.meta.token})`,
      token: c.meta.token,
      stats: c.stats,
      breakdowns: c.breakdowns,
      timeSeries: c.timeSeries[state.range] || [],
      heatmap: c.heatmaps.hourOfWeek,
      weeklyPosters: c.analytics.weeklyPosters,
      analytics: c.analytics,
      feed: c.feed,
      isBoth: false,
    }
  }

  // Combine Tempo + Base accurately without double-counting platform-wide /api/market/stats fields
  const mergeTs = (a, b) => {
    const map = new Map()
    for (const row of [...a, ...b]) {
      let m = map.get(row.bucket)
      if (!m) {
        m = {
          bucket: row.bucket,
          tasksCreated: 0,
          completedTasks: 0,
          newAgents: 0,
          activeAgents: 0,
          rewardVolumeUsd: 0,
          paidVolumeUsd: 0,
          settlements: 0,
        }
        map.set(row.bucket, m)
      }
      m.tasksCreated += row.tasksCreated
      m.completedTasks += row.completedTasks
      m.newAgents = Math.max(m.newAgents, row.newAgents)
      m.activeAgents = Math.max(m.activeAgents, row.activeAgents)
      m.rewardVolumeUsd += row.rewardVolumeUsd
      m.paidVolumeUsd += row.paidVolumeUsd
      m.settlements += row.settlements
    }
    return [...map.values()].sort((x, y) => x.bucket.localeCompare(y.bucket))
  }

  // Merge heatmaps
  const cellMap = new Map()
  for (const hm of [tempo.heatmaps.hourOfWeek, base.heatmaps.hourOfWeek]) {
    for (const cell of hm?.cells || []) {
      const key = `${cell.row}:${cell.col}`
      const cur = cellMap.get(key) || { row: cell.row, col: cell.col, count: 0 }
      cur.count += Number(cell.count || 0)
      cellMap.set(key, cur)
    }
  }

  // Combine top posters & open swarm
  const combinedSwarm = [
    ...tempo.analytics.activeSwarm.map(x => ({ ...x, chain: 'Tempo', token: 'OUSD' })),
    ...base.analytics.activeSwarm.map(x => ({ ...x, chain: 'Base', token: 'USDC' })),
  ].sort((a, b) => (b.submissions * 2 + b.rewardUsd) - (a.submissions * 2 + a.rewardUsd))

  const combinedTopPosters = [
    ...tempo.analytics.posterConcentration.topPosters.map(p => ({ ...p, chain: 'Tempo' })),
    ...base.analytics.posterConcentration.topPosters.map(p => ({ ...p, chain: 'Base' })),
  ].sort((a, b) => b.rewardUsd - a.rewardUsd).slice(0, 8)

  const sampledTasks = tempo.analytics.sampledTasks + base.analytics.sampledTasks
  const totalRewardPostedUsd = Number((tempo.analytics.totalRewardPostedUsd + base.analytics.totalRewardPostedUsd).toFixed(2))
  const completedCount = tempo.analytics.completedCount + base.analytics.completedCount
  const expiredCount = tempo.analytics.expiredCount + base.analytics.expiredCount
  const expiredZeroSubs = tempo.analytics.expiredZeroSubs + base.analytics.expiredZeroSubs

  return {
    label: 'Tempo (OUSD) + Base (USDC)',
    token: 'USD',
    stats: {
      registeredWorkers: tempo.stats.registeredWorkers,
      activeWorkers7d: tempo.stats.activeWorkers7d,
      activeAgents7d: tempo.stats.activeAgents7d,
      openTasks: tempo.stats.openTasks,
      paidWorkers: Number(tempo.stats.paidWorkers || 0) + Number(base.stats.paidWorkers || 0),
      activeWallets: Number(tempo.stats.activeWallets || 0) + Number(base.stats.activeWallets || 0),
    },
    breakdowns: tempo.breakdowns, // Platform-wide breakdown returned identically on both chains
    timeSeries: mergeTs(tempo.timeSeries[state.range] || [], base.timeSeries[state.range] || []),
    heatmap: { cells: [...cellMap.values()] },
    weeklyPosters: d.combined.weeklyPosters,
    analytics: {
      sampledTasks,
      distinctPostersAllTime: tempo.analytics.distinctPostersAllTime + base.analytics.distinctPostersAllTime,
      totalRewardPostedUsd,
      completedCount,
      expiredCount,
      expiredZeroSubs,
      posterConcentration: {
        top1TasksShare: tempo.analytics.posterConcentration.top1TasksShare,
        top5TasksShare: Number(
          ((tempo.analytics.posterConcentration.top5TasksShare * tempo.analytics.sampledTasks +
            base.analytics.posterConcentration.top5TasksShare * base.analytics.sampledTasks) /
            Math.max(1, sampledTasks)).toFixed(4),
        ),
        top5RewardShare: Number(
          ((tempo.analytics.posterConcentration.top5RewardShare * tempo.analytics.totalRewardPostedUsd +
            base.analytics.posterConcentration.top5RewardShare * base.analytics.totalRewardPostedUsd) /
            Math.max(1, totalRewardPostedUsd)).toFixed(4),
        ),
        topPosters: combinedTopPosters,
      },
      activeSwarm: combinedSwarm.slice(0, 14),
    },
    feed: d.combined.feed,
    isBoth: true,
  }
}

function renderKPIs(v) {
  const s = v.stats
  const latestWk = v.weeklyPosters.at(-1)
  const cards = [
    {
      label: 'Active agents (7d)',
      scope: 'platform',
      value: fmtInt(s.activeAgents7d),
      sub: `${fmtInt(s.activeWorkers7d)} active workers total`,
      accent: true,
    },
    {
      label: 'Open tasks now',
      scope: 'platform',
      value: fmtInt(s.openTasks),
      sub: `${fmtInt(v.analytics.sampledTasks)} tasks indexed (${v.isBoth ? '2 chains' : state.chain})`,
    },
    {
      label: 'Paid workers',
      scope: v.isBoth ? 'tempo+base' : state.chain,
      value: fmtInt(s.paidWorkers),
      sub: `${fmtInt(s.activeWallets)} active wallets`,
    },
    {
      label: 'Posted escrow',
      scope: v.isBoth ? 'OUSD+USDC' : v.token,
      value: fmtUsd(v.analytics.totalRewardPostedUsd),
      sub: `${fmtInt(v.analytics.completedCount)} completed in task log`,
    },
    {
      label: 'Posters this week',
      scope: 'distinct',
      value: fmtInt(latestWk?.distinctPosters ?? 0),
      sub: latestWk ? `Week of ${latestWk.week} (${fmtInt(latestWk.tasksPosted)} tasks)` : '—',
    },
    {
      label: 'Registered workers',
      scope: 'platform',
      value: fmtInt(s.registeredWorkers),
      sub: `${fmtInt(v.analytics.distinctPostersAllTime)} distinct requesters`,
    },
  ]

  $('#kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi">
      <div class="kpi-label">
        <span>${c.label}</span>
        <span class="kpi-scope mono">${c.scope}</span>
      </div>
      <div class="kpi-value ${c.accent ? 'kpi-accent' : ''}">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>
  `).join('')
}

function renderEscrowFlow(v) {
  const modes = [...(v.breakdowns?.mode || [])].sort((a, b) => b.count - a.count)
  const statuses = [...(v.breakdowns?.status || [])].sort((a, b) => b.count - a.count)
  const totalTasks = statuses.reduce((s, x) => s + Number(x.count || 0), 0) || 1

  const completed = statuses.find(s => s.status === 'completed')?.count || 0
  const open = statuses.find(s => s.status === 'open')?.count || 0
  const expired = statuses.find(s => s.status === 'expired')?.count || 0
  const cancelled = statuses.find(s => s.status === 'cancelled')?.count || 0
  const other = Math.max(0, totalTasks - completed - open - expired - cancelled)

  const outcomes = [
    { name: 'Completed', count: completed, color: '#E74079' },
    { name: 'Open / active', count: open + other, color: '#D9A097' },
    { name: 'Cancelled', count: cancelled, color: '#6E645A' },
    { name: 'Expired', count: expired, color: '#453E37' },
  ]

  const W = 540
  const H = 240
  const colX = [16, 200, 392]
  const barW = 128

  const layoutStack = (items, x) => {
    const gap = 8
    const usableH = H - 36 - gap * (items.length - 1)
    let y = 26
    return items.map(it => {
      const h = Math.max(18, (it.count / totalTasks) * usableH)
      const rect = { ...it, x, y, h }
      y += h + gap
      return rect
    })
  }

  const leftNode = { name: `${fmtInt(totalTasks)} tasks`, sub: `${fmtInt(v.analytics.distinctPostersAllTime)} requesters`, x: colX[0], y: 26, h: H - 44 }
  const midNodes = layoutStack(modes.slice(0, 4).map(m => ({ name: m.mode, count: m.count })), colX[1])
  const rightNodes = layoutStack(outcomes, colX[2])

  const curve = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }

  let paths = ''
  for (const m of midNodes) {
    const ly = leftNode.y + (m.y - 26) + m.h / 2
    const my = m.y + m.h / 2
    const sw = Math.max(2, Math.min(28, (m.count / totalTasks) * 52))
    paths += `<path d="${curve(leftNode.x + barW, ly, m.x, my)}" stroke="#453E37" stroke-opacity="0.65" stroke-width="${sw}" fill="none" />`
  }
  const topMode = midNodes[0]
  for (const r of rightNodes) {
    const my = topMode.y + topMode.h / 2
    const ry = r.y + r.h / 2
    const sw = Math.max(2, Math.min(26, (r.count / totalTasks) * 48))
    paths += `<path d="${curve(topMode.x + barW, my, r.x, ry)}" stroke="${r.color}" stroke-opacity="0.45" stroke-width="${sw}" fill="none" />`
  }

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" aria-label="Taskmarket escrow funnel from requesters through modes to outcomes">
      <text x="${colX[0]}" y="14" fill="#B0A79D" font-size="10" font-family="Departure Mono">REQUESTERS</text>
      <text x="${colX[1]}" y="14" fill="#B0A79D" font-size="10" font-family="Departure Mono">MODES</text>
      <text x="${colX[2]}" y="14" fill="#B0A79D" font-size="10" font-family="Departure Mono">OUTCOMES</text>
      ${paths}
      <rect x="${leftNode.x}" y="${leftNode.y}" width="${barW}" height="${leftNode.h}" rx="6" fill="#2A2520" stroke="#453E37"/>
      <text x="${leftNode.x + 10}" y="${leftNode.y + 24}" fill="#FFF6E8" font-size="13" font-family="Departure Mono">${leftNode.name}</text>
      <text x="${leftNode.x + 10}" y="${leftNode.y + 42}" fill="#B0A79D" font-size="11">${leftNode.sub}</text>
      <text x="${leftNode.x + 10}" y="${leftNode.y + leftNode.h - 14}" fill="#D9A097" font-size="11" font-family="Departure Mono">${fmtPct(completed / totalTasks)} settled</text>

      ${midNodes.map(m => `
        <rect x="${m.x}" y="${m.y}" width="${barW}" height="${m.h}" rx="5" fill="#1A1714" stroke="#453E37"/>
        <text x="${m.x + 8}" y="${m.y + Math.min(18, m.h / 2 + 4)}" fill="#EFE9E2" font-size="11">${m.name}</text>
        <text x="${m.x + barW - 8}" y="${m.y + Math.min(18, m.h / 2 + 4)}" text-anchor="end" fill="#B0A79D" font-size="10" font-family="Departure Mono">${fmtInt(m.count)}</text>
      `).join('')}

      ${rightNodes.map(r => `
        <rect x="${r.x}" y="${r.y}" width="${barW}" height="${r.h}" rx="5" fill="#1A1714" stroke="${r.color}"/>
        <text x="${r.x + 8}" y="${r.y + Math.min(18, r.h / 2 + 4)}" fill="#FFF6E8" font-size="11">${r.name}</text>
        <text x="${r.x + barW - 8}" y="${r.y + Math.min(18, r.h / 2 + 4)}" text-anchor="end" fill="#EFE9E2" font-size="10" font-family="Departure Mono">${fmtInt(r.count)}</text>
      `).join('')}
    </svg>
  `
  $('#escrowFlowSvg').innerHTML = svg
  $('#statusPills').innerHTML = statuses.map(s =>
    `<span class="pill mono">${s.status}: ${fmtInt(s.count)}</span>`
  ).join('')
}

function renderSwarmOrbit(v) {
  const items = v.analytics.activeSwarm.slice(0, 9)
  const W = 540
  const H = 240
  if (!items.length) {
    $('#swarmOrbitSvg').innerHTML = '<p class="muted">No open tasks in this chain snapshot.</p>'
    return
  }

  const maxRew = Math.max(...items.map(i => i.rewardUsd), 1)
  const cols = 3
  const rows = Math.ceil(items.length / cols)
  const cellW = W / cols
  const cellH = H / rows

  const nodes = items.map((t, idx) => {
    const c = idx % cols
    const r = Math.floor(idx / cols)
    const cx = cellW * (c + 0.5)
    const cy = cellH * (r + 0.5)
    const coreR = 9 + Math.sqrt(t.rewardUsd / maxRew) * 12
    const dotsCount = Math.min(48, Math.max(0, t.submissions))
    const orbitR = coreR + 11
    let dots = ''
    for (let i = 0; i < dotsCount; i++) {
      const ang = (i / Math.max(1, dotsCount)) * Math.PI * 2 - Math.PI / 2
      const ring = i >= 24 ? orbitR + 6 : orbitR
      const dx = cx + Math.cos(ang) * ring
      const dy = cy + Math.sin(ang) * ring
      dots += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="1.9" fill="${i === 0 ? '#E74079' : '#D9A097'}" opacity="0.9"/>`
    }
    const isTop = idx === 0
    return `
      <g class="swarm-node" data-idx="${idx}" style="cursor:pointer">
        <circle cx="${cx}" cy="${cy}" r="${orbitR}" fill="none" stroke="#453E37" stroke-dasharray="2 3"/>
        ${dots}
        <circle cx="${cx}" cy="${cy}" r="${coreR.toFixed(1)}" fill="${isTop ? '#3A1420' : '#181512'}" stroke="${isTop ? '#E74079' : '#EFE9E2'}" stroke-width="1.4"/>
        <text x="${cx}" y="${cy + 3}" text-anchor="middle" fill="#FFF6E8" font-size="9.5" font-family="Departure Mono">$${t.rewardUsd >= 10 ? Math.round(t.rewardUsd) : t.rewardUsd.toFixed(1)}</text>
        <text x="${cx}" y="${cy + orbitR + 14}" text-anchor="middle" fill="#B0A79D" font-size="9" font-family="Departure Mono">${t.ref} (${t.submissions})</text>
      </g>
    `
  }).join('')

  $('#swarmOrbitSvg').innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-label="Open tasks with orbital dots representing competing submissions">${nodes}</svg>`

  $$('#swarmOrbitSvg .swarm-node').forEach(g => {
    const t = items[Number(g.dataset.idx)]
    const html = `
      <div class="mono" style="color:#E74079">${t.ref} &middot; ${fmtUsd(t.rewardUsd)}</div>
      <div style="margin:3px 0">${t.title || 'Untitled task'}</div>
      <div class="mono muted">${t.submissions} submissions &middot; ${t.mode} &middot; req ${t.requesterShort}</div>
    `
    g.addEventListener('mousemove', e => showTip(e, html))
    g.addEventListener('mouseleave', hideTip)
    g.addEventListener('click', () => {
      $('#swarmCaption').innerHTML = `<span class="mono" style="color:#FFF6E8">${t.ref}</span> (${fmtUsd(t.rewardUsd)}, ${t.submissions} entries): ${t.title}`
    })
  })
}

function renderDualChart(containerSel, rows, opts) {
  const el = $(containerSel)
  if (!rows.length) {
    el.innerHTML = '<p class="muted">No time-series buckets in this range.</p>'
    return
  }

  const W = 540
  const H = 220
  const pad = { t: 16, r: 16, b: 28, l: 48 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b

  const maxPrimary = Math.max(...rows.map(r => r[opts.primaryKey]), 1)
  const maxSecondary = Math.max(...rows.map(r => r[opts.secondaryKey]), 1)
  const sharedMax = opts.sharedAxis ? Math.max(maxPrimary, maxSecondary, 1) : null

  const xAt = i => pad.l + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw)
  const yPrimary = val => pad.t + ih - (val / (sharedMax || maxPrimary)) * ih
  const ySecondary = val => pad.t + ih - (val / (sharedMax || maxSecondary)) * ih

  const barW = Math.max(3, Math.min(18, (iw / rows.length) * 0.58))

  const gridLines = [0, 0.5, 1].map(f => {
    const y = pad.t + ih * (1 - f)
    const val = (sharedMax || maxPrimary) * f
    const lbl = opts.isUsd ? '$' + Math.round(val) : Math.round(val)
    return `
      <line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#453E37" stroke-opacity="0.45"/>
      <text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" fill="#B0A79D" font-size="9.5" font-family="Departure Mono">${lbl}</text>
    `
  }).join('')

  const bars = rows.map((r, i) => {
    const x = xAt(i) - barW / 2
    const y = ySecondary(r[opts.secondaryKey])
    const h = Math.max(1, pad.t + ih - y)
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#D9A097" fill-opacity="0.42"/>`
  }).join('')

  const linePts = rows.map((r, i) => `${xAt(i).toFixed(1)},${yPrimary(r[opts.primaryKey]).toFixed(1)}`).join(' ')
  const areaPts = `${xAt(0).toFixed(1)},${pad.t + ih} ${linePts} ${xAt(rows.length - 1).toFixed(1)},${pad.t + ih}`

  const labelIdx = [0, Math.floor(rows.length / 2), rows.length - 1].filter((v, i, a) => a.indexOf(v) === i)
  const xLabels = labelIdx.map(i =>
    `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#B0A79D" font-size="9.5" font-family="Departure Mono">${rows[i].bucket.slice(5)}</text>`
  ).join('')

  const hitTargets = rows.map((r, i) => {
    const x = xAt(i)
    const w = Math.max(8, iw / rows.length)
    return `<rect class="ts-hit" data-i="${i}" x="${(x - w / 2).toFixed(1)}" y="${pad.t}" width="${w.toFixed(1)}" height="${ih}" fill="transparent" style="cursor:crosshair"/>`
  }).join('')

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      ${gridLines}
      ${bars}
      <polygon points="${areaPts}" fill="#E74079" fill-opacity="0.10"/>
      <polyline points="${linePts}" fill="none" stroke="#E74079" stroke-width="2" stroke-linejoin="round"/>
      ${xLabels}
      ${hitTargets}
    </svg>
  `

  el.querySelectorAll('.ts-hit').forEach(rect => {
    const r = rows[Number(rect.dataset.i)]
    const pVal = opts.isUsd ? fmtUsd(r[opts.primaryKey]) : fmtInt(r[opts.primaryKey])
    const sVal = opts.isUsd ? fmtUsd(r[opts.secondaryKey]) : fmtInt(r[opts.secondaryKey])
    const html = `
      <div class="mono" style="color:#FFF6E8">${r.bucket}</div>
      <div><span style="color:#E74079">&#9679;</span> ${opts.primaryLabel}: <span class="mono">${pVal}</span></div>
      <div><span style="color:#D9A097">&#9632;</span> ${opts.secondaryLabel}: <span class="mono">${sVal}</span></div>
    `
    rect.addEventListener('mousemove', e => showTip(e, html))
    rect.addEventListener('mouseleave', hideTip)
  })
}

function renderTimeSeries(v) {
  const rows = v.timeSeries
  const totTasks = rows.reduce((s, r) => s + r.tasksCreated, 0)
  const peakAgents = Math.max(...rows.map(r => r.activeAgents), 0)
  const totPosted = rows.reduce((s, r) => s + r.rewardVolumeUsd, 0)
  const totPaid = rows.reduce((s, r) => s + r.paidVolumeUsd, 0)

  $('#tsAgentsSummary').textContent = `Peak ${fmtInt(peakAgents)} agents · ${fmtInt(totTasks)} tasks`
  $('#tsVolumeSummary').textContent = `${fmtUsd(totPosted)} posted · ${fmtUsd(totPaid)} paid`

  renderDualChart('#tsAgentsChart', rows, {
    primaryKey: 'activeAgents',
    primaryLabel: 'Active agents',
    secondaryKey: 'tasksCreated',
    secondaryLabel: 'Tasks posted',
    sharedAxis: false,
    isUsd: false,
  })
  renderDualChart('#tsVolumeChart', rows, {
    primaryKey: 'paidVolumeUsd',
    primaryLabel: 'Rewards paid',
    secondaryKey: 'rewardVolumeUsd',
    secondaryLabel: 'Rewards put up',
    sharedAxis: true,
    isUsd: true,
  })
}

function renderPostersAndHealth(v) {
  const wks = v.weeklyPosters
  const peakWk = wks.reduce((best, cur) => (cur.distinctPosters > (best?.distinctPosters ?? -1) ? cur : best), null)
  $('#weeklyPostersSummary').textContent = peakWk
    ? `Peak ${peakWk.distinctPosters} posters (wk ${peakWk.week})`
    : '—'

  // Bar chart for distinct weekly posters
  const W = 540
  const H = 220
  const pad = { t: 16, r: 14, b: 30, l: 38 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const maxP = Math.max(...wks.map(w => w.distinctPosters), 1)
  const bw = Math.max(6, Math.min(28, (iw / Math.max(1, wks.length)) * 0.68))

  const bars = wks.map((w, i) => {
    const cx = pad.l + ((i + 0.5) / Math.max(1, wks.length)) * iw
    const h = Math.max(2, (w.distinctPosters / maxP) * ih)
    const y = pad.t + ih - h
    const isLatest = i === wks.length - 1
    return `<rect class="wk-bar" data-i="${i}" x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${isLatest ? '#E74079' : '#D9A097'}" style="cursor:pointer"/>`
  }).join('')

  const xStep = Math.max(1, Math.ceil(wks.length / 5))
  const xLbls = wks.map((w, i) => {
    if (i % xStep !== 0 && i !== wks.length - 1) return ''
    const cx = pad.l + ((i + 0.5) / Math.max(1, wks.length)) * iw
    return `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#B0A79D" font-size="9.5" font-family="Departure Mono">${w.week.slice(5)}</text>`
  }).join('')

  $('#weeklyPostersChart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <line x1="${pad.l}" y1="${pad.t}" x2="${W - pad.r}" y2="${pad.t}" stroke="#453E37" stroke-opacity="0.4"/>
      <line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}" stroke="#453E37"/>
      <text x="${pad.l - 6}" y="${pad.t + 4}" text-anchor="end" fill="#B0A79D" font-size="9.5" font-family="Departure Mono">${maxP}</text>
      <text x="${pad.l - 6}" y="${pad.t + ih + 3}" text-anchor="end" fill="#B0A79D" font-size="9.5" font-family="Departure Mono">0</text>
      ${bars}
      ${xLbls}
    </svg>
  `
  $$('#weeklyPostersChart .wk-bar').forEach(r => {
    const w = wks[Number(r.dataset.i)]
    const html = `
      <div class="mono" style="color:#FFF6E8">Week of ${w.week}</div>
      <div>Distinct posters: <span class="mono" style="color:#E74079">${fmtInt(w.distinctPosters)}</span></div>
      <div>Tasks posted: <span class="mono">${fmtInt(w.tasksPosted)}</span> (${fmtUsd(w.rewardUsd)})</div>
    `
    r.addEventListener('mousemove', e => showTip(e, html))
    r.addEventListener('mouseleave', hideTip)
  })

  // Diagnostics
  const a = v.analytics
  const compRate = a.completedCount / Math.max(1, a.sampledTasks)
  $('#healthSubtitle').textContent = `${fmtInt(a.sampledTasks)} tasks analyzed`
  $('#diagnosticsBox').innerHTML = `
    <div class="diag-card">
      <div class="diag-val">${fmtPct(a.posterConcentration.top5TasksShare)}</div>
      <div class="diag-lbl">Top 5 posters' share of tasks</div>
    </div>
    <div class="diag-card">
      <div class="diag-val">${fmtPct(a.posterConcentration.top5RewardShare)}</div>
      <div class="diag-lbl">Top 5 posters' share of reward volume</div>
    </div>
    <div class="diag-card">
      <div class="diag-val">${fmtInt(a.expiredCount)} <span class="muted" style="font-size:12px">(${a.expiredZeroSubs} empty)</span></div>
      <div class="diag-lbl">Expired tasks (zero-entry expirations)</div>
    </div>
    <div class="diag-card">
      <div class="diag-val">${fmtPct(compRate)}</div>
      <div class="diag-lbl">Completed share of indexed tasks</div>
    </div>
  `

  $('#topPostersTable tbody').innerHTML = a.posterConcentration.topPosters.slice(0, 6).map(p => `
    <tr>
      <td class="mono">${p.addressShort}${p.chain ? ` <span class="muted">(${p.chain})</span>` : ''}</td>
      <td class="num">${fmtInt(p.tasks)}</td>
      <td class="num">${fmtInt(p.completed)}</td>
      <td class="num">${fmtUsd(p.rewardUsd)}</td>
    </tr>
  `).join('')
}

function renderHeatmapAndModes(v) {
  const cells = v.heatmap?.cells || []
  const map = new Map()
  let maxC = 1
  let peak = null
  for (const c of cells) {
    const cnt = Number(c.count || 0)
    map.set(`${c.row}:${c.col}`, cnt)
    if (cnt > maxC) {
      maxC = cnt
      peak = { day: DAYS[Number(c.row)] || c.row, hour: Number(c.col), count: cnt }
    }
  }
  $('#hmPeakLabel').textContent = peak
    ? `Peak: ${peak.day} ${String(peak.hour).padStart(2, '0')}:00 UTC (${fmtInt(peak.count)})`
    : '—'

  let html = '<div class="hm-table"><div></div>'
  for (let h = 0; h < 24; h++) {
    html += `<div class="hm-hour">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>`
  }
  for (let d = 0; d < 7; d++) {
    html += `<div class="hm-day">${DAYS[d]}</div>`
    for (let h = 0; h < 24; h++) {
      const cnt = map.get(`${d}:${h}`) || 0
      const intensity = cnt === 0 ? 0 : 0.16 + 0.84 * Math.pow(cnt / maxC, 0.7)
      const bg = cnt === 0
        ? '#171411'
        : intensity > 0.78
          ? `rgba(231, 64, 121, ${intensity.toFixed(2)})`
          : `rgba(217, 160, 151, ${intensity.toFixed(2)})`
      html += `<div class="hm-cell" data-d="${DAYS[d]}" data-h="${h}" data-c="${cnt}" style="background:${bg}"></div>`
    }
  }
  html += '</div>'
  $('#heatmapGrid').innerHTML = html

  $$('#heatmapGrid .hm-cell').forEach(cell => {
    const info = `<div class="mono">${cell.dataset.d} ${String(cell.dataset.h).padStart(2, '0')}:00 UTC</div><div>Events: <span class="mono" style="color:#E74079">${fmtInt(cell.dataset.c)}</span></div>`
    cell.addEventListener('mousemove', e => showTip(e, info))
    cell.addEventListener('mouseleave', hideTip)
  })

  const modes = [...(v.breakdowns?.mode || [])].sort((a, b) => b.count - a.count)
  const total = modes.reduce((s, m) => s + Number(m.count || 0), 0) || 1
  $('#modeBars').innerHTML = modes.map((m, i) => {
    const pct = (m.count / total) * 100
    return `
      <div>
        <div class="bar-row-head">
          <span>${m.mode}</span>
          <span class="mono muted">${fmtInt(m.count)} (${pct.toFixed(1)}%)</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${i === 0 ? 'lead-bar' : ''}" style="width:${Math.max(2, pct).toFixed(1)}%"></div>
        </div>
      </div>
    `
  }).join('')
}

function renderFeed(v) {
  const items = v.feed.slice(0, 30)
  $('#feedList').innerHTML = items.map(item => {
    const isPaid = /award|paid|settled|complet/i.test(item.type || '')
    const when = item.timestamp ? new Date(item.timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : ''
    const amt = item.amountUsd ? ` · ${fmtUsd(item.amountUsd)} ${item.token}` : ''
    return `
      <div class="feed-item">
        <span class="feed-badge ${isPaid ? 'paid' : ''}">${item.type}</span>
        <div>
          <div class="feed-title">${item.taskTitle || item.taskId}</div>
          <div class="feed-meta mono">${item.chainKey} · actor ${item.actorShort}${amt}</div>
        </div>
        <div class="feed-meta mono">${when}</div>
      </div>
    `
  }).join('')
}

function renderMethods() {
  $('#endpointList').innerHTML = (state.data.endpoints || []).map(ep => `<li>${ep}</li>`).join('')
}

function renderAll() {
  const v = getScopedView()
  const asOf = new Date(state.data.asOf).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  $('#asOfText').textContent = `Data as of ${asOf}`
  renderKPIs(v)
  renderEscrowFlow(v)
  renderTimeSeries(v)
  renderPostersAndHealth(v)
  renderHeatmapAndModes(v)
  renderFeed(v)
  renderMethods()
}

function generateShareCard(viewName = 'overview') {
  const canvas = $('#shareCanvas')
  const ctx = canvas.getContext('2d')
  const v = getScopedView()

  // Ground + maroon glow
  ctx.fillStyle = '#12100E'
  ctx.fillRect(0, 0, 1200, 630)
  const glow = ctx.createRadialGradient(0, 0, 20, 0, 0, 620)
  glow.addColorStop(0, 'rgba(58, 20, 32, 0.92)')
  glow.addColorStop(1, 'rgba(18, 16, 14, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 1200, 630)

  // Border frame
  ctx.strokeStyle = '#453E37'
  ctx.lineWidth = 2
  ctx.strokeRect(28, 28, 1144, 574)

  // Headline
  ctx.fillStyle = '#FFF6E8'
  ctx.font = '64px "Instrument Serif", Georgia, serif'
  ctx.fillText('Taskmarket live market,', 64, 136)
  ctx.fillStyle = '#E74079'
  ctx.font = 'italic 64px "Instrument Serif", Georgia, serif'
  ctx.fillText('measured.', 620, 136)

  ctx.fillStyle = '#B0A79D'
  ctx.font = '20px "Departure Mono", monospace'
  ctx.fillText(`${v.label.toUpperCase()}  ·  VIEW: ${viewName.toUpperCase()}`, 64, 182)

  // 4 live metric panels
  const latestWk = v.weeklyPosters.at(-1)
  const boxes = [
    ['ACTIVE AGENTS (7D)', fmtInt(v.stats.activeAgents7d)],
    ['OPEN TASKS', fmtInt(v.stats.openTasks)],
    ['POSTED ESCROW', fmtUsd(v.analytics.totalRewardPostedUsd)],
    ['POSTERS THIS WEEK', fmtInt(latestWk?.distinctPosters ?? 0)],
  ]
  boxes.forEach(([lbl, val], i) => {
    const x = 64 + i * 272
    const y = 240
    ctx.fillStyle = '#221E1A'
    ctx.fillRect(x, y, 250, 160)
    ctx.strokeStyle = '#453E37'
    ctx.strokeRect(x, y, 250, 160)
    ctx.fillStyle = '#B0A79D'
    ctx.font = '14px "Departure Mono", monospace'
    ctx.fillText(lbl, x + 20, y + 42)
    ctx.fillStyle = i === 0 ? '#E74079' : '#FFF6E8'
    ctx.font = '38px "Departure Mono", monospace'
    ctx.fillText(val, x + 20, y + 114)
  })

  // Footer sign-off
  const asOf = new Date(state.data.asOf).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  ctx.fillStyle = '#B0A79D'
  ctx.font = '16px "Departure Mono", monospace'
  ctx.fillText(`Data as of ${asOf}  ·  api.taskmarket.dev`, 64, 540)
  ctx.fillStyle = '#EFE9E2'
  ctx.textAlign = 'right'
  ctx.fillText('taskmarket.dev', 1136, 540)
  ctx.textAlign = 'left'

  const link = document.createElement('a')
  link.download = `taskmarket-${state.chain}-${viewName}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
  showToast(`Downloaded share card (${viewName})`)
}

function bindEvents() {
  $$('.chain-switch .seg').forEach(btn => {
    btn.addEventListener('click', () => {
      state.chain = btn.dataset.chain
      $$('.chain-switch .seg').forEach(b => {
        b.classList.toggle('active', b === btn)
        b.setAttribute('aria-selected', String(b === btn))
      })
      syncUrlState()
      renderAll()
    })
  })

  $$('.range-switch .seg-sm').forEach(btn => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range
      $$('.range-switch .seg-sm').forEach(b => b.classList.toggle('active', b === btn))
      syncUrlState()
      renderAll()
    })
  })

  $$('.view-nav .nav-link').forEach(a => {
    a.addEventListener('click', () => {
      $$('.view-nav .nav-link').forEach(x => x.classList.toggle('active', x === a))
    })
  })

  $('#copyLinkBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      showToast('Copied live view URL')
    } catch {
      showToast('Copy from address bar')
    }
  })

  $('#shareCardBtn').addEventListener('click', () => {
    const view = (location.hash || '#overview').replace('#', '')
    generateShareCard(view)
  })

  $$('[data-share-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.shareView
      location.hash = `#${view}`
      syncUrlState()
      generateShareCard(view)
    })
  })
}

async function init() {
  readUrlState()
  $$('.chain-switch .seg').forEach(b => {
    const active = b.dataset.chain === state.chain
    b.classList.toggle('active', active)
    b.setAttribute('aria-selected', String(active))
  })
  $$('.range-switch .seg-sm').forEach(b => {
    b.classList.toggle('active', b.dataset.range === state.range)
  })
  bindEvents()

  const res = await fetch('data/market.json', { cache: 'default' })
  state.data = await res.json()
  renderAll()
}

init().catch(err => {
  $('#asOfText').textContent = 'Snapshot load error'
  console.error(err)
})
