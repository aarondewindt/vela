import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { GaugeChart as MantineGaugeChart } from '@mantine/charts';
import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { VelaGaugeChart, type VelaGaugeChartProps } from './VelaGaugeChart';

const roundedSvg = (value: string | null) =>
  value?.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (n) => String(Number(Number(n).toFixed(6))));

it('exposes one named meter, formatted clamped value and a forwarded SVG ref', () => {
  const ref = createRef<SVGSVGElement>();
  render(
    <VelaGaugeChart ref={ref} value={120} valueFormatter={(v) => `${v}%`} aria-label="Usage" />
  );
  const meter = screen.getByRole('meter', { name: 'Usage' });
  expect(ref.current).toBe(meter);
  expect(meter).toHaveAttribute('aria-valuenow', '100');
  expect(meter).toHaveAttribute('aria-valuemin', '0');
  expect(meter).toHaveAttribute('aria-valuemax', '100');
  expect(meter).toHaveAttribute('aria-valuetext', '100%');
  expect(screen.getByText('100%')).toBeInTheDocument();
});

it('describes >2 overlapping markers independently and composes caller descriptions', () => {
  const { container } = render(
    <>
      <p id="help">Additional context</p>
      <VelaGaugeChart
        value={42}
        aria-describedby="help"
        markers={[
          { id: 'current', value: 42, color: 'gray.0', label: 'Current', size: 3 },
          { id: 'projected', value: 68, color: 'blue', label: 'Projected', lineStyle: 'dashed' },
          { id: 'overlap', value: 68, color: '#ff0000', size: 5 },
          { id: 'outside', value: 130 },
        ]}
      />
    </>
  );
  const meter = screen.getByRole('meter');
  expect(meter).toHaveAccessibleDescription(
    'Additional context Current: 42; Projected: 68; overlap: 68; outside: 130 (position clamped to range)'
  );
  expect(meter).toHaveAttribute('aria-valuenow', '42');
  const lines = container.querySelectorAll('line');
  expect([...lines].map((line) => line.dataset.markerId)).toEqual([
    'current',
    'projected',
    'overlap',
    'outside',
  ]);
  expect(lines[0]).toHaveAttribute('stroke', 'var(--mantine-color-gray-0)');
  expect(lines[1]).toHaveAttribute('stroke-dasharray', '4 2');
  expect(lines[2]).toHaveAttribute('stroke', '#ff0000');
  expect(lines[1].getAttribute('x1')).toBe(lines[2].getAttribute('x1'));
  expect(lines[2]).toHaveAttribute('stroke-width', '5');
});

it('supports target compatibility alongside markers and custom labels/names', () => {
  const { container } = render(
    <>
      <span id="name">Capacity</span>
      <VelaGaugeChart
        value={42}
        target={60}
        targetColor="red.4"
        targetSize={4}
        markers={[{ id: 'extra', value: 30 }]}
        aria-labelledby="name"
        label={<b>Custom label</b>}
      />
    </>
  );
  expect(screen.getByRole('meter', { name: 'Capacity' })).toHaveAccessibleDescription(
    'Target: 60; extra: 30'
  );
  expect(screen.getByText('Custom label')).toBeInTheDocument();
  expect(container.querySelector('line')).toHaveAttribute('stroke', 'var(--mantine-color-red-4)');
  expect(container.querySelector('line')).toHaveAttribute('stroke-width', '4');
});

