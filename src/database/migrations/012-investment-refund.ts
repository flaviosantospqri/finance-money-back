export const investmentRefundSchema = `
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'investment_transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%transaction_type%'
  LOOP
    EXECUTE format('ALTER TABLE investment_transactions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE investment_transactions
  ADD CONSTRAINT investment_transactions_transaction_type_check
    CHECK (transaction_type IN ('contribution','withdrawal','refund','income','adjustment')),
  ADD CONSTRAINT investment_transactions_amount_check
    CHECK ((transaction_type='adjustment' AND amount <> 0) OR (transaction_type <> 'adjustment' AND amount > 0));
`;
