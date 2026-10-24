import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { BasicMarkdown } from './BasicMarkdown';

it('renders basic formatting and treats model HTML as escaped text', () => {
  const { container } = render(
    <BasicMarkdown text={'# Plan\n**Focus** on `task`\n- First\n<script>alert(1)</script>'} />
  );
  expect(screen.getByText('Plan')).toBeInTheDocument();
  expect(container.querySelector('strong')).toHaveTextContent('Focus');
  expect(container.querySelector('code')).toHaveTextContent('task');
  expect(screen.getByText('• First')).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
});
