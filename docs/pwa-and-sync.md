# PWA・モバイル抽出・SYNC

## 全体像

```
[Android Chrome]                      [Cloudflare Pages]        [D1]
 PWA (installed)                   ゲート → /api/extractions ─▶ extractions（owner ごと）
   │                                          ▲                     │
   │ WebUSB + FTDI                            │ SYNC gzip+base64    │
   ▼                                          │                     ▼
 K+DCAN ──▶ SMG II (DS2 0x32)  ── READ ×2 ────┘              npm run pull
                                                                    │
                                                                    ▼
                                                          data/extractions/*.bin
```

デスクトップは Web Serial、Android は WebUSB。**上位のコードは分岐しません** —
`@tsunagi/ds2-transport` が Tuner と同じ形（1つの `Ds2ByteTransport` 契約・2バックエンド・
共通部分は `BufferedByteTransport`）を取るので、`Ds2Link` / `Smg2ReadLink` はどちらでも同一です。

> **経路判定の落とし穴（実際に踏んだ）**: Chrome for Android 138+ は `navigator.serial` を
> 露出しますが、**Bluetooth RFCOMM しか列挙しません**。USB の K+DCAN はそのピッカーに絶対に
> 出ない。両者を区別する feature test は存在しないので、**Android は名前で判定**します。
> 「capability があるなら使う」で書いた初版は、スマホで空のピッカーを開いていました。
> `packages/ds2-transport/src/select.test.ts` がこの規則を固定しています。

**iOS は不可**です。Safari は Web Serial も WebUSB も持たず、代替もありません。
アプリはその旨を文章で言います（押しても何も起きないボタンは置きません）。

---

## モバイルで必要なもの

| | |
|---|---|
| 端末 | Android + Chrome。**iOS 不可** |
| ケーブル | K+DCAN（FTDI FT232R）。**H シリーズ / FT-X は拒否**します（分周器のエンコードが違い、黙って誤クロックするより断る方が安全） |
| 変換 | USB-OTG アダプタ |
| 電源 | イグニッション ON・エンジン停止・バッテリーチャージャ |
| 配信 | **HTTPS 必須**（WebUSB はセキュアコンテキスト限定）。Pages のドメインで満たされます |

Android は USB デバイスの許可を**訪問ごと**に求めます。CONNECT を押すと chooser が出ます。
これは仕様で、回避策はありません。

### FTDI の設定値（テストで固定済み）

| 項目 | 値 | 理由 |
|---|---|---|
| 8E1 | `SIO_SET_DATA 0x0208` | DS2 は偶数パリティ。8N1 だと受信側がストップビットの位置でパリティを見て**全フレームがフレーミングエラー**になる |
| 9600 分周器 | `0x4138` | AN232B-05 の公表値と一致。モジュール読み込み時に再計算して検証 |
| RX パージ | `SIO_RESET` サブコマンド **2** | libftdi 1.4 以前は 1 だったが 1.5 で実機に合わせて入れ替わった |
| レイテンシ | 16 ms | 既定値。DS2 のタイムアウトより十分短い |
| DTR/RTS | リセット**後**に low | リセットがモデム制御状態を消すので順序が意味を持つ |

**パケットごとに 2 バイトのステータスヘッダ**が付きます（転送ごとではありません）。
オフセット 0 だけ剥がすと、64 バイトごとに 2 バイトのゴミが入った
「開けるし復号もできるが間違っている」ダンプができます。テストは 8 バイトパケットで
24 KiB 全体を読み、これを実証しています。

---

## SYNC と D1（プレビュー版だけ）

製品版（`app-variant` が空）は**同期の要求を1本も出しません**。プレビュー版も、**初回の告知が確認されるまでは
出しません**。`sync.ts`・`diagnostics.ts`・`useCloud` は要求を作る前に `syncAllowed()`（`src/lib/previewNotice.ts`）を
確かめて、偽なら戻ります。真になるのは、`src/lib/owner-sync.ts`（tsunagi-m3 `tools/owner-gate/client` の複製。
`gate:verify` が一致を確かめる）の `isPreviewBuild()` が真で、かつこのブラウザで告知が確認済みのときだけです。

### 初回の告知

プレビュー版は初めて開いたときに、送るもの（保存したセッションとエラーの記録）、いつ送るか、使いみち、
保存先と見られる人、削除の方法をダイアログで示します（`src/components/PreviewNoticeDialog.tsx`）。
× も背景のタップも Escape も無く、出口は「確認して続ける」だけで、その間は後ろの `<main>` が `inert` です。

- 確認は `localStorage` の `preview-notice:v1`（確認した時刻）。無い・読めないなら告知を出します。
  書けないときはそのページの間だけ通し、次に開いたときにもう一度出します
