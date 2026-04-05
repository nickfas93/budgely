-- NIC-84: Deduplicação de transações
-- UP

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_fingerprint
  ON transactions(user_id, fingerprint)
  WHERE fingerprint IS NOT NULL;

ALTER TABLE pdf_imports
  ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_pdf_imports_file_hash
  ON pdf_imports(user_id, file_hash)
  WHERE file_hash IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS idx_transactions_fingerprint;
-- ALTER TABLE transactions DROP COLUMN IF EXISTS fingerprint;
-- DROP INDEX IF EXISTS idx_pdf_imports_file_hash;
-- ALTER TABLE pdf_imports DROP COLUMN IF EXISTS file_hash;
