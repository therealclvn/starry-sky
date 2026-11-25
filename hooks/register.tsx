import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, ThemeSetArgs } from 'claude-code'

import type { BgTask, Meter } from '../types'
import { makeColors } from './make-colors.js'

// 宇宙主題：深色是深空，淺色是粉彩星雲；明暗只換背景。
// 右側一顆行星表示用量：本體盈缺 = context，衛星 = 5 小時，行星環 = 7 天。
const { theme, problems } = makeColors({
  label: 'Starry sky',
  roles: { accent: '#5b74e0', danger: '#c4493e', success: '#3f8a5a', warning: '#b27b1d', pro: '#8b5ec9' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e4e9f4',
        'surface-1': '#ecf0f8',
        'surface-2': '#f5f7fc',
        'text-primary': '#182036',
        'text-secondary': '#3b4560',
        'text-muted': '#56607c',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0d1222',
        'surface-1': '#131a2d',
        'surface-2': '#192136',
        'surface-3': '#1e273e',
        'text-primary': '#e9edf8',
        'text-secondary': '#c4cce1',
        'text-muted': '#9ba5c0',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: 'starry', glass: { blur: 0, opacity: 0.4 } },
}

const meter = atom({ plugin: 'starry-sky', key: 'meter' } as const, null)
// 加上 shape 標籤：換標籤時舊資料一律當作空的，順便清掉之前漏接結束通知而累積的星星。
const tasks = atom({ plugin: 'starry-sky', key: 'tasks' } as const, [] as BgTask[], { shape: 'tasks-2' })

// ── 場景 ──
// 構圖靠右上對齊（xMaxYMin slice）：視窗變窄時裁左邊，變寬時裁底部，右側的用量永遠看得到。

type Pt = [number, number]

function rand(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const W = 1600
const H = 1000

// 不隨用量變動的星星：數量少、顆粒大、亮星帶光暈，避免像螢幕上的灰塵。
const STATIC = (() => {
  const r = rand(20261125)
  const out: string[] = []
  for (let i = 0; i < 70; i++) {
    const x = Math.round(r() * W)
    const y = Math.round(r() * H)
    // 右側用量區留白。
    if (x > 1200 && y < 900) continue
    const big = r() < 0.22
    const size = big ? 2.2 + r() * 1.2 : 1.1 + r() * 0.8
    const delay = (r() * 9).toFixed(1)
    const dur = (6 + r() * 6).toFixed(1)
    if (big) {
      out.push(`<circle class="halo" cx="${x}" cy="${y}" r="${(size * 5).toFixed(1)}"/>`)
    }
    out.push(
      `<circle class="star tw" cx="${x}" cy="${y}" r="${size.toFixed(1)}" style="animation-delay:-${delay}s;animation-duration:${dur}s"/>`,
    )
  }
  return out.join('\n')
})()

// 右側一顆行星儀表，不用文字，數值都是連續的：
// 本體盈缺 = context（用掉越多，陰影越大）
// 繞行衛星 = 5 小時額度（從行星左上方出發，經過最上端、行星前方、最下端，繞回行星右下方是 100%；5 個點代表 5 小時）
// 行星環發光的長度 = 7 天額度（從左後方出發，經過前方，到右後方是 100%；7 個點代表 7 天）
const P: Pt = [1410, 370]
const PR = 96
const RING = { rx: 168, ry: 40, tilt: -22 }
// 軌道幾乎直立，放進對話欄右邊那條窄而高的空白。
const ORBIT = { rx: 290, ry: 70, tilt: -72 }
// 量表的缺口放在被行星擋住的那段（環的正後方），其餘幾乎整圈都用：點和軌跡不會出現在行星背後。
const ORBIT_GAUGE = { start: 288, span: 324, dir: 1 }
const RING_GAUGE = { start: 205, span: 230, dir: -1 }

function level(p: number): string {
  if (p >= 85) return 'hot'
  if (p >= 60) return 'warm'
  return 'cool'
}

function clampPct(p: number | null): number | null {
  return p === null ? null : Math.max(0, Math.min(100, p))
}

// 橢圓上依弧長比例取點（局部座標，未旋轉）。start 是起始角（度），dir 為 1 順時針、-1 逆時針。
function ellipseAt(rx: number, ry: number, start: number, dir: number, t: number, span = 360): Pt {
  const N = 720
  const pts: Pt[] = []
  const acc: number[] = [0]
  for (let i = 0; i <= N; i++) {
    const a = ((start + dir * (span * i) / N) * Math.PI) / 180
    pts.push([rx * Math.cos(a), ry * Math.sin(a)])
    if (i > 0) {
      const p0 = pts[i - 1]!
      const p1 = pts[i]!
      acc.push(acc[i - 1]! + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]))
    }
  }
  const target = acc[N]! * Math.max(0, Math.min(1, t))
  let i = 1
  while (i < N && acc[i]! < target) i++
  return pts[i]!
}

