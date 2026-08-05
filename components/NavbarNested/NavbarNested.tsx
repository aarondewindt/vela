import { Box, Code, Group, ScrollArea, Title } from '@mantine/core';
import { LinksGroup } from '../NavbarLinksGroup/NavbarLinksGroup';
import { Logo } from './Logo';
import classes from './NavbarNested.module.css';
import CurrentUserBadge from '../CurrentUserBadge';
import { GaugeIcon, KanbanIcon } from '@phosphor-icons/react';

const navbar_map = [
  { label: 'Dashboard', icon: GaugeIcon, link: '/' },
  { label: 'Tasks', icon: KanbanIcon, link: '/tasks' },
  // {
  //   label: 'Tasks',
  //   icon: KanbanIcon,
  //   initiallyOpened: true,
  //   links: [
  //     { label: 'All Tasks', link: '/tasks' },
  //     { label: 'This week', link: '/' },
  //   ],
  // },
];

export function NavbarNested() {
  const links = navbar_map.map((item) => <LinksGroup {...item} key={item.label} />);

  return (
    <nav className={classes.navbar}>
      {/* <div className={classes.header}>
        <Group justify="space-between">
          <Group>
            <ParallelogramIcon size={32}/>
            <Title order={2}>Vela</Title>
          </Group>          
          <Code fw={700}>v3.1.2</Code>
        </Group>
      </div> */}

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
