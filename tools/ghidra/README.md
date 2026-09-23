# Ghidra, seeded from this repo's own sweep

Ghidra with the C166 module (`keyhana/c166-ghidra-module`, MIT) disassembles the SMG2 image
correctly, but left alone it finds **64 functions and 3,373 instructions**: it has no way to know
segment 0's vector table forwards to a second one at 0x10000, that `0x2DC28` holds 46 code
pointers, or that the program is reached through those tables. That knowledge is in
`@tsunagi/c166`. So the division of labour is:

- **this repo says WHERE the code is** — `tools/emit-ghidra-seeds.mjs` writes every entry point the
  recursive sweep found (942 on `5c5a0c857acd`), with why each is one;
- **Ghidra says WHAT it means** — the decompiler, which the in-browser TS decoder will never produce.

Cross-checked before either was trusted. Seeded with an earlier 896-entry file, Ghidra reached 894
functions / 51,894 instructions; seeded with the current 942, it reached 938 / 55,088, against the
sweep's own 942 / 56,135. Ghidra's count stays a little lower because it drops seeds it will not
disassemble (11 of 942 on the last run) — the gap is reported by `SeedFromSweep.java`, not hidden.
Four encodings this project had established by hand (`FA 00 4E 04` = JMPS 00:044E,
`F3 F8 B2 FE` = MOVB RL4,S0RBUF, `MOV CP,#F600h`, `MOV S0BG,#0033h`) decode identically in both.

## One-time setup (WSL)

```bash
export GHIDRA_INSTALL_DIR=~/ghidra-dist/ghidra_12.1.3_PUBLIC   # Ghidra 12.1.3
export JAVA_HOME=~/jdk-21                                       # JDK 21
git clone https://github.com/keyhana/c166-ghidra-module        # MIT
cd c166-ghidra-module && ./gradlew --no-daemon buildExtension
unzip dist/*.zip -d "$GHIDRA_INSTALL_DIR/Ghidra/Extensions"
```

Verify the module before trusting it: `analyzeHeadless … -postScript VerifyC166.java` prints the
four hand-established encodings it can check without seeding (`0x00AD3A` needs the seeds first,
because the ASC0 handler is only reached through the vector table). If any disagrees, the module
does not get used.

## Each run

```bash
# 1. entry points, from this repo (needs Node 22+)
node --experimental-strip-types --import ./tools/register-ts.mjs \
     tools/emit-ghidra-seeds.mjs data/extractions/<image>.bin > build/seeds.json

# 2. import, seed, decompile the functions you name
"$GHIDRA_INSTALL_DIR/support/analyzeHeadless" <proj-dir> SMG2 \
  -import <image>.bin -processor "C166:LE:16:default" \
  -loader BinaryLoader -loader-baseAddr 0x0 \
  -scriptPath tools/ghidra \
  -postScript SeedFromSweep.java build/seeds.json \
  -postScript DecompileAt.java AD30 2212 FFE 14B4 97E
```

`DecompileAt.java` writes `<addr>.c` per function. The chain that answered erase granularity was
`AD30` (DS2 receiver) → `1C2A` (seed/key) → `2212` (service 0x07) → `137E` (address validator) →
`FFE` (region dispatch) → `14B4` (sector-erase loop) → `AF8`/`97E` (RAM-resident engine). See
`docs/smg2-flash-driver.md`.
