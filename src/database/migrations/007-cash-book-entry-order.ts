export const cashBookEntryOrderSchema = `
CREATE TABLE cash_book_entry_order (
  entry_id UUID PRIMARY KEY REFERENCES cash_book_entries(id),
  account_id UUID NOT NULL REFERENCES financial_accounts(id),
  period CHAR(7) NOT NULL,
  position BIGINT NOT NULL
);
CREATE INDEX cash_book_entry_order_scope_idx
  ON cash_book_entry_order (account_id, period, position);
INSERT INTO cash_book_entry_order (entry_id, account_id, period, position)
SELECT id, account_id, to_char(occurred_at, 'YYYY-MM'),
       ROW_NUMBER() OVER (PARTITION BY account_id, to_char(occurred_at, 'YYYY-MM') ORDER BY created_at, id) * 1024
FROM cash_book_entries;
`;
