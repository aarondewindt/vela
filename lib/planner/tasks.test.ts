import { taskSizeLabel, taskSizeOptions, taskSizeValues } from './tasks';

describe('task size labels', () => {
  it('maps each stored size value to its user-facing name', () => {
    expect(taskSizeValues.map(taskSizeLabel)).toEqual(['Unknown', 'XL', 'L', 'M', 'S', 'XS']);
  });

  it('provides named select options and treats unsupported values as unknown', () => {
    expect(taskSizeOptions).toEqual([
      { value: '0', label: 'Unknown' },
      { value: '1', label: 'XL' },
      { value: '2', label: 'L' },
      { value: '3', label: 'M' },
      { value: '4', label: 'S' },
      { value: '5', label: 'XS' },
    ]);
    expect(taskSizeLabel(99)).toBe('Unknown');
  });
});
