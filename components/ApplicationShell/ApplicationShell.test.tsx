import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { useAppShellStore } from '@/store/app_shell_store';
import ApplicationShell from './index';

jest.mock('../NavbarNested/NavbarNested', () => ({ NavbarNested: () => <nav>Navigation</nav> }));
jest.mock('@/store/app_shell_store', () => ({
  useAppShellStore: Object.assign(jest.fn(), { persist: { rehydrate: jest.fn() } }),
}));
it('keeps an accessible mobile menu toggle and removes desktop header offset', () => {
  const toggle = jest.fn();
  (useAppShellStore as unknown as jest.Mock).mockReturnValue({
    navbar_opened: false,
    aside_opened: false,
    sizes: {},
    set_sizes: jest.fn(),
    toggle_navbar: toggle,
  });
  const { container } = render(<ApplicationShell>Page content</ApplicationShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('banner')).toHaveClass('mantine-hidden-from-sm');
  expect(screen.getByText('Page content')).toBeInTheDocument();
  const css = Array.from(container.querySelectorAll('style'))
    .map((node) => node.textContent)
    .join('');
  expect(css).toContain('--app-shell-header-offset:calc(2rem * var(--mantine-scale))');
  expect(css).toContain('--app-shell-header-offset:0rem');
});