// 從起始角繞一圈的橢圓路徑（局部座標），配合 pathLength=100 用百分比畫虛線。
function ellipsePath(rx: number, ry: number, start: number, dir: number): string {
  const a = (start * Math.PI) / 180
  const sx = rx * Math.cos(a)
  const sy = ry * Math.sin(a)
  const sweep = dir > 0 ? 1 : 0
  return `M${sx.toFixed(1)} ${sy.toFixed(1)} A${rx} ${ry} 0 1 ${sweep} ${(-sx).toFixed(1)} ${(-sy).toFixed(1)} A${rx} ${ry} 0 1 ${sweep} ${sx.toFixed(1)} ${sy.toFixed(1)}`
}

// 從起始角沿方向 dir 走 span 度的橢圓弧（局部座標），配合 pathLength=100。
function arcD(rx: number, ry: number, start: number, span: number, dir: number): string {
  const a1 = (start * Math.PI) / 180
  const a2 = ((start + dir * span) * Math.PI) / 180
  const large = span > 180 ? 1 : 0
  const sweep = dir > 0 ? 1 : 0
  return `M${(rx * Math.cos(a1)).toFixed(1)} ${(ry * Math.sin(a1)).toFixed(1)} A${rx} ${ry} 0 ${large} ${sweep} ${(rx * Math.cos(a2)).toFixed(1)} ${(ry * Math.sin(a2)).toFixed(1)}`
}

// 漸淡尾巴：多層從不同起點畫到目前位置的線段疊起來。
function trail(d: string, v: number, lv: string, width: number): string {
  return [0, 1, 2, 3, 4, 5]
    .map(k => {
      const start = (v * k) / 6
      const len = v - start
      return len < 0.3
        ? ''
        : `<path class="trail ${lv}" d="${d}" pathLength="100" stroke-width="${width}" stroke-dasharray="${len.toFixed(2)} 200" stroke-dashoffset="${(-start).toFixed(2)}"/>`
    })
    .join('')
}

// 額度環的刻度：5 小時軌道 5 個點（一點一小時），7 天行星環 7 個點（一點一天）。
// 點放在每一段的終點（5 個點在 20、40、60、80、100%，100% 就是量表終點）；用量走過的會亮起。
function gaugeTicks(rx: number, ry: number, g: { start: number; span: number; dir: number }, v: number | null, lv: string, steps: number): string {
  const out: string[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const p = t * 100
    const [x, y] = ellipseAt(rx, ry, g.start, g.dir, t, g.span)
    const isMajor = steps <= 10 || i % (steps / 4) === 0
    const isPassed = v !== null && v >= p - 0.001
    const r = (isMajor ? 3.2 : 1.9) + (isPassed ? 0.6 : 0)
    out.push(`<circle class="${isPassed ? `tick-on ${lv}` : 'dim'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>`)
  }
  return out.join('')
}

