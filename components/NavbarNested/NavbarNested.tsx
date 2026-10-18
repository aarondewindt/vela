import { Box, ScrollArea } from '@mantine/core';
import { LinksGroup } from '../NavbarLinksGroup/NavbarLinksGroup';
import classes from './NavbarNested.module.css';
import CurrentUserBadge from '../CurrentUserBadge';
import {
  GaugeIcon,
  KanbanIcon,
  BugIcon,
  GearIcon,
  ChatCircleIcon,
  ForkKnifeIcon,
} from '@phosphor-icons/react';

const navbar_map = [
  { label: 'Dashboard', icon: GaugeIcon, link: '/' },
  {
    label: 'Planner',
    icon: KanbanIcon,
    pathPattern: /^\/planner(?:\/|$)/,
    links: [
      { label: 'Today', link: '/planner/today' },
      { label: 'Tasks', link: '/planner/tasks' },
      { label: 'Fuzzy task search', link: '/planner/task-search' },
    ],
  },
  {
    label: 'Nutrition',
    icon: ForkKnifeIcon,
    pathPattern: /^\/nutrition(?:\/|$)/,
    links: [
      { label: 'Diary', link: '/nutrition' },
      { label: 'Food products', link: '/nutrition/products' },
      { label: 'History', link: '/nutrition/history' },
      { label: 'Daily goals', link: '/nutrition/settings' },
    ],
  },
  { label: 'Settings', icon: GearIcon, link: '/settings' },
  {
    label: 'AI Dev',
    icon: ChatCircleIcon,
    pathPattern: /^\/ai-dev(?:\/|$)/,
    links: [
      { label: 'Chat', link: '/ai-dev' },
      { label: 'Embeddings', link: '/ai-dev/embeddings' },
    ],
  },
  { label: 'Dev tools', icon: BugIcon, link: '/dev-tools' },
];

export function NavbarNested() {
  const links = navbar_map.map((item) => <LinksGroup {...item} key={item.label} />);

  return (
    <nav className={classes.navbar}>
      <ScrollArea className={classes.links}>
        <div className={classes.linksInner}>{links}</div>
      </ScrollArea>

      <div className={classes.footer}>
        <Box style={{ padding: '1rem', width: '100%' }}>
          <CurrentUserBadge />
        </Box>
      </div>
    </nav>
  );
}
