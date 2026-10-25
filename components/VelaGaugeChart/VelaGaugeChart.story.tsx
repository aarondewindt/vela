import { GaugeChart as MantineGaugeChart } from '@mantine/charts';
import { Group, Stack, Text } from '@mantine/core';
import { VelaGaugeChart, type VelaGaugeChartProps } from './VelaGaugeChart';

export default { title: 'VelaGaugeChart' };

export const MultipleMarkers = () => (
  <VelaGaugeChart
    value={42}
    aria-label="Capacity"
    markers={[
      { id: 'current', value: 42, color: 'gray.0', label: 'Current', size: 3 },
      { id: 'projected', value: 68, color: 'blue', label: 'Projected', lineStyle: 'dashed' },
    ]}
  />
);

const examples: Partial<VelaGaugeChartProps>[] = [
  {},
  {
    sections: [
      { value: 40, color: 'teal' },
      { value: 100, color: 'orange' },
    ],
    roundCaps: true,
  },
  { target: 65 },
  { startAngle: -90, endAngle: 90 },
  { startAngle: 0, endAngle: 360 },
  { startAngle: 120, endAngle: -120 },
];

export const MantineComparison = () => (
  <Stack>
    <Text>Mantine (left) / Vela (right)</Text>
    {examples.map((props, index) => (
      <Group key={index} align="start">
        <MantineGaugeChart value={42} {...props} />
        <VelaGaugeChart value={42} {...props} />
      </Group>
    ))}
  </Stack>
);