function planet(m: Meter | null): string {
  const [cx, cy] = P
  const ctx = clampPct(m?.contextPercent ?? null)
  const five = clampPct(m?.limits.find(l => l.kind === 'five_hour')?.percentUsed ?? null)
  const week = clampPct(m?.limits.find(l => l.kind === 'seven_day')?.percentUsed ?? null)
  const tiltRatio = RING.ry / RING.rx

  // ── 本體盈缺（光從右邊來）：整顆先畫好（含條紋），再疊幾層錯開一點的陰影，
  // 交界就是柔和的漸層；暗面還看得到淡淡的條紋，比較像球體轉到背光面。
  const f = ctx === null ? 1 : 1 - ctx / 100
  const term = (g: number): string => {
    const gg = Math.max(0, Math.min(1, g))
    return `${(PR * Math.abs(2 * gg - 1)).toFixed(1)} ${PR} 0 0 ${gg >= 0.5 ? 1 : 0}`
  }
  const litPath = `M${cx} ${cy - PR} A${PR} ${PR} 0 0 1 ${cx} ${cy + PR} A${term(f)} ${cx} ${cy - PR} Z`
  const shade = Array.from({ length: 12 }, (_, i) => -0.08 + (0.16 * i) / 11)
    .map(d => `<path class="shade" d="M${cx} ${cy - PR} A${PR} ${PR} 0 0 0 ${cx} ${cy + PR} A${term(f + d)} ${cx} ${cy - PR} Z"/>`)
    .join('')
  const bands = [-0.62, -0.36, -0.12, 0.12, 0.34, 0.58]
    .map((k, i) => {
      const y0 = k * PR
      const w = PR * Math.sqrt(1 - k * k)
      const ry = (w * tiltRatio).toFixed(1)
      return `<path class="band b${i % 3}" d="M${(-w).toFixed(1)} ${y0.toFixed(1)} A${w.toFixed(1)} ${ry} 0 0 0 ${w.toFixed(1)} ${y0.toFixed(1)}" stroke-width="${(10 + (i % 2) * 7) * (0.6 + 0.4 * Math.sqrt(1 - k * k))}"/>`
    })
    .join('')
  const ringShadow = `<path class="ring-shadow" d="M${-PR} 14 A${PR} ${(PR * tiltRatio).toFixed(1)} 0 0 0 ${PR} 14"/>`
  const body = `<defs>
<clipPath id="pDisk"><circle cx="${cx}" cy="${cy}" r="${PR}"/></clipPath>
<clipPath id="pLit"><path d="${litPath}"/></clipPath>
</defs>
<circle cx="${cx}" cy="${cy}" r="${PR * 2.3}" fill="url(#pGlow)" opacity="${(0.35 + 0.65 * f).toFixed(2)}"/>
<g clip-path="url(#pDisk)">
<circle cx="${cx}" cy="${cy}" r="${PR}" fill="url(#pBody)"/>
<g transform="translate(${cx} ${cy}) rotate(${RING.tilt})">${bands}${ringShadow}</g>
${shade}
<circle cx="${cx}" cy="${cy}" r="${PR}" fill="url(#pLimb)"/>
</g>
<circle class="p-atmo" cx="${cx}" cy="${cy}" r="${PR - 1.5}" clip-path="url(#pLit)"/>
<circle class="p-rim" cx="${cx}" cy="${cy}" r="${PR}"/>`

  // ── 行星環（7 天）：左後方起、經前方到右後方，避開被行星擋住的那段。
  const ringD = ellipsePath(RING.rx, RING.ry, 180, -1)
  const ringFrontD = arcD(RING.rx, RING.ry, RING_GAUGE.start, RING_GAUGE.span, RING_GAUGE.dir)
  const wlv = week === null ? 'cool' : level(week)
  const ringTicks = gaugeTicks(RING.rx, RING.ry, RING_GAUGE, week, wlv, 7)
  const ringLayer = `<path class="ring-base" d="${ringD}"/><path class="ring-inner" d="${ellipsePath(RING.rx - 20, RING.ry - 5, 180, -1)}"/>`
  // 量表軌跡與刻度前後同樣粗細亮度，但後半畫在行星後面（被擋住），前半畫在行星前面。
  const ringGaugeBody = `<path class="gauge-track" d="${ringFrontD}"/>${week === null || week === 0 ? '' : trail(ringFrontD, week, wlv, 6)}${ringTicks}`
  const ringGauge = (clip: string) =>
    `<g class="gauge ring" transform="translate(${cx} ${cy}) rotate(${RING.tilt})"><g clip-path="url(#${clip})">${ringGaugeBody}</g></g>`
  const ringG = (clip: string, side: string) =>
    `<g class="${side} ring" transform="translate(${cx} ${cy}) rotate(${RING.tilt})"><g clip-path="url(#${clip})">${ringLayer}</g></g>`

  // ── 衛星（5 小時）：從軌道最上端順時針；在前方時大而亮，繞到後方小而暗、被行星擋住
  const orbitD = arcD(ORBIT.rx, ORBIT.ry, ORBIT_GAUGE.start, ORBIT_GAUGE.span, ORBIT_GAUGE.dir)
  const slv = five === null ? 'cool' : level(five)
  const orbitTicks = gaugeTicks(ORBIT.rx, ORBIT.ry, ORBIT_GAUGE, five, slv, 5)
  const orbitLayer = `<path class="track faint" d="${ellipsePath(ORBIT.rx, ORBIT.ry, 0, 1)}"/><path class="track" d="${orbitD}"/>`
  const orbitGaugeBody = `<path class="gauge-track" d="${orbitD}"/>${five === null || five === 0 ? '' : trail(orbitD, five, slv, 3)}${orbitTicks}`
  const orbitGauge = (clip: string) =>
    `<g class="gauge orbit" transform="translate(${cx} ${cy}) rotate(${ORBIT.tilt})"><g clip-path="url(#${clip})">${orbitGaugeBody}</g></g>`
  const orbitG = (clip: string, side: string) =>
    `<g class="${side} orbit" transform="translate(${cx} ${cy}) rotate(${ORBIT.tilt})"><g clip-path="url(#${clip})">${orbitLayer}</g></g>`
  let moonFront = ''
  let moonBack = ''
  if (five !== null) {
    const [mx, my] = ellipseAt(ORBIT.rx, ORBIT.ry, ORBIT_GAUGE.start, ORBIT_GAUGE.dir, five / 100, ORBIT_GAUGE.span)
    const depth = 0.7 + 0.45 * ((my / ORBIT.ry + 1) / 2)
    const r = 14 * depth
    const X = mx.toFixed(1)
    const Y = my.toFixed(1)
    const sat = `<g class="${my < 0 ? 'back' : 'front'}" transform="translate(${cx} ${cy}) rotate(${ORBIT.tilt})"><g class="sat ${slv}">
<circle class="halo" cx="${X}" cy="${Y}" r="${(r * 2.3).toFixed(1)}"/>
<circle cx="${X}" cy="${Y}" r="${r.toFixed(1)}" fill="url(#satBody)" transform="rotate(${-ORBIT.tilt} ${X} ${Y})"/>
<circle class="sat-ring" cx="${X}" cy="${Y}" r="${(r + 4).toFixed(1)}"/>
</g></g>`
    // 衛星繞到後方時會被行星擋住，並縮小變暗。
    if (my < 0) moonBack = sat
    else moonFront = sat
  }

  // 後半（上方，被行星擋住）與前半（下方，蓋在行星上）分兩次畫。
  const halves = `<defs>
<clipPath id="backHalf"><rect x="-500" y="-400" width="1000" height="400"/></clipPath>
<clipPath id="frontHalf"><rect x="-500" y="0" width="1000" height="400"/></clipPath>
</defs>`

  return `${halves}
${orbitG('backHalf', 'back')}
${orbitGauge('backHalf')}
${moonBack}
${ringG('backHalf', 'back')}
${ringGauge('backHalf')}
${body}
${ringG('frontHalf', 'front')}
${ringGauge('frontHalf')}
${orbitG('frontHalf', 'front')}
${orbitGauge('frontHalf')}
${moonFront}`
}

