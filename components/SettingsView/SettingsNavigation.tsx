'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NavLink, SimpleGrid } from '@mantine/core';
import { settingsSections } from './sections';
export function SettingsNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    // Keep bookmarks and links from older Vela versions working after the split.
    if (pathname === '/settings' && window.location.hash === '#ai-models') {
      router.replace('/settings/ai-models');
    }
  }, [pathname, router]);
  return (
    <SimpleGrid
      component="nav"
      aria-label="Settings sections"
      cols={{ base: 2, sm: 3, lg: 4 }}
      spacing="xs"
    >
      {[{ label: 'Overview', href: '/settings' }, ...settingsSections].map((section) => (
        <NavLink
          key={section.href}
          component={Link}
          href={section.href}
          label={section.label}
          active={pathname === section.href}
          aria-current={pathname === section.href ? 'page' : undefined}
        />
      ))}
    </SimpleGrid>
  );
}
