export const globalRepassesSourceSchema = `
DELETE FROM forecast_distributions
WHERE period >= to_char(CURRENT_DATE, 'YYYY-MM');
`;
