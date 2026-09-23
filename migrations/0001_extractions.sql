-- One row per extraction handed up from a phone or a laptop.
--
-- Two rules shaped this table.
--
-- The image is stored gzipped and BASE64-encoded rather than as a BLOB, because the way it is read
-- back matters: `wrangler d1 execute --json` renders a BLOB as an array of integers, which is both
-- huge and awkward, while base64 text round-trips through the CLI unchanged. A 24 KiB calibration
-- gzips to a few KiB, so the 33% base64 overhead costs almost nothing.
--
-- Everything worth filtering or scanning on is DENORMALISED out of the image, so a listing never
-- has to decompress anything. `checksum_stored` is the sharpest example: identifying the SMG2's
-- checksum algorithm needs the stored 16-bit value from many images, and having it as a column
-- makes that one query instead of a download-and-decode loop.

CREATE TABLE IF NOT EXISTS extractions (
    id                TEXT PRIMARY KEY,
    created_at        INTEGER NOT NULL,   -- ms since epoch, stamped in the browser at read time
    synced_at         INTEGER NOT NULL,   -- ms since epoch, stamped by the Worker on arrival
    label             TEXT,               -- whatever the operator typed; may be null

    -- Provenance. `practice` is not a nicety: a simulated read produces plausible bytes, and a row
    -- that does not say so is indistinguishable from a real dump six months later.
    transport         TEXT NOT NULL,      -- 'serial' | 'usb' | 'practice' | 'file'
    practice          INTEGER NOT NULL DEFAULT 0,
    app_build         TEXT,
    user_agent        TEXT,

    -- What was read.
    variant           TEXT NOT NULL,      -- 'partial-24k' | 'full-512k'
    byte_length       INTEGER NOT NULL,
    sha256            TEXT NOT NULL,
    segment           INTEGER,            -- the probed DS2 segment byte
    base_address      INTEGER,            -- the probed image base in the ECU's address space

    -- Vehicle identity, so images can be grouped per car without decompressing them.
    zb_number         TEXT,
    manufacturer_data TEXT,               -- raw 0x53 response, hex

    -- The stored 16-bit checksum at XDF 0x32080. The input to identifying the algorithm.
    checksum_stored   INTEGER,

    -- How the read went. A failed or slow run is as informative as a clean one.
    chunk_size        INTEGER,
    exchanges         INTEGER,
    retries           INTEGER,
    elapsed_ms        INTEGER,
    verified_reread   INTEGER,            -- 1 = two passes agreed, 0 = disagreed, null = not checked

    image_gz_b64      TEXT NOT NULL,      -- gzip(image) -> base64
    edits_json        TEXT,               -- cells changed since the read, if any
    log_text          TEXT                -- the link log, for diagnosing a run that went wrong
);

CREATE INDEX IF NOT EXISTS idx_extractions_created ON extractions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extractions_zb ON extractions (zb_number);
-- Real dumps are almost always what you want; this keeps practice rows out of the way cheaply.
CREATE INDEX IF NOT EXISTS idx_extractions_practice ON extractions (practice, created_at DESC);
