# starry-sky

A cosmos theme for Claude Code in the Claude desktop app (Code tab). A ringed planet on the right side of the window shows your usage at a glance, with no text:

| What you see | What it means |
| --- | --- |
| The planet's lit phase (full = fresh) | Context window used |
| The moon orbiting the planet | 5-hour usage limit: it travels almost a full loop (over the top, across the front, round the bottom); 5 dots mark each hour |
| How much of the ring glows (left-back → front → right-back) | 7-day usage limit; 7 dots mark each day |
| Extra stars below the planet | Background tasks running in this session (one star each; they fade out when the task ends) |

Trails turn from blue to amber at 60% and to red at 85%.

Light and dark mode only change the background: pastel nebulae in light mode, deep space in dark mode. A large, slowly turning spiral galaxy disk on the left and frequent shooting stars complete the scene.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install starry-sky --marketplace therealclvn/starry-sky
```

Answer `y` to add the marketplace, then pick the user scope. Or from a shell:

```
claude plugin install starry-sky --marketplace therealclvn/starry-sky
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `therealclvn/starry-sky`, then Add plugin.

Conversations that were already open load it after they restart.

## Notes

- The theme draws in the desktop and mobile apps' local Code sessions. The terminal draws no theme, and the Chat tab is not affected.
- Usage figures update when Claude Code measures them: after each turn, or when a rate-limit window moves a whole point.
- Background-task stars track this session's own background commands, background subagents and monitors.

---

宇宙主題：右側的行星用圖像表示用量——盈缺是 context，衛星是 5 小時額度，行星環發光的長度是 7 天額度；有背景任務時，行星下方會亮起星星，任務結束就淡出。安裝方式同上。
