export const investmentLedgerOnlySchema = `
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'investment_transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%transfer_id IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE investment_transactions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

UPDATE investment_transactions t
SET transfer_id = NULL
FROM cash_book_transfers x
WHERE t.transfer_id = x.id
  AND (x.source_application_id IS NOT NULL OR x.destination_application_id IS NOT NULL);

UPDATE cash_book_entries e
SET deleted_at = COALESCE(e.deleted_at, NOW()), updated_at = NOW()
WHERE e.transfer_id IN (
  SELECT id FROM cash_book_transfers
  WHERE source_application_id IS NOT NULL OR destination_application_id IS NOT NULL
);

UPDATE cash_book_transfers
SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
WHERE source_application_id IS NOT NULL OR destination_application_id IS NOT NULL;

ALTER TABLE investment_applications DROP COLUMN opening_balance;
ALTER TABLE investment_applications DROP COLUMN reference_date;
`;
