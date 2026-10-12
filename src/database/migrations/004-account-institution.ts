export const accountInstitutionSchema = `
ALTER TABLE financial_accounts ADD COLUMN IF NOT EXISTS institution VARCHAR(120);
`;
