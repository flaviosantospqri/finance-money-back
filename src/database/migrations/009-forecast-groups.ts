export const forecastGroupsSchema = `
CREATE TABLE forecast_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE financial_forecasts
  ADD COLUMN group_id UUID REFERENCES forecast_groups(id) ON DELETE SET NULL;
CREATE INDEX financial_forecasts_group_idx ON financial_forecasts(group_id) WHERE deleted_at IS NULL;
`;