- 確認の前に生まれた診断レコードは送らずに outbox（`smg2-outbox`）に置き、確認後の最初の flush で送ります。
  この端末でアカウントが一度も確かめられていなければ宛先が分からないので、送らずに捨てます（outbox の規則）
- 送る中身を変えたら、告知の文面（`previewNotice.ts`）とプライバシーポリシーの `#preview` を一緒に直し、
  キーの版を上げます（`v2`）。全員にもう一度示すためです

### 誰の行か

- 要求は同一オリジン・Cookie 付き。**トークンも設定もありません**。以前の共有トークン
  （`NEXT_PUBLIC_SYNC_TOKEN` / Pages シークレット `UPLOAD_TOKEN`）は廃止し、コードから消しました。
  公開ページに埋め込まれていたので、ページを開いた人なら誰でも全行を読み書きできたためです
- 持ち主はゲート（`functions/_middleware.ts`）が m3 に確かめたアカウントで、ハンドラは
  `ownerOf(context.data)` からしか取りません。無ければ 401。**全クエリに `owner = ?`**
- 他人の id への POST は 409、他人の id の GET は 404、DELETE は何も消しません
- 1 行 1.9 MB を超えるものは書く前に 413（D1 の上限は 2 MB で、超えると 500 しか返らない）
- `/api/*` の GET 以外は、Origin がこのサイトのときだけ通します（ゲート）。CORS ヘッダは出しません

### 経路

| 経路 | 中身 |
|---|---|
| `POST /api/extractions` | SYNC（ハブの面）。セッションのクラウドの控え: 元のイメージ・読み取りの記録・編集。同じセッションをもう一度 SYNC すると同じ行を更新 |
| `GET /api/extractions` | 自分の一覧（イメージは含めない）。`?practice=1` で PRACTICE も |
| `GET /api/extractions/:id` | 1 行、イメージ込み。STARTUP › CLOUD の RESTORE が使う |
| `DELETE /api/extractions/:id` | 自分の行だけ |
| `POST /api/diagnostics` | 診断レコード（下の §通信ログ） |
| `GET /api/diagnostics`・`GET/DELETE /api/diagnostics/:id` | 同上 |

**RESTORE** はイメージを行の SHA-256 と照合してから、編集をセル単位で当て直して端末の SESSIONS に入れます
（`src/lib/cloudRestore.ts`）。この端末にすでに同じイメージの編集があれば、置き換えるか確かめます。

### D1

```
database  smg2-tuner-runs
id        e7728f3c-7a98-4c4b-a9fb-a3b763210a54
binding   RUNS_DB
tables    extractions, diagnostics
```

`migrations/0003_owner.sql` で持ち主を入れました。

- **extractions は作り直し**（1 ファイルの中で新表・複写・削除・改名）。以前は id が画像の SHA-256 で、
  `ON CONFLICT(id) DO NOTHING` でした。オーナーが複数になると、同じ純正較正を読んだ2人目の行が
  201 を返したまま黙って捨てられます。今は **id は不透明なキー**（端末のセッション id）で、
  `sha256` は別の列、一意なのは `(owner, sha256)`。同じ較正を2人が読めば2行です。
  既存の行は id をそのまま残し、`sha256` に id を写し、運営者のアカウント
  `ac5c6c31-5137-4fd7-9b5d-ceb17f98027c` のものにしました
- **diagnostics** は `owner` 列を足し（NULL 可。既定の持ち主を作らないため）、既存の行を運営者のものにし、
  owner が NULL の INSERT と UPDATE を trigger で拒否します
- どちらも `(owner, created_at DESC)` の index

運営者がリモートに当てるときは、先に `wrangler d1 export smg2-tuner-runs --remote` で控えを取り
（git の外に置く）、time-travel の時点を記録し、前後で件数が合うことを確かめます。

### スキーマの考え方

- **画像は gzip → base64 の TEXT**。BLOB だと `wrangler d1 execute --json` が整数配列で返して
  扱いにくい。24 KiB は gzip で数 KiB になるので base64 の +33% は誤差
- **一覧に必要な値は全部カラムに出す**。`checksum_stored`（`0x32080` の 16bit）が典型で、
  チェックサム算法の同定は「多数の画像の格納値」が要る作業なので、
  ダウンロードして解凍するループではなくクエリ1本で済むようにしてある
- **`practice` フラグは発生源で付ける**。シミュレータのバイト列はもっともらしいので、
  後から見分ける方法がない

### 取り出し方（運営者）

```bash
npm run pull                          # 実データのみ、新しい順に50件
npm run pull -- --list                # メタデータだけ、ダウンロードしない
npm run pull -- --practice            # シミュレート分も含める
npm run pull -- --sha <sha256 の先頭>  # 1つのイメージ（持ち主ごとの行すべて）
npm run pull -- --owner <uuid>        # 1つのアカウントの行
npm run pull -- --id <id>             # 1 行
```

