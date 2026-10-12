export const categoryHierarchySchema = `
ALTER TABLE financial_categories
  ADD COLUMN parent_category_id UUID REFERENCES financial_categories(id);
CREATE INDEX financial_categories_parent_idx
  ON financial_categories(parent_category_id, active, name);
`;
