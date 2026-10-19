import { BadRequestException } from '@nestjs/common';
import { rebalanceDistributionRows } from '../src/financial-forecasts/financial-forecasts.service.js';

const makeRows = (entries: [string, string, string][]) => entries.map(([id, name, value]): {
  id: string;
  name: string;
  valueType: 'percentage' | 'fixed';
  value: string;
  percentage: string;
  budget: string;
  consumed: string;
} => ({
  id,
  name,
  valueType: 'percentage',
  value,
  percentage: value,
  budget: '0.00',
  consumed: '0.00',
}));

describe('rebalanceDistributionRows', () => {
  it('takes the increase from the largest destination', () => {
    const updated = rebalanceDistributionRows(
      makeRows([['home', 'Casa', '70.00'], ['investments', 'Investimentos', '10.00'], ['flavio', 'Flávio', '10.00'], ['laura', 'Laura', '10.00']]),
      'investments',
      '15.00',
    );
    expect(updated.map((row) => row.value)).toEqual(['65.00', '15.00', '10.00', '10.00']);
  });

  it('continues across the next largest shares without making any share negative', () => {
    const updated = rebalanceDistributionRows(
      makeRows([['home', 'Casa', '62.00'], ['investments', 'Investimentos', '18.00'], ['flavio', 'Flávio', '10.00'], ['laura', 'Laura', '10.00']]),
      'investments',
      '99.00',
    );
    expect(updated.map((row) => row.value)).toEqual(['0.00', '99.00', '0.00', '1.00']);
    expect(updated.reduce((sum, row) => sum + Number(row.value), 0)).toBe(100);
    expect(updated.every((row) => Number(row.value) >= 0)).toBe(true);
  });

  it('returns a reduced share to the largest other destination', () => {
    const updated = rebalanceDistributionRows(
      makeRows([['home', 'Casa', '65.00'], ['investments', 'Investimentos', '15.00'], ['flavio', 'Flávio', '10.00'], ['laura', 'Laura', '10.00']]),
      'investments',
      '12.00',
    );
    expect(updated.map((row) => row.value)).toEqual(['68.00', '12.00', '10.00', '10.00']);
  });

  it('does not convert a fixed-value destination to a percentage', () => {
    const rows = makeRows([['home', 'Casa', '80.00'], ['investments', 'Investimentos', '20.00']]);
    rows[1].valueType = 'fixed';
    expect(() => rebalanceDistributionRows(rows, 'investments', '15.00')).toThrow(BadRequestException);
  });
});
