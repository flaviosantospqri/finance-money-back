export const categoryNameScopeSchema = `
ALTER TABLE financial_categories
  DROP CONSTRAINT IF EXISTS financial_categories_name_nature_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'financial_categories'::regclass
      AND conname = 'financial_categories_destination_name_nature_key'
  ) THEN
    ALTER TABLE financial_categories
      ADD CONSTRAINT financial_categories_destination_name_nature_key UNIQUE(destination_id, name, nature);
  END IF;
END $$;
`;
