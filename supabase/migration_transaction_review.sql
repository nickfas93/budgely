-- UP: transaction review flow (NIC-pending)
-- Adds status (pending/confirmed) and soft-delete support to transactions

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- All pre-existing rows are already confirmed
UPDATE transactions SET status = 'confirmed' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_active
  ON transactions(user_id, status, date DESC)
  WHERE deleted_at IS NULL;

-- DOWN
-- DROP INDEX IF EXISTS idx_transactions_active;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS status;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS deleted_at;
