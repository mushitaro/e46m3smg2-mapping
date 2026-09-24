# E46M3SMG2 /// MAPPING

E46 M3 の SMG II（DS2 `0x32`）を読み、マップを書くツール。
Next.js 16 / React 19 / Tailwind v4、`output: 'export'`。dev は 5047（`wrangler pages dev` は 5048）。
製品版（`npm run build`）はブラウザだけで動き、どこにも送らない。オーナー向けプレビュー版
（`npm run build:preview`、Pages プロジェクト `e46m3smg2-mapping-preview`）には
Pages Functions（`functions/`）、オリジン全体を覆うオーナーゲート（`functions/_middleware.ts`）、
D1（`smg2-tuner-runs`、binding `RUNS_DB`、`migrations/`）がある。

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
- `functions/_owner-gate/*` と `src/lib/owner-sync.ts` は tsunagi-m3 の `tools/owner-gate` の
  **バイト単位の複製**で、ここでは決して編集しない。直すのは正本の側で、直したら複製し直して
  `npm run gate:verify` で一致を確かめる。
- `/api/*` のクエリはすべてオーナーで絞る（`owner = ?`）。オーナーはゲートが渡したもの
  （`ownerOf(context.data)`）だけから取り、リクエストの中身からは取らない。
- プレビュー版が送るのは、初回の告知で「確認して続ける」が押されたあとだけ。送る経路
  （`sync.ts`・`diagnostics.ts`・`useCloud`、そして新しく足す経路）は、要求を作る前に
  `syncAllowed()`（`src/lib/previewNotice.ts`）を確かめる。送る中身を変えたら、告知の文面と
  プライバシーポリシーの `#preview` を一緒に直し、キーの版を上げる。
- デプロイは `npm run deploy` だけ。`wrangler pages deploy` を直接叩かない。
- `public/factory/`（BMW の工場較正）と `public/xdf/`（第三者の XDF）は手元にだけ置くファイルで、
  git に入れない（`.gitignore` 済み、`npm run check:public-tree` とデプロイの砦が検査する）。
