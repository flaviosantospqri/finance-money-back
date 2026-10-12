export const categoryRepasseSchema = `
ALTER TABLE financial_categories
  ADD COLUMN destination_id UUID REFERENCES forecast_destinations(id);

UPDATE financial_categories
SET destination_id = (SELECT id FROM forecast_destinations WHERE name = 'Outras' LIMIT 1)
WHERE destination_id IS NULL;

ALTER TABLE financial_categories
  ALTER COLUMN destination_id SET NOT NULL;

ALTER TABLE financial_categories
  DROP CONSTRAINT IF EXISTS financial_categories_name_nature_key,
  ADD CONSTRAINT financial_categories_destination_name_nature_key UNIQUE(destination_id, name, nature);

CREATE INDEX financial_categories_destination_idx ON financial_categories(destination_id, nature, active);
`;
