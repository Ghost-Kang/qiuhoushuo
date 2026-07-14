# @qhs/share-cards

Server-side share-card renderer for QiuHouShuo.

## Install

This package is consumed from the repo through pnpm workspace linking.

```bash
pnpm --filter @qhs/share-cards build
pnpm --filter @qhs/share-cards test
```

## API

`renderCard(style, platform, data, options?)` renders a PNG `Buffer` by default.

```ts
import { renderCard } from '@qhs/share-cards';

const png = await renderCard('duanzi', 'wechat', {
  competition: '国际大赛小组赛',
  date: '2026.06.22',
  homeTeam: '巴西',
  awayTeam: '西班牙',
  homeScore: 2,
  awayScore: 1,
  title: '巴西 2:1 西班牙：传控大师败给了打不死的小强',
  shareQuote: '西班牙赢了控球率，输给了想象力。',
  brand: 'AI 战报 · 老李',
  shortUrl: 'qiu.app/m/8a3f',
});
```

## Exports

| Export | Purpose |
| --- | --- |
| `renderCard` | Main renderer. |
| `TOKENS` | Style color tokens. |
| `SIZES` | Platform pixel sizes. |
| `CardPayload` | Input payload type. |
| `Style` | `hardcore`, `duanzi`, `emotion`. |
| `Platform` | `wechat`, `xhs`, `x`. |

## Platforms

| Platform | Size |
| --- | --- |
| `wechat` | 1080 x 1080 |
| `xhs` | 1080 x 1440 |
| `x` | 1200 x 675 |

## Notes

Hardcore cards require possession, shots, shots-on-target, and xG fields. Duanzi
and emotion cards can render from the base payload and use template fallbacks for
missing optional stats.
