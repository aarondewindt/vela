import { useEffect, useState } from 'react';
import { NavLink } from '@mantine/core';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAppShellStore } from '@/store/app_shell_store';

interface LinksGroupProps {
  icon: React.FC<any>;
  label: string;
  initiallyOpened?: boolean;
  links?: { label: string; link: string }[];
  link?: string;
  pathPattern?: RegExp;
}

export function LinksGroup({
  icon: Icon,
  label,
  initiallyOpened,
  links,
  link,
  pathPattern,
}: LinksGroupProps) {
  const closeNavbar = useAppShellStore((state) => state.close_navbar);
  const handleNavigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      closeNavbar();
    }
  };
  const hasLinks = Array.isArray(links);
  const pathname = usePathname();
  const isActive = pathPattern?.test(pathname ?? '') ?? false;
  const [opened, setOpened] = useState(initiallyOpened ?? isActive);

  useEffect(() => {
    if (pathPattern) {
      setOpened(isActive);
    }
  }, [isActive, pathname, pathPattern]);

  const children =
    hasLinks &&
    links.map((item) => (
      <NavLink
        key={item.label}
        component={Link}
        href={item.link}
        label={item.label}
        active={pathname === item.link}
        onClick={handleNavigate}
      />
    ));
  const navLinkProps = {
    label,
    leftSection: <Icon size={18} />,
    active: isActive || link === pathname,
    opened,
    onChange: setOpened,
  };

  if (link) {
    return (
      <NavLink {...navLinkProps} component={Link} href={link} onClick={handleNavigate}>
        {children}
      </NavLink>
    );
  }

  return <NavLink {...navLinkProps}>{children}</NavLink>;
}
