import { taskSizeLabel, taskSizeOptions, taskSizeValues } from './tasks';

describe('task size labels', () => {
  it('maps each stored size value to its user-facing name', () => {
    expect(taskSizeValues.map(taskSizeLabel)).toEqual(['Unknown', 'XS', 'S', 'M', 'L', 'XL']);
  });

  it('provides named select options and treats unsupported values as unknown', () => {
    expect(taskSizeOptions).toEqual([
      { value: '0', label: 'Unknown' },
      { value: '1', label: 'XS' },
      { value: '2', label: 'S' },
      { value: '3', label: 'M' },
      { value: '4', label: 'L' },
      { value: '5', label: 'XL' },
    ]);
    expect(taskSizeLabel(99)).toBe('Unknown');
  });
});