// 螺旋星系：一個實心的星系盤面。中央一大團亮白核心往外漸藍，
// 盤面由大量沿緊密螺旋排列的短弧線和亮點組成（偏向兩條旋臂的走向），深色模式下弧線間有暗色縫隙。
// 整體壓扁傾斜成斜看的圓盤，慢慢自轉；佔滿對話欄左邊那一大塊。
const GALAXY = (() => {
  const r = rand(7)
  const R = 330
  const PITCH = 0.22 // 螺旋纏繞程度，越小越緊
  const streaks: string[] = []
  const darks: string[] = []
  const dots: string[] = []
  const arcSeg = (rr: number, a0: number, da: number): string => {
    const r2 = rr * (1 + PITCH * da * 0.35)
    const x1 = rr * Math.cos(a0)
    const y1 = rr * Math.sin(a0)
    const x2 = r2 * Math.cos(a0 + da)
    const y2 = r2 * Math.sin(a0 + da)
    return `M${x1.toFixed(0)} ${y1.toFixed(0)}A${rr.toFixed(0)} ${rr.toFixed(0)} 0 0 1 ${x2.toFixed(0)} ${y2.toFixed(0)}`
  }
  // 兩條旋臂的相位：在半徑 rr 處旋臂中心的角度。
  const armAngle = (rr: number, arm: number) => Math.log(rr / 10) / PITCH + arm * Math.PI
  for (let i = 0; i < 300; i++) {
    const rr = 24 + Math.pow(r(), 0.75) * (R - 24)
    const onArm = r() < 0.75
    const a0 = onArm ? armAngle(rr, r() < 0.5 ? 0 : 1) + (r() + r() - 1) * 0.55 : r() * Math.PI * 2
    const da = 0.12 + r() * 0.42
    const roll = r()
    const cls = rr < R * 0.35 ? (roll < 0.6 ? 'gs1' : 'gs3') : roll < 0.45 ? 'gs2' : roll < 0.8 ? 'gs1' : 'gs3'
    const w = (1 + r() * 2.2) * (1.15 - (rr / R) * 0.5)
    streaks.push(`<path class="${cls}" d="${arcSeg(rr, a0, da)}" stroke-width="${w.toFixed(1)}"/>`)
  }
  for (let i = 0; i < 50; i++) {
    const rr = 40 + Math.pow(r(), 0.8) * (R - 40)
    const a0 = armAngle(rr, r() < 0.5 ? 0 : 1) + Math.PI / 2 + (r() + r() - 1) * 0.5
    darks.push(`<path d="${arcSeg(rr, a0, 0.15 + r() * 0.35)}" stroke-width="${(1.5 + r() * 2.5).toFixed(1)}"/>`)
  }
  for (let i = 0; i < 90; i++) {
    const rr = 20 + Math.pow(r(), 0.7) * (R - 20)
    const a = r() * Math.PI * 2
    dots.push(`<circle cx="${(rr * Math.cos(a)).toFixed(0)}" cy="${(rr * Math.sin(a)).toFixed(0)}" r="${(0.6 + r() * 1.6).toFixed(1)}"/>`)
  }
  return `<g transform="translate(310 560) rotate(-32) scale(1 0.6)">
<circle r="${R * 1.3}" fill="url(#galaxyGlow)"/>
<circle r="${R * 1.02}" fill="url(#galaxyDisk)"/>
<g class="spin">
<g class="gdark">${darks.join('')}</g>
<g class="gstreak">${streaks.join('')}</g>
<g class="gdots">${dots.join('')}</g>
</g>
<circle r="${R * 0.42}" fill="url(#galaxyCore)"/>
<circle r="${R * 0.1}" class="gnucleus"/>
</g>`
})()

