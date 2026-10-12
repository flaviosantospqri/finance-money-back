export const initialCashBookSchema = `
CREATE TABLE financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('checking', 'payment', 'cash', 'investment')),
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  reference_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  nature VARCHAR(10) NOT NULL CHECK (nature IN ('income', 'expense')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, nature)
);

CREATE TABLE cash_book_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at DATE NOT NULL,
  description VARCHAR(160) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  source_account_id UUID NOT NULL REFERENCES financial_accounts(id),
  destination_account_id UUID NOT NULL REFERENCES financial_accounts(id),
  notes VARCHAR(1000),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (source_account_id <> destination_account_id)
);

CREATE TABLE cash_book_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES financial_accounts(id),
  category_id UUID REFERENCES financial_categories(id),
  transfer_id UUID REFERENCES cash_book_transfers(id),
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('income', 'expense', 'transfer_debit', 'transfer_credit')),
  occurred_at DATE NOT NULL,
  description VARCHAR(160) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  notes VARCHAR(1000),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (
    (entry_type IN ('income', 'expense') AND category_id IS NOT NULL AND transfer_id IS NULL)
    OR (entry_type IN ('transfer_debit', 'transfer_credit') AND category_id IS NULL AND transfer_id IS NOT NULL)
  )
);

CREATE INDEX cash_book_entries_account_date_idx ON cash_book_entries (account_id, occurred_at, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX cash_book_entries_category_idx ON cash_book_entries (category_id) WHERE deleted_at IS NULL;
CREATE INDEX cash_book_entries_transfer_idx ON cash_book_entries (transfer_id) WHERE deleted_at IS NULL;

INSERT INTO financial_accounts (name, type, opening_balance, reference_date) VALUES
  ('Itaú PJ Principal', 'checking', 0, DATE '2024-01-01'),
  ('Bradesco PJ', 'checking', 0, DATE '2024-01-01'),
  ('Cartão de Crédito Nubank', 'payment', 0, DATE '2024-01-01')
ON CONFLICT (name) DO NOTHING;

INSERT INTO financial_categories (name, nature) VALUES
  ('Vendas & Serviços', 'income'),
  ('Serviços Prestados', 'income'),
  ('Licenciamento', 'income'),
  ('Tecnologia & Ferramentas', 'expense'),
  ('Instalações & Infra', 'expense'),
  ('Marketing & Vendas', 'expense'),
  ('Viagens & Logística', 'expense'),
  ('Serviços Terceirizados', 'expense'),
  ('Impostos & Taxas', 'expense'),
  ('Alimentação & Mercado', 'expense'),
  ('Moradia & Contas', 'expense'),
  ('Transporte & Mobilidade', 'expense'),
  ('Saúde & Bem-estar', 'expense'),
  ('Educação', 'expense'),
  ('Lazer & Entretenimento', 'expense'),
  ('Compras Pessoais', 'expense'),
  ('Cuidados Pessoais', 'expense'),
  ('Pets', 'expense'),
  ('Assinaturas & Serviços', 'expense'),
  ('Viagens Pessoais', 'expense'),
  ('Outros', 'income'),
  ('Outros', 'expense')
ON CONFLICT (name, nature) DO NOTHING;
`;
