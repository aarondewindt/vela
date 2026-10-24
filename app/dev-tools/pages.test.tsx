jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
jest.mock('next/headers', () => ({ headers: jest.fn().mockResolvedValue(new Headers()) }));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/components/DevToolsView/DevToolsView', () => ({
  DevToolsView: () => <div>Existing planner controls</div>,
}));
import { screen, within } from '@testing-library/react';
import { render } from '@/test-utils';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import Page from './page';
import Planner from './planner/page';
import Layout from './layout';
afterEach(() => {
  delete process.env.VELA_PUBLIC_MODE;
});
it('redirects the old entry point and preserves the Planner view', () => {
  Page();
  expect(redirect).toHaveBeenCalledWith('/dev-tools/planner');
  render(<Planner />);
  expect(screen.getByText('Existing planner controls')).toBeInTheDocument();
});
it('keeps private tools behind a session and blocks public mode', async () => {
  (auth.api.getSession as unknown as jest.Mock).mockResolvedValue(null);
  render(await Layout({ children: <div>Secret tools</div> }));
  expect(screen.queryByText('Secret tools')).not.toBeInTheDocument();
  process.env.VELA_PUBLIC_MODE = 'true';
  await expect(Layout({ children: null })).rejects.toThrow('NOT_FOUND');
});
it('shows navigation to both tools and the requested content for a signed-in user', async () => {
  (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ user: { id: 'owner' } });
  render(await Layout({ children: <div>Companion diagnostics</div> }));
  const navigation = within(screen.getByRole('navigation', { name: 'Dev Tools sections' }));
  expect(navigation.getByRole('link', { name: 'Dev Tools / Planner' })).toHaveAttribute(
    'href',
    '/dev-tools/planner'
  );
  expect(navigation.getByRole('link', { name: 'Dev Tools / Companion App' })).toHaveAttribute(
    'href',
    '/dev-tools/companion'
  );
  expect(screen.getByText('Companion diagnostics')).toBeInTheDocument();
});
