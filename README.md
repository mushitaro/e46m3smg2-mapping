# SMG II DRIVELOGIC

TSUNAGI ///M — E46 M3 の **SMG II 変速機 ECU（Siemens SMG2、software 510、DS2 `0x32`）** の
較正領域を車両から吸い出し、TunerPro XDF 定義で読み書きするツール。

> **このビルドは ECU に書き込めません。** 消去・書込のバイト列を組み立てるコードが存在せず、
> ロード時の不変条件がそれを保証しています（`packages/ds2-smg2/src/link.ts` → `assertReadOnly`）。
> 理由は §書き込みが無い理由 を参照。

```bash
npm install
npm run dev      # http://localhost:5047
npm test         # 152 tests
npm run build    # 静的エクスポート + Service Worker 生成
npm run preview  # wrangler pages dev（Functions + D1 込み）
npm run pull     # D1 から抽出データを data/extractions/ に落とす
```

## 手元に必要なファイル（このリポジトリには入っていないもの）

このリポジトリは公開です。次の 3 種類は**他者のもの、または 1 台の車のもの**なので入っていません
（`.gitignore` 済み。`npm run check:public-tree` がコミット前と CI で検査します）。
理由と出所は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

| 置き場所 | 中身 | 無いとどうなるか |
|---|---|---|
| `public/xdf/Siemens_SMG_II_510_24K.xdf`<br>`public/xdf/Siemens_SMG_II_510_512K.xdf` | MS4X Dev Team の TunerPro XDF（Olza 提供） | 読み取りと EXPORT はできるが、較正を**解読できない**（CALIBRATION タブが開かない）。XDF に依存するテストは skip |
| `packages/xdf-engine/fixtures/` に同じ 2 本 | 上と同じファイル（パーサのテストが中身を固定している） | `smg2-510.test.ts` が skip |
| `public/factory/Y7843256.0DA` … `Y7843259.0DA` | BMW SP-DATEN（`E46_v74/data/GDSMG2/`）の較正データ 4 本 | STOCK / 他 ZB の参照が出ない（「工場参照なし」と表示、アプリは動く） |
| `E46_v74/` | BMW SP-DATEN 一式 | 工場データと実車の照合テスト（`factory.test.ts`）が skip |
| `data/extractions/5c5a0c857acd.bin` ほか | 実車から読んだイメージ | 実車に対するテスト（CRC・逆アセンブル・消去表）が skip |

どれも**自分で入手したものを置く**前提です。ここから配布はしません。
`npm test` は新しい clone でも通ります（該当するテストは skip と表示されます）。
変更を信じる前には、ファイルを置いた状態で一度通してください — skip は合格ではありません。


**経路判定は Tuner に準拠**。Android は名前で判定して WebUSB に回します —
Chrome for Android は `navigator.serial` を持つのに Bluetooth しか列挙せず、
USB の K+DCAN はピッカーに出ないためです。`/link-check` で自分の端末の経路を確認できます。

**PWA / モバイル / D1 共有**: Android Chrome から WebUSB(FTDI) で吸い出して
Cloudflare D1 に上げ、`npm run pull` で手元に落とせます。詳細は
[docs/pwa-and-sync.md](docs/pwa-and-sync.md)。iOS は Web Serial も WebUSB も無いため**非対応**。

ハードウェア無しで全経路を試すには、DEVICE タブの **PRACTICE MODE**。
シミュレートされるのは**デバイス**であって、リンクではありません
（`WebSerialTransport` / `Ds2Link` / `Smg2ReadLink` は本番クラスがそのまま動きます）。

---

## チューニング

編集面の全体は **`docs/tuning-tool.md`**。要点だけ:

- 編集集合は **raw 保持・自己相殺**。編集数 = 実際に変わるセル数で、`edited` は導出値
- **111 項目すべてが編集可能**（定数 56 個は `MapGrid` の静的表示で施錠されていた）
- エクスポートには**マニフェスト `.txt`** が必ず付く。守る性質は
  「**編集したセルの外のバイトは 1 つも動かない**」
