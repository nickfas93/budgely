CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Usuários do Budgely (vinculados ao auth.users do Supabase)
CREATE TABLE budgely_users (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  monthly_salary    NUMERIC(12,2) DEFAULT 0,
  whatsapp_phone    TEXT UNIQUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Categorias de gasto (seed incluso abaixo)
CREATE TABLE categories (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  icon  TEXT
);

INSERT INTO categories (slug, label, color, icon) VALUES
  ('alimentacao', 'Alimentação',  '#22c55e', '🛒'),
  ('refeicao',    'Refeição',     '#16a34a', '🍽️'),
  ('moradia',     'Moradia',      '#3b82f6', '🏠'),
  ('saude',       'Saúde',        '#ef4444', '❤️'),
  ('lazer',       'Lazer',        '#f59e0b', '🎉'),
  ('vestuario',   'Vestuário',    '#8b5cf6', '👕'),
  ('transporte',  'Transporte',   '#06b6d4', '🚗'),
  ('educacao',    'Educação',     '#f97316', '📚'),
  ('pets',        'Pets',         '#84cc16', '🐾'),
  ('servicos',    'Serviços',     '#64748b', '🔧'),
  ('outros',      'Outros',       '#94a3b8', '📦');

-- Transações financeiras
CREATE TABLE transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES budgely_users(id),
  date                DATE NOT NULL,
  amount              NUMERIC(12,2) NOT NULL,
  description         TEXT NOT NULL,
  merchant            TEXT,
  category_id         UUID REFERENCES categories(id),
  raw_category        TEXT,
  source              TEXT NOT NULL,  -- pdf_credit | pdf_debit | pdf_alelo | manual | whatsapp
  bank                TEXT,           -- itau | btg | inter | alelo
  card_last4          TEXT,
  alelo_wallet_type   TEXT,           -- refeicao | alimentacao (apenas Alelo)
  import_id           UUID,
  is_installment      BOOLEAN DEFAULT FALSE,
  installment_current INT,
  installment_total   INT,
  notes               TEXT,
  fingerprint         TEXT,       -- SHA-256 (user_id|date|amount|normalized_merchant) for dedup
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Registro de importações de PDF
CREATE TABLE pdf_imports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES budgely_users(id),
  bank                TEXT NOT NULL,  -- itau_credit | itau_debit | btg_credit | alelo
  filename            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  total_transactions  INT,
  imported_count      INT DEFAULT 0,
  error_message       TEXT,
  reference_month     DATE,
  file_hash           TEXT,       -- SHA-256 of the uploaded PDF buffer for re-import detection
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Custos fixos mensais por usuário
CREATE TABLE fixed_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES budgely_users(id),
  name         TEXT NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  category_id  UUID REFERENCES categories(id),
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Budget Alelo mensal (calculado dos créditos do extrato)
CREATE TABLE alelo_budgets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES budgely_users(id),
  month              DATE NOT NULL,
  refeicao_budget    NUMERIC(12,2) DEFAULT 0,
  alimentacao_budget NUMERIC(12,2) DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- Análises geradas pela LLM (budget breach, resumo mensal)
CREATE TABLE llm_analyses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month        DATE NOT NULL,
  type         TEXT NOT NULL,  -- budget_breach | monthly_summary
  content      TEXT NOT NULL,
  total_spent  NUMERIC(12,2),
  total_budget NUMERIC(12,2),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Sessões WhatsApp para entrada de despesas
CREATE TABLE wa_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES budgely_users(id),
  phone      TEXT NOT NULL UNIQUE,
  state      TEXT NOT NULL DEFAULT 'idle',
  temp_data  JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deduplicação de webhook (padrão Whatsario)
CREATE TABLE processed_webhook_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE budgely_users  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_imports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_costs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alelo_budgets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_analyses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_sessions     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_user"         ON budgely_users FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_transactions" ON transactions   FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own_pdf_imports"  ON pdf_imports    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own_fixed_costs"  ON fixed_costs    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own_alelo"        ON alelo_budgets  FOR ALL USING (user_id = auth.uid());
CREATE POLICY "llm_open"         ON llm_analyses   FOR ALL USING (true);
CREATE POLICY "own_wa_sessions"  ON wa_sessions    FOR ALL USING (user_id = auth.uid());

-- Índices
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX idx_transactions_category  ON transactions(category_id);
CREATE INDEX idx_transactions_source    ON transactions(source);
CREATE INDEX idx_transactions_month     ON transactions(user_id, date_trunc('month', date));

-- Orçamentos mensais por categoria (copy-forward: herda do mês anterior se não definido)
CREATE TABLE budgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES budgely_users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id),
  month       DATE NOT NULL,  -- sempre o 1º dia do mês (ex: 2024-06-01)
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_id, month)
);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_budgets" ON budgets FOR ALL USING (user_id = auth.uid());
CREATE INDEX idx_budgets_user_month ON budgets(user_id, month DESC);

-- Metas de poupança
CREATE TABLE savings_goals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES budgely_users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  target_amount  NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deadline       DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_goals" ON savings_goals FOR ALL USING (user_id = auth.uid());
CREATE INDEX idx_pdf_imports_user           ON pdf_imports(user_id);
CREATE UNIQUE INDEX idx_transactions_fingerprint ON transactions(user_id, fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX idx_pdf_imports_file_hash          ON pdf_imports(user_id, file_hash)   WHERE file_hash  IS NOT NULL;

-- Ativos de investimento (renda variável)
CREATE TABLE investment_assets (
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
CREATE POLICY "own_investments" ON investment_assets FOR ALL USING (user_id = auth.uid());
CREATE INDEX idx_investment_assets_user ON investment_assets(user_id) WHERE active = true;
