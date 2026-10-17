export const forecastIncomePercentageSchema = `
ALTER TABLE financial_forecasts
  ADD COLUMN amount_type VARCHAR(24) NOT NULL DEFAULT 'fixed'
    CHECK (amount_type IN ('fixed', 'income_percentage')),
  ADD COLUMN percentage NUMERIC(5,2)
    CHECK (percentage IS NULL OR (percentage > 0 AND percentage <= 100));
ALTER TABLE financial_forecast_series
  ADD COLUMN amount_type VARCHAR(24) NOT NULL DEFAULT 'fixed'
    CHECK (amount_type IN ('fixed', 'income_percentage')),
  ADD COLUMN percentage NUMERIC(5,2)
    CHECK (percentage IS NULL OR (percentage > 0 AND percentage <= 100));
`;
