import { Anchor as MantineAnchor, AnchorProps as MantineAnchorProps, ElementProps } from '@mantine/core';
import Link from 'next/link';


type AnchorProps = MantineAnchorProps & {
  href: string;
  children: React.ReactNode;
};


export default function Anchor(props: AnchorProps) {
  return (
    <MantineAnchor
      component={Link}
      {...props}
    />
  );
}