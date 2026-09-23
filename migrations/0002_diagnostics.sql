-- One row per operation, uploaded WHETHER OR NOT IT SUCCEEDED.
--
-- This is the half the extraction table cannot cover. `extractions` requires an image, so a read
-- that died at telegram 140 of 205 — the run whose record is worth the most — had no way to leave
-- the phone at all. The Tuner learned the same thing about its write path and publishes diagnostics
-- on both branches for exactly this reason.
--
-- The trace is the bytes that actually crossed the wire, gzip+base64 like the images and for the
-- same reason: it round-trips through `wrangler d1 execute --json` unchanged.

CREATE TABLE IF NOT EXISTS diagnostics (
    id              TEXT PRIMARY KEY,
    created_at      INTEGER NOT NULL,
    synced_at       INTEGER NOT NULL,

    -- What was being attempted, and whether it worked. `ok = 0` rows are the point of this table.
    kind            TEXT NOT NULL,      -- 'connect' | 'probe' | 'read' | 'manual'
    ok              INTEGER NOT NULL,
    error           TEXT,

    -- Where it ran. A fault that only happens on one route is the common case.
    route           TEXT,               -- 'web-serial' | 'web-usb-ftdi' | 'practice'
    practice        INTEGER NOT NULL DEFAULT 0,
    app_build       TEXT,
    user_agent      TEXT,

    -- What it was talking to, when that is known.
    zb_number       TEXT,
    segment         INTEGER,
    base_address    INTEGER,
    -- Set when this diagnostic belongs to an extraction that also reached the other table.
    extraction_sha  TEXT,

    -- How far it got. Non-null even on failure: "died after 140 exchanges" is the finding.
    chunk_size      INTEGER,
    exchanges       INTEGER,
    retries         INTEGER,
    bytes_done      INTEGER,
    elapsed_ms      INTEGER,

    log_text        TEXT,               -- the human-readable session log
    trace_gz_b64    TEXT,               -- gzip(telegram trace text) -> base64
    trace_dropped   INTEGER,            -- entries omitted by head/tail retention; 0 = complete
    tx_bytes        INTEGER,
    rx_bytes        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostics (created_at DESC);
-- Failures first: that is what this table is read for.
CREATE INDEX IF NOT EXISTS idx_diagnostics_failed ON diagnostics (ok, created_at DESC);
