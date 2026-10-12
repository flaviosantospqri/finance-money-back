export const investmentsSchema = `
ALTER TABLE financial_accounts ADD COLUMN institution VARCHAR(120);

CREATE TABLE investment_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  account_id UUID NOT NULL REFERENCES financial_accounts(id),
  investment_type VARCHAR(80) NOT NULL,
  institution VARCHAR(120),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference_date DATE NOT NULL,
  notes VARCHAR(1000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX investment_applications_account_idx ON investment_applications(account_id) WHERE deleted_at IS NULL;

ALTER TABLE cash_book_transfers
  ADD COLUMN source_application_id UUID REFERENCES investment_applications(id),
  ADD COLUMN destination_application_id UUID REFERENCES investment_applications(id);

CREATE TABLE investment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES investment_applications(id),
  transfer_id UUID REFERENCES cash_book_transfers(id),
  occurred_at DATE NOT NULL,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('contribution','withdrawal','income','adjustment')),
  amount NUMERIC(14,2) NOT NULL,
  origin VARCHAR(120),
  notes VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK ((transaction_type='adjustment' AND amount <> 0) OR (transaction_type <> 'adjustment' AND amount > 0)),
  CHECK ((transfer_id IS NULL AND transaction_type IN ('income','adjustment')) OR (transfer_id IS NOT NULL AND transaction_type IN ('contribution','withdrawal')))
);
CREATE INDEX investment_transactions_application_date_idx ON investment_transactions(application_id,occurred_at,created_at,id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX investment_transactions_transfer_active_idx ON investment_transactions(transfer_id,transaction_type) WHERE transfer_id IS NOT NULL AND deleted_at IS NULL;
`;