- 工場データ（SP-DATEN）から **STOCK と 3 つの別 ZB 較正**が参照として使える。
  実車はプログラム・較正とも工場ファイルと **100.00% 一致**
- XDF の欠陥は**オーバーレイ**で修正。`was:` を検証するので、ベンダーが直したらビルドが落ちる
- A モードの変速点は **SHIFT ビュー**（ギア対のヒステリシス帯 + 違反マーカー）

## ワークフロー

```
                        ┌─ 較正窓 24K ──> 24,576 B ──(編集)──> EXPORT / SHARE
CONNECT ──> PROBE ──> READ                                        ▲
   │          │       └─ フル 512K ──> 524,288 B ──(逆アセンブル)─┘
   │          │                │
   │          │                └─(落ちた/STOP)─> 生キャプチャ ──> EXPORT / SHARE のみ
   │          └─ セグメントとベースアドレスを IDENT アンカーで同定
   └─ DS2 0x32 / 9600 8E1 / K+DCAN
```

| スコープ | 長さ | 実測所要 | 検証 | 定義 |
|---|---|---|---|---|
| 較正窓 24K | 24,576 B | 約 2 分（2 パス） | **常時** | `..._24K.xdf` |
| フル 512K | 524,288 B | 約 18 分（1 パス）/ 約 36 分（2 パス） | 任意 | `..._512K.xdf` |
| 生キャプチャ | 途中まで | — | 無し | **無し**（デコードしない） |

所要時間は実測からのスケールです: 実車で 24,576 B / 205 テレグラム / 48.6 秒 = **1.98 ms/byte**。
UI の残り時間表示も同じ考えで、**その読み取りが実際に出している速度**から出します。

読み取り中はハブの右翼が **STOP** になります（切断は隠れる — 読み取りを止めるのに
ケーブルを抜くのは間違いで、18 分もあれば間違ったほうが使われます）。
止めた場合も落ちた場合も、**届いたバイトは生キャプチャとして残ります**。
24,576 でも 524,288 でもない長さにはどちらの定義も当たらないので、TUNE と COVERAGE は
開きませんが、EXPORT と SHARE は効きます。18 分読んで最後のテレグラムで落ちたから
全部捨てる、が一番損だからです。

hub の面は状態から**導出**されます（`src/app/page.tsx` → `hubConfig`）。保存された「今どのボタン」は
無いので、ボタンが嘘をつくことがありません。**WRITE の面はありません。**

---

## 測定で確定した事実

すべて添付の XDF 2本と `C:\EDIABAS\ECU\SMG2.prg`（XOR 0xF7）から実測。
テストが数値を固定しています（`packages/xdf-engine/src/smg2-510.test.ts`）。

### XDF 2本は同一定義

`Siemens_SMG_II_510_24K.xdf` と `..._512K.xdf` の差分は **11 行**、BASEOFFSET と REGION サイズだけ。

| | 24K | 512K |
|---|---|---|
| BASEOFFSET | `offset=204800 (0x32000) subtract=1` | `offset=0 subtract=0` |

項目は **XDFCONSTANT 56 + XDFTABLE 55 = 111**、アドレス範囲 **`0x32080`–`0x37FF0`**。
`Checksum`(16bit) `0x32080` / `IDENT1`(60B) `0x37715` / `IDENT0`(16×3) `0x37FC0`。

### SMG2 の較正はリトルエンディアン

`mmedtypeflags` の分布を、ビッグエンディアンと分かっている MSS54HP CSL 0401 の XDF と比較した:

| XDF | 8bit | 16bit |
|---|---|---|
| **SMG2 510** | `None` ×101 | **`0x02` ×88 / `0x03` ×32** |
| MSS54HP 0401（CPU32・BE） | `None` ×1529 / `0x01` ×78 | `None` ×1832 / `0x01` ×230 |

`0x01` は 8bit にも付く ⇒ **signed**。`0x02` は SMG2 の 16bit にしか付かない
（8bit にエンディアンは無意味）⇒ **`0x02` = LSB-first**。
`0x03` の 32 件は実際にすべて差分・横G系で、符号が要る項目と一致する。