// 背景任務星：只有在有背景任務時才出現，一個任務一顆，在行星下方，位置由任務 ID 決定（範圍內隨機、之後不跳動）。
// 剛開始的任務慢慢浮現，結束的任務慢慢淡出消失。顏色分種類：指令偏藍、子代理偏紫、監控偏青綠。
const BG_AREA = { x0: 1240, x1: 1590, y0: 720, y1: 880 }
const BG_FADE_IN_MS = 2000
const BG_FADE_OUT_MS = 2400

function hashSeed(id: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 2147483647
}

function bgStars(bg: BgTask[]): string {
  const placed: Pt[] = []
  return bg
    .slice(0, 12)
    .map((t, i) => {
      let pt: Pt = [BG_AREA.x0, BG_AREA.y0]
      for (let salt = 0; salt < 12; salt++) {
        const r = rand(hashSeed(t.id, salt) || 1)
        const cand: Pt = [BG_AREA.x0 + r() * (BG_AREA.x1 - BG_AREA.x0), BG_AREA.y0 + r() * (BG_AREA.y1 - BG_AREA.y0)]
        pt = cand
        if (placed.every(p => Math.hypot(p[0] - cand[0], p[1] - cand[1]) > 46)) break
      }
      placed.push(pt)
      const [x, y] = pt
      const X = x.toFixed(1)
      const Y = y.toFixed(1)
      const k = 1.6
      const L = 11
      // 畫圖時不讀時鐘（讀了會變成每一幀都重畫）：剛加入的播浮現，結束的播淡出，其他靜止。
      const fade =
        t.endedAt !== undefined
          ? `animation:bgout ${BG_FADE_OUT_MS}ms ease-out forwards`
          : t.isFresh === true
            ? `animation:bgin ${BG_FADE_IN_MS}ms ease-out forwards`
            : ''
      return `<g style="${fade}"><g class="bg ${t.kind}" style="animation-delay:-${(i * 0.7).toFixed(1)}s"><circle class="bg-halo" cx="${X}" cy="${Y}" r="26"/><path d="M${x} ${y - L} L${x + k} ${y - k} L${x + L} ${y} L${x + k} ${y + k} L${x} ${y + L} L${x - k} ${y + k} L${x - L} ${y} L${x - k} ${y - k} Z"/><circle cx="${X}" cy="${Y}" r="3"/></g></g>`
    })
    .join('')
}

