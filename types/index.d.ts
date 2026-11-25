export type Meter = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
}

// 目前在跑的背景任務：shell = 背景指令，agent = 背景子代理，monitor = 監控。
export type BgTask = { id: string; kind: 'shell' | 'agent' | 'monitor'; startedAt: number; endedAt?: number; isFresh?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'starry-sky': { meter: Meter | null; tasks: BgTask[] }
  }
}