⇒ **SMG2 はリトルエンディアン。CPU32(68k) でも HC12 でもない**（Siemens 製・512 KiB から C16x/ST10 系が最有力）。
これは DME チューナーの `BinaryParser`（BE 固定）が流用できない理由でもある。

### `CATEGORYMEM category` は 1 始まり

`Checksum` は `category="5"` で、カテゴリ宣言は 0:Pressure 1:Clutch 2:System Parameters
3:Gear Logic 4:File Data 5:RPM Limits 6:Speed Limits。
チェックサムは File Data(4) であって RPM Limits(5) ではない。

2つ目の裏付け: 1 始まりで読むと `Clutch` に
`HILLCLIMB / RACESTART / PRERACESTART / KICKDOWN: Clutch Math 1–3` の **12 定数**が入る。
0 始まりだとこの 12 個は System Parameters に行き、Clutch は空になる。

内訳: Pressure 0 / Clutch 12 / System Parameters 32 / Gear Logic 48 / File Data 3 /
RPM Limits 13 / Speed Limits 3。

### カバレッジは 24 KiB 中 22.3%

定義済み **5,477 / 24,576 バイト**。空のカテゴリは **`Pressure` の 1 つだけ**（油圧テーブル未マップ）。
512 B 以上の空白 5 箇所:

| 範囲 | サイズ |
|---|---|
| `0x32082` – `0x33502` | 5.1 KiB |
| `0x345AE` – `0x35A00` | 5.1 KiB |
| `0x335EA` – `0x344AE` | 3.7 KiB |
| `0x37751` – `0x37FC0` | 2.1 KiB |
| `0x3732E` – `0x37715` | 1.0 KiB |

COVERAGE タブがこれをそのまま出します。**隠さないのが仕様**です — 次に逆アセンブラを
向ける先を教えてくれる唯一の画面なので。

### XDF 自体の欠陥 2 件（バリデータが検出）

- `FAULT: Upshift Speed Thresholds` @`0x36EDC`(12B) が
  `SPORT/RACE: Upshift Speed Low Thresholds` @`0x36EE6`(12B) と重なる
- `Rear, Neutral or 1st Gear`(定数 @`0x36F94`) が `RPM Thresholds`(テーブル @`0x36F94`) のセル0と重複

一方で**誤検出しないもの**（どちらも実際に踏んだ）:

- 12 テーブルが x 軸 `0x36D40` / `0x36E00` を共有し、**長さが違う**
  （7列テーブルが8点軸の先頭7点を読む）。開始アドレスが同じなら共有とみなす。
- 10 テーブルが `<LABEL index="0" value="" />` を持つ。これは**意図的な空見出し**であって
  インデックスの欠落ではない。混同すると健全なテーブルに 7 件の警告が出る。

### DS2 テレグラム（SMG2.prg より静的抽出）

```
SPEICHER_LESEN        32 09 06 01 00 00 00 21 1d   ; 06=read  [seg][a2][a1][a0][count]
FLASH_LESEN           32 09 06 00 00 00 00 02 3f
SEED_KEY              32 08 90 42 4d 57 05 f7      ; ASCII "BMW" + accessLevel 5
HERSTELLER_DATEN_LESEN 32 04 53 65
```

チェックサムは直前バイトの XOR で全て検算済み。`buildReadMemoryPayload(segment, address24, count)`
がそのまま当たる。**書込系（`07` + セグメント `02`/`06`/`0F`）も SGBD に実在するが、
このツールは組み立てない。**

### 未解決 3 点（推測で埋めていない）

| 項目 | 状況 | 扱い |
|---|---|---|
| セグメントバイト | SGBD の `SPEICHER` 表は全メモリ種を `0x00` に写すが、`SPEICHER_LESEN` の雛形は `01` | **PROBE で同定**（`CANDIDATE_SEGMENTS`） |
| ベースアドレス | 診断側から見た 512 KiB イメージの位置 | **PROBE で同定**（`CANDIDATE_BASES`） |
| チェックサム算法 | `0x32080` に 16bit あるが算法不明 | **エクスポート名に `NOCHECKSUM`** |

