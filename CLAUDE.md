# SMG II /// DRIVELOGIC

E46 M3 の SMG II（DS2 `0x32`）を読み、マップを書くツール。ブラウザのみ、サーバ無し。
Next.js 16 / React 19 / Tailwind v4、`output: 'export'`。dev は 5047（`wrangler pages dev` は 5048）。

## 参照するスキル

指示が無くても、手を動かす前に読む。

| 何を決めるとき | スキル |
|---|---|
| 意匠・レイアウト・ハブ・z-index・文言 | `tsunagi-m-design` |
| 技術選定・リポジトリ構成・検査列・ポート | `tsunagi-m-stack` |
| 環境・配信・命名・アイコン | `tsunagi-m-release` |
| スマホでの実装 | `tsunagi-m-mobile` |

## この repo の決まり

- **読み取りと書き込みはパッケージで分かれている。**`@tsunagi/ds2-smg2` は読むだけで、
  書き込みは `@tsunagi/ds2-smg2-write` にしか無い。前者に書き込みを足さない。
- `@tsunagi/ds2-core` は fork ではなく**複製**。`scripts/verify-ds2-core-sync.mjs` が
  上流（E46M3-Diagnosis）とのハッシュ差でビルドを落とす。直すのは上流側。
- `scripts/deploy.mjs` は `out/sw.js` の `SOURCE_ID` が現在のソースと一致しなければ拒む。
  この砦を迂回しない。
- `src/components/ui.tsx` がこの系で最も揃ったプリミティブ集。新しい部品はここに足す。