一覧には行ごとに**持ち主**（UUID の先頭 8 文字）が出ます。イメージは id ではなく **SHA-256 で探します**
（id はセッションのキーで、同じイメージが持ち主ごとに別の id を持つため）。

`data/extractions/<hash12>.bin` に**解凍済みの生バイナリ**が落ちます（`.log.txt` と
`.edits.json` があれば一緒に。同じイメージが2人分あるときだけ名前に持ち主が付きます）。
ハッシュは書き出し時に**再計算して照合**します — バイト列が `sha256` と一致しない行は
ECU からディスクまでのどこかで壊れており、それを解析に半日使った後に気付くより今気付く方がはるかに安い。

`data/` は gitignore 済みです（他人の ECU のダンプと車両識別子なので）。

### 直接クエリ

```bash
npx wrangler d1 execute smg2-tuner-runs --remote --command "SELECT sha256, owner, zb_number, printf('0x%04X', checksum_stored) AS cksum, created_at FROM extractions WHERE practice=0 ORDER BY created_at DESC"
```

---

## 配信

```
https://e46m3smg2-mapping-preview.pages.dev   （プレビュー。オリジン全体がゲートの内側）
```

```bash
npm run deploy -- --check   # 関門とビルドだけ。何も上げない
npm run deploy              # 関門 → プレビュー版のビルド → wrangler pages deploy out --branch main
```

`scripts/deploy.mjs` は次のどれかで拒否します（冒頭のコメントに理由）:
`wrangler.jsonc` の name がプレビューのプロジェクトでない / `functions/_middleware.ts` が無いか
`gate:verify` が落ちる / `check-public-tree` が落ちる / 作業ツリーが汚れている（追跡外の CLAUDE.md と
`.claude/` は除く）/ HEAD が `origin/main` と違う（リモートが無ければ「先に push」）/
ビルドの `app-variant` が preview でない・`sync-token` meta がある・手元の `.0DA` と `.xdf` が `out/` に無い /
`out/sw.js` の `SOURCE_ID` が今のソースのハッシュと違う。

プロジェクトは **Fail closed** にします（関数の上限を超えたときに、ゲートを通らず資産がそのまま出るのを防ぐ）。
シークレットは `M3_CLIENT_SECRET` だけで、m3 に登録した client `smg2-preview` のものです。

### デプロイ前に見つかった不具合（記録）

ローカルとデプロイの検証で3件出ました。どれもテストでは捕まらない種類です。

1. **`wrangler pages dev` が `functions/` を見つけない** — cwd が別リポジトリだった。
   `CF_PAGES_URL` が別プロジェクト名を指していたのが手がかり
2. **`--d1 RUNS_DB=名前` はマイグレーションと別のDBを作る** — miniflare は名前文字列で
   ローカルDBを識別するので、`database_id` に当てたマイグレーションと一致しない。
   `wrangler.jsonc` の binding を読ませる（＝フラグを付けない）のが正解
3. **Service Worker が評価に失敗し、無言で PWA 機能が死んでいた** —
   `String.replace` は文字列パターンだと1回しか置換せず、テンプレートの
   **doc コメント内の `__BUILD_ID__` が先に一致**していた。実コードは
   `const PRECACHE = __PRECACHE__`（未定義識別子）のままデプロイされ、ブラウザは
   「ServiceWorker script evaluation failed」で拒否。オフラインもインストールも
   静かに効かない状態だった

   → `replaceAll` に変更し、**置換漏れと構文エラーをビルド失敗にする**ガードを
   `gen-sw.mjs` に追加。ワーカーは `next build` が一切実行しないので、
   ここが唯一の早期発見地点

   ついでに `sw.js` が**自分自身を precache** していたのも除外した。
   古いワーカーのコードが後の訪問で返りうる＝network-first にした理由そのものの事故

手元で Functions・ゲートごと動かす手順は README の §手元で動かす。

---

## Service Worker

**network-first** です。オフライン対応の定番は cache-first ですが、ここでは間違いです:
先代の PWA は cache-first で出荷され、**一度訪問したユーザーに修正が届かなくなりました**。
ECU を読むツールで「動いているコードが修正済みのコードではない」のは見た目の問題ではありません。

- ネットワークが答えればネットワークが勝つ。キャッシュは純粋にオフラインの退避
- **`/_gate/*` と `/api/*` はネットワークだけ**で、ナビゲーションのフォールバックより前に除外する。
  キャッシュされた 201 は「保存できた」と嘘をつき、キャッシュされたゲートの応答はログインを壊す