it.each([
  {},
  { startAngle: -90, endAngle: 90 },
  { startAngle: 0, endAngle: 360 },
  { startAngle: 120, endAngle: -120 },
  { startAngle: -90, endAngle: 630 },
  { roundCaps: true },
  { sections: [] },
  {
    sections: [
      { value: 80, color: 'red' },
      { value: 30, color: 'blue' },
      { value: 100, color: 'green' },
    ],
    roundCaps: true,
  },
])('matches installed Mantine arc geometry, caps and colors for %j', (props) => {
  const { container } = render(
    <>
      <MantineGaugeChart value={65} {...props} />
      <VelaGaugeChart value={65} {...props} />
    </>
  );
  const [original, custom] = container.querySelectorAll('svg');
  const paths = (svg: SVGSVGElement) =>
    [...svg.querySelectorAll('path')].map((p) =>
      ['d', 'stroke', 'stroke-width', 'stroke-linecap'].map((name) =>
        roundedSvg(p.getAttribute(name))
      )
    );
  expect(paths(custom)).toEqual(paths(original));
  expect(roundedSvg(custom.getAttribute('viewBox'))).toBe(
    roundedSvg(original.getAttribute('viewBox'))
  );
});

it.each([false, true])(
  'keeps thick endpoint markers within viewBox (roundCaps=%s)',
  (roundCaps) => {
    const { container } = render(
      <VelaGaugeChart
        value={0}
        size={80}
        thickness={25}
        startAngle={-45}
        endAngle={45}
        roundCaps={roundCaps}
        markers={[
          { id: 'min', value: 0, size: 30 },
          { id: 'max', value: 100, size: 30 },
        ]}
      />
    );
    const svg = container.querySelector('svg')!;
    const [x, y, width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    for (const line of svg.querySelectorAll('line')) {
      const dx = Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
      const dy = Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'));
      const length = Math.hypot(dx, dy);
      const paddingX = roundCaps ? 15 : Math.abs(dy / length) * 15;
      const paddingY = roundCaps ? 15 : Math.abs(dx / length) * 15;
      for (const endpoint of ['1', '2']) {
        const px = Number(line.getAttribute(`x${endpoint}`));
        const py = Number(line.getAttribute(`y${endpoint}`));
        expect(px - paddingX + 0.000002).toBeGreaterThanOrEqual(x);
        expect(px + paddingX - 0.000002).toBeLessThanOrEqual(x + width);
        expect(py - paddingY + 0.000002).toBeGreaterThanOrEqual(y);
        expect(py + paddingY - 0.000002).toBeLessThanOrEqual(y + height);
      }
    }
  }
);

it.each([
  { value: NaN },
  { value: Infinity },
  { min: 100 },
  { max: -1 },
  { min: NaN },
  { size: 0 },
  { thickness: -1 },
  { thickness: 200 },
  { startAngle: Infinity },
  { target: NaN },
  { targetSize: 0 },
  { sections: [{ value: NaN, color: 'red' }] },
  { markers: [{ id: 'bad', value: Infinity }] },
  { markers: [{ id: '', value: 5 }] },
  { markers: [{ id: 'bad', value: 5, size: -1 }] },
  {
    markers: [
      { id: 'same', value: 5 },
      { id: 'same', value: 10 },
    ],
  },
] as Partial<VelaGaugeChartProps>[])(
  'rejects invalid numeric configuration %j during SSR',
  (props) => {
    expect(() =>
      renderToString(
        <MantineProvider>
          <VelaGaugeChart value={50} {...props} />
        </MantineProvider>
      )
    ).toThrow(RangeError);
  }
);

it('renders on the server in either color scheme with unique description ids and Styles API', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const html = renderToString(
      <MantineProvider
        forceColorScheme={scheme}
        theme={{
          components: {
            VelaGaugeChart: VelaGaugeChart.extend({ defaultProps: { trackColor: 'pink.3' } }),
          },
        }}
      >
        {[1, 2].map((id) => (
          <VelaGaugeChart
            key={id}
            value={50}
            markers={[{ id: 'm', value: 60 }]}
            classNames={{ needle: 'custom-marker' }}
            styles={{ label: { fontSize: 18 } }}
          />
        ))}
      </MantineProvider>
    );
    expect(html).toContain('var(--mantine-color-pink-3)');
    expect(html).toContain('custom-marker');
    expect(html).toContain('font-size:18px');
    expect(new Set([...html.matchAll(/<desc id="([^"]+)"/g)].map((m) => m[1])).size).toBe(2);
    expect(html).not.toMatch(/NaN|Infinity/);
  }
});
