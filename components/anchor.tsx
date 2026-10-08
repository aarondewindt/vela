import { Anchor as MantineAnchor, type AnchorProps as MantineAnchorProps } from '@mantine/core';
import Link, { type LinkProps } from 'next/link';

type AnchorProps = Omit<MantineAnchorProps, 'component' | 'href'> &
  LinkProps & {
    children: React.ReactNode;
  };

export default function Anchor({ href, ...props }: AnchorProps) {
  return <MantineAnchor component={Link} href={href} {...props} />;
}
