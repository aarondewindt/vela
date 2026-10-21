jest.mock('next/navigation', () => ({ usePathname: jest.fn(), useRouter: jest.fn() }));
import { screen, within } from '@testing-library/react';
import { usePathname, useRouter } from 'next/navigation';
import { render } from '@/test-utils';
import { SettingsNavigation } from './SettingsNavigation';
import { SettingsView } from './SettingsView';
const replace = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/settings');
  (useRouter as jest.Mock).mockReturnValue({ replace });
  (usePathname as jest.Mock).mockReturnValue('/settings/nutrition');
});
it('makes every implemented settings page reachable and marks the current page', () => {
  render(<SettingsNavigation />);
  const nav = within(screen.getByRole('navigation', { name: 'Settings sections' }));
  const expected = {
    Overview: '/settings',
    Profile: '/settings/profile',
    Appearance: '/settings/appearance',
    'AI & models': '/settings/ai-models',
    Planner: '/settings/planner',
    Nutrition: '/settings/nutrition',
    Health: '/settings/health',
    'Home Assistant': '/settings/home-assistant',
  };
  for (const [label, href] of Object.entries(expected)) {
    expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
  expect(nav.getByRole('link', { name: 'Nutrition' })).toHaveAttribute('aria-current', 'page');
  expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
});
it('groups discoverable configuration links on the overview', () => {
  render(<SettingsView />);
  for (const group of ['Account', 'Apps', 'Integrations']) {
    expect(screen.getByRole('heading', { name: group })).toBeInTheDocument();
  }
  expect(screen.getByRole('link', { name: /Nutrition/ })).toHaveAttribute(
    'href',
    '/settings/nutrition'
  );
  expect(screen.getByRole('link', { name: /Home Assistant/ })).toHaveAttribute(
    'href',
    '/settings/home-assistant'
  );
});
it('preserves older AI settings bookmarks', () => {
  window.history.replaceState(null, '', '/settings#ai-models');
  (usePathname as jest.Mock).mockReturnValue('/settings');
  render(<SettingsNavigation />);
  expect(replace).toHaveBeenCalledWith('/settings/ai-models');
});