- **アプリでない応答はアプリとして出さない。** ゲートの 302（`opaqueredirect`）、401・403・503 など 2xx 以外が
  返ったら、キャッシュにあればそちらを返す（ナビゲーションも precache 済みの URL も）。
  ログインの期限が切れたオーナーも、オフラインと同じように手元の版で動き続けられる
- **更新の取得は全部揃ったときだけ成功**: どのファイルも `ok`・`type==='basic'`・リダイレクトされていないか
  同一オリジンの `/_gate/` 以外へ・拡張子に合う Content-Type。1つでも外れたら新しいワーカーは入らず、
  旧版とそのキャッシュが残る。`.html` は拡張子なしの URL で取り（Pages は `/index.html` を 308 で返す）、
  元のキーで保存する
- ビルドIDは**内容のハッシュ**（タイムスタンプではない）。中身が変わっていない再デプロイで
  全ユーザーのキャッシュを捨てさせない
- **勝手に交代しない。** install で `skipWaiting` しない。待機中のワーカーがあり、今のページに controller が
  あるときだけ UPDATE を出し、押されたら `skip-waiting` を送って `controllerchange` で1回だけ reload する。
  **ケーブルがつながっている間は UPDATE を隠し、`visibilitychange` での更新確認もしない**
  （読み出しの最中の交代・reload は抽出を消す）
- `/factory/*.0DA` と `/xdf/*` は手元のビルドから配り、ゲートの内側にある（リポジトリには入っていない）


---

## 画面レイアウト（///M モバイル house rules 準拠）

```
header 48  ● 車載中に一目で読むものだけ（リンク状態・素性）
content    900px 未満は1ペインずつ
hub  ~116  ★ デバイス操作。全幅・全ビューで常時表示
footer 44  ナビゲーション。インジケータは上辺
```

**垂直バジェット**（短い横長が最初に壊れるので必ず書く）:

| | |
|---|---|
| 851×393 | 393 − 48 − 44 − 116 = **185** content |
| 360×800 | 800 − 48 − 44 − 116 = **592** content |

### 破って学んだルール

- **書込・読出系のコントロールをメニューやペインの裏に置かない。** READ と SHARE（今の SYNC）を
  「CONTROL」ペインの裏に隠していたため、スマホでは「読むボタンも送るボタンも無い」状態でした。
  hub は両ペインの外・footer の上に出し、**全幅で常時表示**にしました
- **SYNC は hub の面**です（プレビュー版だけ。製品版では READ の後は RE-READ）。CONNECT → PROBE → READ → SYNC が主系列で、
  hub は「次にやる1つ」の単一キュー。パネルに置くと探しに行く物になります
- **`title` は配達手段ではない。** hover が無いので、`title` にしか無い文章は電話では存在しません。
  MapGrid の raw 値は hover 依存だったので、タップで読める readout に変えました
- **footer のインジケータは上辺。** 下辺だと画面端で半分切れて何も読めません
- 計測: 851×393 / 360×800 / 1440×900 の3つで確認（wide は φ=0.618 のまま非回帰）

**メニューシートは作っていません。** house rules に「メニューにしか無いコントロールは
ブレークポイントより上では存在しない」とあり、隠す先が要るほど項目が無いためです。
全操作が全幅で見えています。

---

## 通信ログ（diagnostics）

抽出とは**別テーブル**です。抽出はイメージが要るので、**イメージを生まなかった実行**
— 接続拒否、プローブ不一致、205テレグラム中140で死んだ読み出し — が端末から出られませんでした。

- **自動で送ります（プレビュー版）。** 読み取りが終わるたび、接続・PROBE・読み取りが失敗するたびに1件。
  ガレージでエンジンを止めて SEND を押す人はいないし、失敗は起きたその時に取らないと残らないため。
  止めた（STOP）読み取りは記録しません — 止めたのは判断で、故障ではない
- **黙って、失敗しない。** 送れないとき（オフライン・401・5xx）は IndexedDB の outbox（`smg2-outbox`、
  直近 20 件）に置き、次に送れたときに送ります。記録の失敗が操作の失敗になることはありません
- SEND も残っています。成功・失敗の両方で送れ、送れたか・保管したかを言います。workspace の有無に依存しません
- STARTUP › CLOUD の RECORDS に自分の記録の一覧が出て、削除できます
- 中身: セッションログ ＋ **実テレグラム**（TX/RX の hex と経過ms）
- トレースは head 200 / tail 400 で打ち切り、**省略件数をその場に書きます**
  （読んでいる人が省略を「回線の沈黙」と誤読しないため）
- 取り出し（運営者）: `npm run pull:diag` / `npm run pull:diag -- --failed` /
  `npm run pull:diag -- --sha <イメージの SHA-256 の先頭>`。行ごとに持ち主が出ます
