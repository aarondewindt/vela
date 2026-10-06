import { Box, Code, Group, ScrollArea, Title } from '@mantine/core';
import { LinksGroup } from '../NavbarLinksGroup/NavbarLinksGroup';
import { Logo } from './Logo';
import classes from './NavbarNested.module.css';
import CurrentUserBadge from '../CurrentUserBadge';
import { GaugeIcon, KanbanIcon } from '@phosphor-icons/react';

const navbar_map = [
  { label: 'Dashboard', icon: GaugeIcon, link: '/' },
  { label: 'Planner', icon: KanbanIcon, link: '/planner' },
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
