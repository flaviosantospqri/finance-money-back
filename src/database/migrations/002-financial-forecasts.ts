export const financialForecastsSchema = `
CREATE TABLE financial_forecast_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('income', 'expense')),
  description VARCHAR(160) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  start_date DATE NOT NULL,
  category_id UUID NOT NULL REFERENCES financial_categories(id),
  account_id UUID REFERENCES financial_accounts(id),
  recurrence VARCHAR(10) NOT NULL CHECK (recurrence IN ('once', 'monthly', 'weekly', 'yearly')),
  occurrence_count SMALLINT NOT NULL CHECK (occurrence_count BETWEEN 1 AND 120),
  notes VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE financial_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES financial_forecast_series(id),
  occurrence_index SMALLINT NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('income', 'expense')),
  description VARCHAR(160) NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  category_id UUID NOT NULL REFERENCES financial_categories(id),
  account_id UUID REFERENCES financial_accounts(id),
  destination_id UUID,
  notes VARCHAR(1000),
  cancelled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closure_reason VARCHAR(500),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(series_id, occurrence_index)
);
CREATE INDEX financial_forecasts_due_date_idx ON financial_forecasts(due_date) WHERE deleted_at IS NULL;
CREATE INDEX financial_forecasts_series_idx ON financial_forecasts(series_id, occurrence_index) WHERE deleted_at IS NULL;
CREATE TABLE forecast_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE financial_forecasts ADD CONSTRAINT financial_forecasts_destination_fk FOREIGN KEY(destination_id) REFERENCES forecast_destinations(id);
CREATE TABLE forecast_distributions (
  period CHAR(7) NOT NULL CHECK (period ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
  destination_id UUID NOT NULL REFERENCES forecast_destinations(id),
  percentage NUMERIC(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  PRIMARY KEY(period, destination_id)
);
CREATE TABLE forecast_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID NOT NULL REFERENCES financial_forecasts(id),
  cash_book_entry_id UUID NOT NULL REFERENCES cash_book_entries(id),
  amount NUMERIC(14,2) CHECK (amount IS NULL OR amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX forecast_reconciliations_active_entry_idx ON forecast_reconciliations(cash_book_entry_id) WHERE deleted_at IS NULL;
CREATE INDEX forecast_reconciliations_forecast_idx ON forecast_reconciliations(forecast_id) WHERE deleted_at IS NULL;
INSERT INTO forecast_destinations(name) VALUES ('Casa/Lazer'), ('Investimentos'), ('Flávio'), ('Laura'), ('Outras') ON CONFLICT(name) DO NOTHING;
`;
