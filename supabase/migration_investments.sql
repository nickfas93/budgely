-- UP: investment_assets table
CREATE TABLE IF NOT EXISTS investment_assets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES budgely_users(id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL,
  name       TEXT,
  quantity   NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  avg_price  NUMERIC(14,6) NOT NULL CHECK (avg_price > 0),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('acao','fii','etf','bdr','crypto')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ticker)
);

ALTER TABLE investment_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_investments" ON investment_assets
  FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_investment_assets_user
  ON investment_assets(user_id) WHERE active = true;

-- DOWN
-- DROP TABLE investment_assets;
