# PWA・モバイル抽出・D1 共有

## 全体像

```
[Android Chrome]                      [Cloudflare Pages]        [D1]
 PWA (installed)                        /api/extractions   ──▶  extractions
   │                                          ▲                     │
   │ WebUSB + FTDI                            │ POST gzip+base64    │
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

## D1

### 作成済みのもの

```
database  smg2-tuner-runs
id        e7728f3c-7a98-4c4b-a9fb-a3b763210a54
region    APAC
table     extractions   (migrations/0001_extractions.sql 適用済み)
```

### スキーマの考え方

- **画像は gzip → base64 の TEXT**。BLOB だと `wrangler d1 execute --json` が整数配列で返して
  扱いにくい。24 KiB は gzip で数 KiB になるので base64 の +33% は誤差
- **一覧に必要な値は全部カラムに出す**。`checksum_stored`（`0x32080` の 16bit）が典型で、
  チェックサム算法の同定は「多数の画像の格納値」が要る作業なので、
  ダウンロードして解凍するループではなくクエリ1本で済むようにしてある
- **`practice` フラグは発生源で付ける**。シミュレータのバイト列はもっともらしいので、
  後から見分ける方法がない

### 取り出し方（これが「共有」の実体）

```bash
npm run pull                 # 実データのみ、新しい順に50件
npm run pull -- --list       # メタデータだけ、ダウンロードしない
npm run pull -- --practice   # シミュレート分も含める
npm run pull -- --id <sha256>
```

`data/extractions/<hash12>.bin` に**解凍済みの生バイナリ**が落ちます（`.log.txt` と
`.edits.json` があれば一緒に）。ハッシュは書き出し時に**再計算して照合**します —
バイト列が id と一致しない行は ECU からディスクまでのどこかで壊れており、
それを解析に半日使った後に気付くより今気付く方がはるかに安い。

`data/` は gitignore 済みです（他人の ECU のダンプと車両識別子なので）。

### 直接クエリ

```bash
npx wrangler d1 execute smg2-tuner-runs --remote --command "SELECT sha256, zb_number, printf('0x%04X', checksum_stored) AS cksum, created_at FROM extractions WHERE practice=0 ORDER BY created_at DESC"
```

---

## デプロイ（実施済み）

```
https://smg2-drivelogic.pages.dev
```

```bash
# 初回のみ
npx wrangler pages project create smg2-drivelogic --production-branch main
printf '%s' "$TOKEN" | npx wrangler pages secret put UPLOAD_TOKEN --project-name smg2-drivelogic

# 初回のみ: ビルドが毎回拾えるところに置く（`.env.local` は gitignore 済み）
printf 'NEXT_PUBLIC_SYNC_TOKEN=%s
' "$(cat .sync-token)" >> .env.local

# 以後
npm run deploy
```

**順序が意味を持ちます**。Pages シークレットの `UPLOAD_TOKEN` とページに埋める
`NEXT_PUBLIC_SYNC_TOKEN` が一致していないと、アプリは自分のAPIから 401 を受けます。
ローテートするときはシークレット更新 → 同じ値で `.env.local` を更新 → デプロイ、の順で。

> **`.env.local` に置く理由**（実際にやらかした記録）。
> 以前はこの変数をコマンドラインで渡していました。一度 `npm run deploy` を素で叩いた結果、
> ビルドは成功し、デプロイも成功し、アプリも普通に起動し、**READ まで全部通ってから
> SHARE で 401** になりました。ビルド時には何も間違っておらず、18 分のフルダンプの
> 一番最後まで気づけない種類の失敗です。`.env.local` なら Next が黙って拾うので、
> 渡し忘れという経路そのものが無くなります。

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

`UPLOAD_TOKEN` は**秘密ではありません**。静的ページに埋め込まれるので、
ページを開いた人は読めます。無差別なトラフィックを弾く書き込みゲートであって、
それ以上のものとして扱わないこと。API は追記と読み出ししかできず、削除も更新も無く、
車両には一切届きません。本当のアクセス制御が要るなら Cloudflare Access をプロジェクトの前に置きます。

ビルド時に埋めるには:

```bash
NEXT_PUBLIC_SYNC_TOKEN=<token> npm run deploy
```

ローカルで Functions ごと動かす:

```bash
npm run build && npm run preview     # wrangler pages dev out
# 初回だけ、ローカルDBにもマイグレーションを当てる:
#   npx wrangler d1 migrations apply smg2-tuner-runs
```

---

## Service Worker

**network-first** です。オフライン対応の定番は cache-first ですが、ここでは間違いです:
先代の PWA は cache-first で出荷され、**一度訪問したユーザーに修正が届かなくなりました**。
ECU を読むツールで「動いているコードが修正済みのコードではない」のは見た目の問題ではありません。

- ネットワークが答えればネットワークが勝つ。キャッシュは純粋にオフラインの退避
- ビルドIDは**内容のハッシュ**（タイムスタンプではない）。中身が変わっていない再デプロイで
  全ユーザーのキャッシュを捨てさせない
- `skipWaiting` + `clients.claim` で即座に交代するが、**タブのリロードは自分でしない**。
  読み出しの最中にリロードすると 2 分の抽出が消える。新版が来たことを伝えて、
  リロードするかどうかは UI が出す
- `/api/*` は**キャッシュしない**。キャッシュされた 201 は「D1 に届いた」と嘘をつく


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

- **書込・読出系のコントロールをメニューやペインの裏に置かない。** READ と SHARE を
  「CONTROL」ペインの裏に隠していたため、スマホでは「読むボタンも送るボタンも無い」状態でした。
  hub は両ペインの外・footer の上に出し、**全幅で常時表示**にしました
- **SHARE は hub の面**です。CONNECT → PROBE → READ → SHARE が主系列で、
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

- **成功・失敗の両方で送れます。** workspace の有無に依存しません
- 中身: セッションログ ＋ **実テレグラム**（TX/RX の hex と経過ms）
- トレースは head 200 / tail 400 で打ち切り、**省略件数をその場に書きます**
  （読んでいる人が省略を「回線の沈黙」と誤読しないため）
- 取り出し: `npm run pull:diag` / `npm run pull:diag -- --failed`
