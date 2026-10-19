export const forecastRetentionSchema = `
ALTER TABLE financial_forecasts
  ADD COLUMN retained_at TIMESTAMPTZ,
  ADD COLUMN retained_amount NUMERIC(14,2);
`;
