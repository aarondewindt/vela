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
