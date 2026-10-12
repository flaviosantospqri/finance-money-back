export const financialRepassesSchema = `
ALTER TABLE forecast_distributions
  ADD COLUMN value_type VARCHAR(12) NOT NULL DEFAULT 'percentage' CHECK (value_type IN ('percentage','fixed')),
  ADD COLUMN value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (value >= 0);
UPDATE forecast_distributions SET value=percentage;

CREATE TABLE financial_repasses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES forecast_destinations(id),
  value_type VARCHAR(12) NOT NULL CHECK (value_type IN ('percentage','fixed')),
  value NUMERIC(14,2) NOT NULL CHECK (value >= 0),
  effective_from CHAR(7) NOT NULL CHECK (effective_from ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
  effective_to CHAR(7) CHECK (effective_to IS NULL OR effective_to ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX financial_repasses_period_idx ON financial_repasses(destination_id,effective_from,effective_to) WHERE deleted_at IS NULL;

INSERT INTO financial_repasses(destination_id,value_type,value,effective_from)
SELECT id,'percentage',CASE name WHEN 'Casa/Lazer' THEN 70 WHEN 'Investimentos' THEN 10 WHEN 'Flávio' THEN 10 WHEN 'Laura' THEN 10 ELSE 0 END,to_char(CURRENT_DATE,'YYYY-MM')
FROM forecast_destinations WHERE name IN ('Casa/Lazer','Investimentos','Flávio','Laura','Outras')
AND NOT EXISTS (SELECT 1 FROM financial_repasses);
`;
