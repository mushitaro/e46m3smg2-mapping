# Third-party notices and data provenance

This file records what this project depends on, what it is derived from, and which of those
things are in this repository, which are only on the maintainer's disk, and which reach a user.

**This is a record of facts, not legal advice.** The provenance questions in §2 are judgement
calls, made deliberately and written down so they are not inherited by accident.

The code in this repository is MIT (`LICENSE`, Copyright (c) 2026 TSUNAGI). That licence covers
what is committed here and nothing in §2.

---

## 1. Runtime dependencies (shipped in the built app)

Ordinary npm packages, all permissively licensed. See `package.json` and `package-lock.json` for
exact versions.

| Package | License |
|---|---|
| next, react, react-dom | MIT |
| tailwindcss, @tailwindcss/postcss | MIT |
| plotly.js, react-plotly.js | MIT |
| lucide-react | ISC |
| clsx, tailwind-merge | MIT |
| Inter, JetBrains Mono (self-hosted by `next/font` at build time) | SIL Open Font License 1.1 |

Build and test only: typescript (Apache-2.0), vitest (MIT), wrangler and
@cloudflare/workers-types (MIT OR Apache-2.0).

The app makes **no network calls to any third party**. It talks to the ECU over Web Serial or
WebUSB. The preview build also talks to its own origin (the owner gate and the SYNC API) — see
README.md §Preview.

---

## 2. What is NOT in this repository, and why

This tool reads and edits a BMW transmission ECU. Four kinds of input make it useful, and none of
them is ours to publish. `.gitignore` excludes each one, and `scripts/check-public-tree.mjs`
(pre-commit, and again before every deploy) fails if any of them is ever tracked.

### 2.1 BMW SP-DATEN — `E46_v74/`, `public/factory/*.0DA`

BMW's own programming data for the SMG II: the program file `7843260K.0PA` and the four data
files `7843256DA`–`7843259DA` (`.0DA`), with the `GDSMG2.DAT` table that pairs them with ZB
numbers. They are proprietary and are **not redistributed here**.

The app uses the four `.0DA` files as the STOCK reference calibrations: the build copies whatever
is in `public/factory/` into the output. The maintainer's preview build carries them and serves
them only behind the owner gate; a build from a fresh clone has none, and the app says "no
factory reference" instead of failing.

What IS committed and derived from them: facts read out of them — which ZB pairs with which data
file (`src/lib/factory/catalogue.ts`), the checksums they declare, and the addresses the
analysis documents quote. Those are facts about a BMW part, stated so the tool can check its own
reading against BMW's; the files themselves are not here.

### 2.2 TunerPro XDF definitions — MS4X Dev Team

`Siemens_SMG_II_510_24K.xdf` and `Siemens_SMG_II_510_512K.xdf`: the community definitions of
the SMG II 510 calibration, authored by the **MS4X Dev Team** and supplied by Olza (see the
`<description>` inside each file). They are **not redistributed here** — `public/xdf/` and
`packages/xdf-engine/fixtures/*.xdf` are gitignored.

The app reads them at runtime (without them it can read and export an image but cannot decode
it), and the tests assert on their exact contents; those tests skip when the files are absent.
The maintainer's preview build carries them, behind the owner gate.

What IS committed and derived from them: `src/lib/smg2-catalog/` — this project's corrections to
the definition. Each entry names an item by its `uniqueId`, states the vendor's value it expects
(`was:`) and the corrected one, and quotes the few words of the vendor's description a bit
legend is transcribed from. The corrections are this project's measurement; the definition they
correct is MS4X's.

### 2.3 A real car's ECU — `data/`, `build/`

`data/extractions/` and `data/diagnostics/` hold images read from a car and the logs of reading
them; `build/seeds.json` is analysis output generated from one of those images. They identify a
specific vehicle's calibration and are **never committed**. Tests that need the real dump skip
without it.

### 2.4 BMW EDIABAS SGBD — `SMG2.prg`

`docs/smg2-write-protocol.md` transcribes telegram constants from BMW's SGBD `SMG2.prg`,
disassembled with BESTDIS on the maintainer's machine. The `.prg` file is not here and is not
needed to build or run anything. The transcribed byte sequences are the protocol facts the ECU
answers to.

---

## 3. What this project wrote

Everything else: the DS2 link and transports, the XDF engine, the C16x decoder, the checksum
identification, the write-telegram builder (which the app does not send — `canWriteToEcu` is
false), the app, and the analysis documents in `docs/`. MIT.

`packages/ds2-core` is a vendored copy of the same package in
[E46M3-Monitoring](https://github.com/mushitaro/E46M3-Monitoring) (MIT, the same author);
`scripts/verify-ds2-core-sync.mjs` keeps the two identical.
