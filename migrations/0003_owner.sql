-- Every row gets an owner: the m3 account the gate resolved for the request that wrote it.
--
-- Until now one shared token, embedded in the public page, opened every row to anyone who opened
-- the page. The preview is for owners, and each owner sees their own rows and nobody else's, so
-- ownership has to be a column that every statement filters on — not a convention.
--
-- Rows written before this migration were written by the operator testing the tool, so they are
-- the operator's (account ac5c6c31-…).
--
-- Apply with `npx wrangler d1 migrations apply smg2-tuner-runs` (add --local for the local copy).
-- Take `wrangler d1 export smg2-tuner-runs --remote` first and note the time-travel bookmark; the
-- row counts before and after must match.

-- ── extractions: rebuilt, because its key has to change ────────────────────────────────────────
--
-- The id used to BE the image's SHA-256, with `ON CONFLICT(id) DO NOTHING`. With more than one
-- owner that is wrong in a way nobody would see: a second owner whose calibration is identical to
-- the first one's (every stock car) got 201 back while their row — their ZB number, their log,
-- their edits — was silently dropped. So the id becomes an opaque key issued per session, and
-- "the same calibration" becomes UNIQUE(owner, sha256): one row per owner per image, and the same
-- image from two owners is two rows.
--
-- SQLite cannot change a primary key in place, so: new table, copy, drop, rename — in one file, so
-- the migration either happens entirely or not at all. Existing ids are kept as they are (they are
-- still unique), and the SHA-256 they encoded is copied into the sha256 column they always equalled.

CREATE TABLE extractions_new (
    id                TEXT PRIMARY KEY,
    owner             TEXT NOT NULL,      -- m3 account id, from the gate; never from the client
    created_at        INTEGER NOT NULL,
    synced_at         INTEGER NOT NULL,
    label             TEXT,
    transport         TEXT NOT NULL,
    practice          INTEGER NOT NULL DEFAULT 0,
    app_build         TEXT,
    user_agent        TEXT,
    variant           TEXT NOT NULL,
    byte_length       INTEGER NOT NULL,
    sha256            TEXT NOT NULL,
    segment           INTEGER,
    base_address      INTEGER,
    zb_number         TEXT,
    manufacturer_data TEXT,
    checksum_stored   INTEGER,
    chunk_size        INTEGER,
    exchanges         INTEGER,
    retries           INTEGER,
    elapsed_ms        INTEGER,
    verified_reread   INTEGER,
    image_gz_b64      TEXT NOT NULL,
    edits_json        TEXT,
    log_text          TEXT,
    UNIQUE (owner, sha256)
);

INSERT INTO extractions_new (
    id, owner, sha256, created_at, synced_at, label, transport, practice, app_build, user_agent,
    variant, byte_length, segment, base_address, zb_number, manufacturer_data, checksum_stored,
    chunk_size, exchanges, retries, elapsed_ms, verified_reread, image_gz_b64, edits_json, log_text
)
SELECT
    id, 'ac5c6c31-5137-4fd7-9b5d-ceb17f98027c', id AS sha256, created_at, synced_at, label, transport,
    practice, app_build, user_agent, variant, byte_length, segment, base_address, zb_number,
    manufacturer_data, checksum_stored, chunk_size, exchanges, retries, elapsed_ms, verified_reread,
    image_gz_b64, edits_json, log_text
FROM extractions;

DROP TABLE extractions;
ALTER TABLE extractions_new RENAME TO extractions;

CREATE INDEX IF NOT EXISTS idx_extractions_owner_created ON extractions (owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extractions_created ON extractions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extractions_zb ON extractions (zb_number);
CREATE INDEX IF NOT EXISTS idx_extractions_practice ON extractions (practice, created_at DESC);

-- ── diagnostics: an owner column, the existing key kept ────────────────────────────────────────
--
-- The id here was always random per record, so only the owner is missing. The column is nullable
-- because ALTER TABLE cannot add a NOT NULL column without a default, and a default owner is
-- exactly the thing that must not exist — so a trigger refuses a new row without one instead.

ALTER TABLE diagnostics ADD COLUMN owner TEXT;
UPDATE diagnostics SET owner = 'ac5c6c31-5137-4fd7-9b5d-ceb17f98027c' WHERE owner IS NULL;

CREATE TRIGGER IF NOT EXISTS diagnostics_owner_required
BEFORE INSERT ON diagnostics
FOR EACH ROW WHEN NEW.owner IS NULL
BEGIN
    SELECT RAISE(ABORT, 'diagnostics.owner is required');
END;

CREATE TRIGGER IF NOT EXISTS diagnostics_owner_kept
BEFORE UPDATE OF owner ON diagnostics
FOR EACH ROW WHEN NEW.owner IS NULL
BEGIN
    SELECT RAISE(ABORT, 'diagnostics.owner is required');
END;

CREATE INDEX IF NOT EXISTS idx_diagnostics_owner_created ON diagnostics (owner, created_at DESC);
