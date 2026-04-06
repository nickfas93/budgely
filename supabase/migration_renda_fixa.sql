-- UP: renda fixa support in investment_assets

-- 1. Expand asset_type constraint to include renda_fixa
ALTER TABLE investment_assets DROP CONSTRAINT IF EXISTS investment_assets_asset_type_check;
ALTER TABLE investment_assets
  ADD CONSTRAINT investment_assets_asset_type_check
  CHECK (asset_type IN ('acao','fii','etf','bdr','crypto','renda_fixa'));

-- 2. Renda fixa specific columns (nullable — only used when asset_type = 'renda_fixa')
ALTER TABLE investment_assets
  ADD COLUMN IF NOT EXISTS rf_index       TEXT    CHECK (rf_index IN ('cdi','ipca','selic','prefixado')),
  ADD COLUMN IF NOT EXISTS rf_rate        NUMERIC(8,4),   -- % over index (CDI/IPCA/Selic) or fixed rate (prefixado)
  ADD COLUMN IF NOT EXISTS rf_maturity    DATE,           -- data de vencimento
  ADD COLUMN IF NOT EXISTS rf_invested    NUMERIC(14,2);  -- valor aportado (R$)

-- DOWN
-- ALTER TABLE investment_assets DROP CONSTRAINT IF EXISTS investment_assets_asset_type_check;
-- ALTER TABLE investment_assets ADD CONSTRAINT investment_assets_asset_type_check
--   CHECK (asset_type IN ('acao','fii','etf','bdr','crypto'));
-- ALTER TABLE investment_assets
--   DROP COLUMN IF EXISTS rf_index,
--   DROP COLUMN IF EXISTS rf_rate,
--   DROP COLUMN IF EXISTS rf_maturity,
--   DROP COLUMN IF EXISTS rf_invested;
