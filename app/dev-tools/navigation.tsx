'use client';

import Link from 'next/link';
import { Anchor, Group } from '@mantine/core';

export function DevToolsNavigation() {
  return (
    <Group component="nav" aria-label="Dev Tools sections">
      <Anchor component={Link} href="/dev-tools/planner">
        Dev Tools / Planner
      </Anchor>
      <Anchor component={Link} href="/dev-tools/companion">
        Dev Tools / Companion App
      </Anchor>
    </Group>
  );
}