PROBE は `IDENT0`/`IDENT1` を各候補で 48/60 バイトだけ読み、**車両の ZB 番号が出た組**を正解とします。
候補が 2 つ強く一致したら**選ばずに曖昧だと報告**します。

---

## 書き込みが無い理由

同梱の **R270 1.20 は SMG2 に非対応**です。`data1.cab` の平文ファイルテーブルにある接続図は
`MC68HC912*` / `MC9S12*` / `MC9S12X*` / `MPC5xx` のみで、`C167` `ST10` `95xxx` `24Cxx` `93C46`
`Siemens` はいずれも 0 件。**消去に失敗した SMG2 を戻す手段が現時点で存在しません。**

したがって安全な状態は「ボタンを無効にする」ではなく「バイト列を組み立てられない」ことです。

```ts
// packages/ds2-smg2/src/link.ts — module scope。ビルドで落ちる
assertReadOnly()
```

このガードは**実際に発火することを確認済み**です:
`ALLOWED_CONTROLS` に `WRITE_MEMORY` を足すとパッケージ自体がロードに失敗し、テストは
1 件も collect されません。検証していないガードは飾りなので、変更する人は同じ手順で確かめてください。

書込を実装する条件は 3 つ揃ったとき: ベンチ ECU の確保 / チェックサム算法の確定 /
消去単位とセグメント割付の確定（MSS54 の `(nibble<<20)|offset20` は 2 プロセッサ構成に固有で、
単プロセッサの SMG2 に当たる保証がない）。

---

## 構成

```
packages/
  ds2-core/         E46M3-Diagnosis からのベンダーコピー（一次ソースは向こう）
                    verify:ds2-core-sync がハッシュ不一致でビルドを落とす
  ds2-smg2/         SMG II 固有: メモリ配置・読取専用リンク・アドレス空間 PROBE
  ds2-transport/    バイトトランスポート2種と経路判定。Tuner の byteTransport.ts 系を移植
  xdf-engine/       XDF パーサ / バリデータ / コーデック（ECU 非依存、エンディアンは定義から）
functions/          Cloudflare Pages Functions（D1 への追記と読み出しのみ）
migrations/         D1 スキーマ
scripts/            アイコン生成 / SW 生成 / ds2-core 同期検査 / D1 からの取り出し
src/
  app/page.tsx        シェル。hub は hubConfig() で導出
  components/         ui.tsx・Hub.tsx・MMark.tsx は ///M 共通プリミティブ
  hooks/useSmg2Link   ケーブルの状態だけを持つ（ワークスペースの有無は持たない）
  hooks/usePwa        SW 登録・更新通知・インストールプロンプト
  lib/                定義の選択・ワークスペース・PRACTICE デバイス・D1 同期
```

`ds2-core` は**編集しないこと**。直すなら上流（`E46M3-Diagnosis/packages/ds2-core`）を直して
コピーし直す。あのファイル群のコメントは実車で取った測定値と、各ガードが生まれた事故の記録です。

---

## 次の一歩

1. **実車で PROBE → READ**（§実車手順は `docs/vehicle-session.md`）
2. **チェックサム算法の同定** — 実イメージが 1 本取れれば総当たりで解ける
3. **ライブ値ブロックの導出** — `SMG2.prg` に `BETRIEBSWTAB` が無いので、
   BEST/2 バイトコードの逆アセンブル（`C:\EC-APPS\ediabaslib\Tools\BESTDIS`）が経路。
   正解データは `E46M3-Diagnosis/recordings/m3-smg2-real.json`（実車 140 チャネル）
4. **ファームウェア逆アセンブル** — MCU 同定が先（リトルエンディアン ⇒ C16x/ST10 系が最有力）。
   CSL_0401 の Ghidra パイプラインは CPU32 専用でそのままは使えない

---

## クレジット

XDF 定義は **MS4X Dev Team**（Olza 提供）。ファイル内の `<description>` を参照。
`ds2-core` の DS2 実装は BMW DS2 の公開情報と実車測定に基づく。