function buildScene(m: Meter | null, bg: BgTask[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMin slice">
<style>
.star { fill: #ffffff; opacity: 0.95; }
.halo { fill: url(#halo); }
.dim { fill: #6a72b4; opacity: 0.7; }
.track { fill: none; stroke: #6a72b4; stroke-width: 1.4; stroke-dasharray: 3 7; stroke-linecap: round; opacity: 0.6; }
.trail, .trail.cool, .trail.warm, .trail.hot { fill: none; }
.trail { stroke-linecap: round; opacity: 0.34; }
.cool { fill: #3d55c8; stroke: #3d55c8; }
.warm { fill: #b0700f; stroke: #b0700f; }
.hot { fill: #c03a2f; stroke: #c03a2f; }
.tick-on { opacity: 0.95; }
.ring-base { fill: none; stroke: #8c80c4; stroke-width: 7; opacity: 0.45; }
.ring-inner { fill: none; stroke: #a69bd6; stroke-width: 3; opacity: 0.35; }
.back { opacity: 0.55; }
.back.ring .ring-base { stroke-width: 6; }
.back .trail { stroke-width: 4; }
.front.ring .ring-base { stroke-width: 13; opacity: 0.55; }
.front.ring .trail { stroke-width: 11; }
.front.orbit .track { stroke-width: 2; opacity: 0.75; }
.back.orbit .track { stroke-width: 1; }
.track.faint { opacity: 0.18; stroke-dasharray: 2 9; }
.gauge.ring .trail { stroke-width: 10; }
.gauge.orbit .trail { stroke-width: 4; }
.gauge-track { fill: none; stroke: #8c80c4; stroke-width: 3; opacity: 0.35; }
.bg { animation: pulse 3.2s ease-in-out infinite; }
.bg-halo { fill: url(#halo); }
.bg.shell { fill: #4a63d8; }
.bg.agent { fill: #8a4fd0; }
.bg.monitor { fill: #1f9c95; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes bgin { from { opacity: 0; } to { opacity: 1; } }
@keyframes bgout { from { opacity: 1; } to { opacity: 0; } }
.sat-ring { fill: none; stroke: #ffffff; stroke-width: 1; opacity: 0.3; }
.band { fill: none; opacity: 0.4; }
.b0 { stroke: #fbe3c4; }
.b1 { stroke: #a8685a; }
.b2 { stroke: #eab38c; }
.ring-shadow { fill: none; stroke: #2a1a2a; stroke-width: 10; opacity: 0.28; }
.p-atmo { fill: none; stroke: #ffe8d6; stroke-width: 3; opacity: 0.5; }
.sat { animation: glow 7s ease-in-out infinite; }
.p-dark { fill: #1a1d3c; }
.shade { fill: #0b0d22; opacity: 0.14; }
.p-rim { fill: none; stroke: #ffffff; stroke-width: 1; opacity: 0.18; }
.n1 { stop-color: #f4a6cf; }
.n2 { stop-color: #9fd3f0; }
.n3 { stop-color: #c8b3f2; }
.n4 { stop-color: #fbc9a8; }
.sk0 { stop-color: #dfe3f7; }
.sk1 { stop-color: #ebe4f5; }
.sk2 { stop-color: #f6e9ec; }
.gstreak path, .gdark path { fill: none; stroke-linecap: round; }
.gs1 { stroke: #6f7fd6; opacity: 0.4; }
.gs2 { stroke: #4f62c8; opacity: 0.36; }
.gs3 { stroke: #a99be8; opacity: 0.36; }
.gdark path { stroke: #2a2050; opacity: 0; }
.gdots { fill: #5a62c8; opacity: 0.7; }
.gnucleus { fill: url(#galaxyNucleus); }
.gl0 { stop-color: #c4b4f6; }
.gd0 { stop-color: #e6d9ff; }
.gc0 { stop-color: #ffd79a; }
.shoot { stroke: #ffffff; }
@media (prefers-color-scheme: dark) {
  .bg.shell { fill: #e4ebff; }
  .bg.agent { fill: #e2c8ff; }
  .bg.monitor { fill: #b8fff4; }
  .dim { fill: #8a92c8; opacity: 0.7; }
  .track { stroke: #9aa3d8; }
  .cool { fill: #c9d3ff; stroke: #a9b8ff; }
  .warm { fill: #ffd690; stroke: #ffbe5c; }
  .hot { fill: #ffa894; stroke: #ff806a; }
  .ring-base { stroke: #e6dcf6; }
  .gauge-track { stroke: #e6dcf6; }
  .trail { opacity: 0.22; }
  .ring-inner { stroke: #c9bde8; }
  .n1 { stop-color: #b8338f; }
  .n2 { stop-color: #148f9c; }
  .n3 { stop-color: #5537b8; }
  .n4 { stop-color: #2a4fc4; }
  .sk0 { stop-color: #02030a; }
  .sk1 { stop-color: #080b22; }
  .sk2 { stop-color: #120d2a; }
  .gs1 { stroke: #eef2ff; opacity: 0.4; }
  .gs2 { stroke: #7fa2ff; opacity: 0.36; }
  .gs3 { stroke: #c8c4ff; opacity: 0.32; }
  .gdark path { stroke: #03020a; opacity: 0.3; }
  .gdots { fill: #ffffff; opacity: 0.85; }
  .gl0 { stop-color: #5a46c8; }
  .gd0 { stop-color: #6c80e8; }
  .gc0 { stop-color: #fff3d8; }
}
.tw { animation: twinkle 8s ease-in-out infinite; }
@keyframes twinkle { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.45; } }
@keyframes glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }
@keyframes turn { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.spin { animation: turn 420s linear infinite; }
.neb { animation: drift 90s ease-in-out infinite alternate; }
.neb2 { animation-duration: 120s; animation-direction: alternate-reverse; }
@keyframes drift { from { transform: translate(-40px, 10px); } to { transform: translate(40px, -10px); } }
.shoot { stroke-width: 2; stroke-linecap: round; opacity: 0; }
.s1 { animation: shoot1 9s linear infinite; }
.s2 { animation: shoot2 13s linear infinite; animation-delay: -5s; }
.s3 { animation: shoot3 17s linear infinite; animation-delay: -11s; }
@keyframes shoot1 { 0% { opacity: 0; transform: translate(900px, 120px); } 2% { opacity: 0.9; } 11% { opacity: 0; transform: translate(560px, 290px); } 100% { opacity: 0; transform: translate(560px, 290px); } }
@keyframes shoot2 { 0% { opacity: 0; transform: translate(600px, 520px); } 1.5% { opacity: 0.8; } 8% { opacity: 0; transform: translate(330px, 655px); } 100% { opacity: 0; transform: translate(330px, 655px); } }
@keyframes shoot3 { 0% { opacity: 0; transform: translate(1080px, 300px); } 1.2% { opacity: 0.85; } 6% { opacity: 0; transform: translate(760px, 460px); } 100% { opacity: 0; transform: translate(760px, 460px); } }
</style>
<defs>
<linearGradient id="space" x1="0" y1="0" x2="0.4" y2="1">
<stop offset="0" class="sk0"/>
<stop offset="0.55" class="sk1"/>
<stop offset="1" class="sk2"/>
</linearGradient>
<radialGradient id="neb1"><stop offset="0" class="n1" stop-opacity="0.55"/><stop offset="1" class="n1" stop-opacity="0"/></radialGradient>
<radialGradient id="neb2"><stop offset="0" class="n2" stop-opacity="0.5"/><stop offset="1" class="n2" stop-opacity="0"/></radialGradient>
<radialGradient id="neb3"><stop offset="0" class="n3" stop-opacity="0.55"/><stop offset="1" class="n3" stop-opacity="0"/></radialGradient>
<radialGradient id="neb4"><stop offset="0" class="n4" stop-opacity="0.45"/><stop offset="1" class="n4" stop-opacity="0"/></radialGradient>
<radialGradient id="pBody" cx="0.72" cy="0.3" r="0.9"><stop offset="0" stop-color="#ffe2c2"/><stop offset="0.55" stop-color="#e79f78"/><stop offset="1" stop-color="#9c5b52"/></radialGradient>
<radialGradient id="pNight" cx="0.4" cy="0.45" r="0.7"><stop offset="0" stop-color="#3a3466" stop-opacity="0.9"/><stop offset="1" stop-color="#0c0e22" stop-opacity="1"/></radialGradient>
<radialGradient id="pLimb" cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#2a1420" stop-opacity="0.45"/></radialGradient>
<radialGradient id="satBody" cx="0.7" cy="0.35" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#d9d6e6"/><stop offset="1" stop-color="#5d5f7e"/></radialGradient>
<radialGradient id="pGlow"><stop offset="0.3" stop-color="#ffd9b8" stop-opacity="0.35"/><stop offset="1" stop-color="#ffd9b8" stop-opacity="0"/></radialGradient>
<radialGradient id="galaxyGlow"><stop offset="0" class="gl0" stop-opacity="0.55"/><stop offset="0.5" class="gl0" stop-opacity="0.18"/><stop offset="1" class="gl0" stop-opacity="0"/></radialGradient>
<radialGradient id="galaxyDisk"><stop offset="0" class="gd0" stop-opacity="0.6"/><stop offset="0.45" class="gd0" stop-opacity="0.32"/><stop offset="0.8" class="gd0" stop-opacity="0.14"/><stop offset="1" class="gd0" stop-opacity="0"/></radialGradient>
<radialGradient id="galaxyCore"><stop offset="0" class="gc0" stop-opacity="1"/><stop offset="0.25" class="gc0" stop-opacity="0.85"/><stop offset="0.6" class="gc0" stop-opacity="0.3"/><stop offset="1" class="gc0" stop-opacity="0"/></radialGradient>
<radialGradient id="galaxyNucleus"><stop offset="0" stop-color="#ffffff" stop-opacity="1"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<radialGradient id="halo">
<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>
<stop offset="0.35" stop-color="#dfe5ff" stop-opacity="0.18"/>
<stop offset="1" stop-color="#dfe5ff" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#space)"/>
<g class="neb"><ellipse cx="420" cy="260" rx="520" ry="260" transform="rotate(-18 420 260)" fill="url(#neb1)"/></g>
<g class="neb neb2"><ellipse cx="900" cy="620" rx="560" ry="240" transform="rotate(22 900 620)" fill="url(#neb3)"/></g>
<g class="neb"><ellipse cx="1150" cy="300" rx="420" ry="220" transform="rotate(-30 1150 300)" fill="url(#neb2)"/></g>
<g class="neb neb2"><ellipse cx="300" cy="820" rx="460" ry="200" fill="url(#neb4)"/></g>
${GALAXY}
${STATIC}
<g class="shoot s1"><line x1="0" y1="0" x2="130" y2="-65"/></g>
<g class="shoot s2"><line x1="0" y1="0" x2="110" y2="-55"/></g>
<g class="shoot s3"><line x1="0" y1="0" x2="120" y2="-60"/></g>
${planet(m)}
${bgStars(bg)}
</svg>`
}

// ── 用量 ──

function toMeter(context: SessionContextUsage, rateLimits: SessionRateLimit[]): Meter {
  return {
    contextPercent: context.percent ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
    limits: rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt ?? null })),
  }
}

// ── 背景任務追蹤：啟動時從工具結果拿到 ID；結束時（任務通知、TaskStop、子代理清單）先標記結束讓星星淡出，再移除。
// 這些都要是檔案最上層的函式宣告，引擎才肯讓 $ 傳進來。
async function addTask($: EngineInterface, id: string, kind: BgTask['kind']): Promise<void> {
  const now = await $.clock.now()
  await update($, tasks, list => [...list.filter(x => x.id !== id), { id, kind, startedAt: now, isFresh: true }])
  void clearFresh($, id)
}

// 浮現播完後拿掉標記，之後重畫就不會再播一次。
async function clearFresh($: EngineInterface, id: string): Promise<void> {
  try {
    await $.clock.sleep(BG_FADE_IN_MS + 200)
    await update($, tasks, list => list.map(x => (x.id === id ? { ...x, isFresh: false } : x)))
  } catch {
    // 下次加入時會重設。
  }
}

async function endTasks($: EngineInterface, isDone: (t: BgTask) => boolean): Promise<void> {
  const now = await $.clock.now()
  let changed = false
  await update($, tasks, list =>
    list
      .filter(x => x.endedAt === undefined || now - x.endedAt < BG_FADE_OUT_MS + 400)
      .map(x => {
        if (x.endedAt === undefined && isDone(x)) {
          changed = true
          return { ...x, endedAt: now }
        }
        return x
      }),
  )
  if (changed) {
    void pruneEnded($)
  }
}

// 淡出播完後把它拿掉。
async function pruneEnded($: EngineInterface): Promise<void> {
  try {
    await $.clock.sleep(BG_FADE_OUT_MS + 300)
    const later = await $.clock.now()
    await update($, tasks, list => list.filter(x => x.endedAt === undefined || later - x.endedAt < BG_FADE_OUT_MS))
  } catch {
    // 下一次更新時也會清掉。
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    const set = await $.theme.set(LOOK)
    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }
    // 清掉舊資料：已結束的、舊格式的、超過 12 小時還掛著的（多半是漏接結束通知）。
    try {
      const now = await $.clock.now()
      await update($, tasks, list =>
        (list ?? []).filter(x => typeof x.startedAt === 'number' && x.endedAt === undefined && now - x.startedAt < 12 * 3600 * 1000).map(x => ({ ...x, isFresh: false })),
      )
    } catch {
      // 清不掉也不影響主題。
    }
    try {
      const usage = await $.session.usage()
      await update($, meter, () => toMeter(usage.context, usage.rateLimits))
    } catch (error) {
      $.ui.log(`starry-sky: usage unavailable: ${String(error)}`)
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, meter, () => toMeter(e.context, e.rateLimits))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    try {
      const res = (r as { result?: unknown }).result
      const out = typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : {}
      const input = e as unknown as Record<string, unknown>
      if (e.tool === 'Bash' && typeof out.backgroundTaskId === 'string') {
        await addTask($, out.backgroundTaskId, 'shell')
      } else if (e.tool === 'Agent' && out.status === 'async_launched' && typeof out.agentId === 'string') {
        await addTask($, out.agentId, 'agent')
      } else if (e.tool === 'Monitor' && typeof out.taskId === 'string') {
        await addTask($, out.taskId, 'monitor')
      } else if (e.tool === 'TaskStop' && typeof input.task_id === 'string') {
        const id = input.task_id
        await endTasks($, t => t.id === id)
      }
    } catch (error) {
      $.ui.log(`starry-sky: task tracking skipped: ${String(error)}`)
    }
    return r
  }).catch(($, e, next) => next(e))

  // 任務結束的通知：文字裡帶著任務 ID 和結束狀態。
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      // 通知裡提到的任務：指令和子代理一收到通知就算結束；監控會在執行中持續發通知，要看到結束字樣才算。
      const text = e.text
      const isEnd = /(completed|failed|killed|stopped|timed?[ _-]?out|error|exited|finished|cancel)/i.test(text)
      await endTasks($, t => text.includes(t.id) && (t.kind !== 'monitor' || isEnd))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // 保險：每回合結束時，拿子代理清單把已經結束的標記掉。
  on('turn.complete', async ($, e, next) => {
    // 保險：子代理照清單對（已結束或清單裡沒有的就標記結束）；指令超過 3 小時、監控超過 1 小時還沒收到結束通知的也收掉。
    try {
      const now = await $.clock.now()
      const agents = await $.agent.list()
      const running = agents.filter(a => !['completed', 'failed', 'killed'].includes(a.status))
      const live = new Set(running.map(a => a.id))
      // 還在跑、但沒被記到的子代理（例如重新載入前就開始的）補回來。
      const known = new Set((await read($, tasks)).map(t => t.id))
      for (const a of running) {
        if (!known.has(a.id) && a.kind === 'local_agent') {
          await addTask($, a.id, 'agent')
        }
      }
      await endTasks($, t =>
        (t.kind === 'agent' && !live.has(t.id)) ||
        (t.kind === 'shell' && now - t.startedAt > 3 * 3600 * 1000) ||
        (t.kind === 'monitor' && now - t.startedAt > 3600 * 1000),
      )
    } catch {
      // 拿不到清單就算了。
    }
    return next(e)
  })

  // 背景讀用量；用量一變（每回合結束或額度動一個百分點）就重畫。
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const m = await read($, meter)
    const bg = await read($, tasks)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={buildScene(m, bg)} alt="Deep space with a ringed planet. Its lit phase shows context used, its orbiting moon shows the 5-hour limit, and how much of its ring glows shows the 7-day limit. Extra bright stars near the planet appear only while background tasks are running." />
  })
}
