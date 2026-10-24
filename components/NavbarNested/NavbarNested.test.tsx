let mockPath = '/settings/health';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('../CurrentUserBadge', () => () => <div>Account</div>);
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { settingsSections } from '@/components/SettingsView/sections';
import { useAppShellStore } from '@/store/app_shell_store';
import { NavbarNested } from './NavbarNested';

it('opens Settings on its subroutes with all sections nested in the main navbar', () => {
  useAppShellStore.setState({ navbar_opened: true });
  render(<NavbarNested />);
  expect(screen.getByText('Settings').closest('a')).toHaveAttribute('data-expanded', 'true');
  for (const section of settingsSections) {
    expect(
      screen
        .getAllByRole('link', { name: section.label })
        .some((link) => link.getAttribute('href') === section.href)
    ).toBe(true);
  }
  const health = screen
    .getAllByRole('link', { name: 'Health' })
    .find((link) => link.getAttribute('href') === '/settings/health')!;
  expect(health).toHaveAttribute('data-active', 'true');
  fireEvent.click(health);
  expect(useAppShellStore.getState().navbar_opened).toBe(false);
});

it('registers Discover as a Vela app in the main navigation', () => {
  render(<NavbarNested />);
  expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover');
});

it('opens Dev tools and marks the Companion App route active', () => {
  mockPath = '/dev-tools/companion';
  render(<NavbarNested />);
  expect(screen.getByText('Dev tools').closest('a')).toHaveAttribute('data-expanded', 'true');
  expect(screen.getByRole('link', { name: 'Companion App' })).toHaveAttribute(
    'href',
    '/dev-tools/companion'
  );
  expect(screen.getByRole('link', { name: 'Companion App' })).toHaveAttribute(
    'data-active',
    'true'
  );
  expect(screen.getByRole('link', { name: 'Planner' })).toHaveAttribute(
    'href',
    '/dev-tools/planner'
  );
});
