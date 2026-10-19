export const forecastIncomePercentageZeroSchema = `
ALTER TABLE financial_forecasts
  DROP CONSTRAINT IF EXISTS financial_forecasts_percentage_check,
  ADD CONSTRAINT financial_forecasts_percentage_check
    CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100));
ALTER TABLE financial_forecast_series
  DROP CONSTRAINT IF EXISTS financial_forecast_series_percentage_check,
  ADD CONSTRAINT financial_forecast_series_percentage_check
    CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100));
`;
