import { render, screen } from '@/test-utils';
import { LinksGroup } from './NavbarLinksGroup';

jest.mock('next/navigation', () => ({
  usePathname: () => '/planner/today',
}));

const Icon = () => <svg />;

describe('LinksGroup', () => {
  it('renders a single link', () => {
    render(<LinksGroup icon={Icon} label="Today" link="/planner/today" />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('renders nested links when opened', () => {
    render(
      <LinksGroup
        icon={Icon}
        label="Planner"
        initiallyOpened
        links={[{ label: 'Tasks', link: '/planner/tasks' }]}
      />
    );
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });
});

// The same flag controls only mobile collapse; desktop navigation stays visible.
import { fireEvent } from '@testing-library/react';
import { useAppShellStore } from '@/store/app_shell_store';

beforeEach(() => {
  useAppShellStore.setState({ navbar_opened: true });
});

it('closes navigation when selecting the current top-level destination', () => {
  render(<LinksGroup icon={Icon} label="Today" link="/planner/today" />);
  fireEvent.click(screen.getByRole('link', { name: 'Today' }));
  expect(useAppShellStore.getState().navbar_opened).toBe(false);
});

it('closes navigation when selecting a nested destination', () => {
  render(
    <LinksGroup
      icon={Icon}
      label="Planner"
      initiallyOpened
      links={[{ label: 'Tasks', link: '/planner/tasks' }]}
    />
  );
  fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));
  expect(useAppShellStore.getState().navbar_opened).toBe(false);
});

it('keeps navigation open when expanding a group', () => {
  render(
    <LinksGroup icon={Icon} label="Planner" links={[{ label: 'Tasks', link: '/planner/tasks' }]} />
  );
  fireEvent.click(screen.getByText('Planner'));
  expect(useAppShellStore.getState().navbar_opened).toBe(true);
});

it('keeps navigation open when opening a destination in another tab', () => {
  render(<LinksGroup icon={Icon} label="Today" link="/planner/today" />);
  fireEvent.click(screen.getByRole('link', { name: 'Today' }), { ctrlKey: true });
  expect(useAppShellStore.getState().navbar_opened).toBe(true);
});
