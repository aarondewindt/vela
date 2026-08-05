'use client';

import { useAuth } from "@/hooks/auth";
import type { User } from "@/lib/auth";
import { Avatar, Button, Group, Modal, Stack, Anchor, TextInput, PasswordInput, Checkbox } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure, UseDisclosureReturnValue } from "@mantine/hooks";
import { useCallback, useMemo } from "react";





export default function CurrentUserBadge({}: {}) {
  const { session, signOut } = useAuth();
  const sign_in_modal_disclosure = useDisclosure(false);
  

  const [line_1, line_2] = useMemo(() => {
      const user = session?.data?.user;
      return [
        (user?.name || "Not signed in"),
        (user ? 
          <Anchor onClick={signOut} component="button">Sign Out</Anchor> : 
          <Anchor onClick={sign_in_modal_disclosure[1].open} component="button">Sign In</Anchor>
        )
      ]
    },    
    [ session ]
  );

  return <Group gap="md">
    <Avatar radius="xl" />
    <Stack gap={0} align="flex-start">
      {line_1}
      {line_2}
      <SignInModal model_disclosure={sign_in_modal_disclosure}/>
    </Stack>
  </Group>  
}


type SignInModalProps = {
  model_disclosure: UseDisclosureReturnValue;
};

function SignInModal({ model_disclosure }: SignInModalProps) {
  const [opened, {open, close} ] = model_disclosure;
  const { signIn } = useAuth();
  
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      email: '',
      password: '',
      rememberMe: true,
    },

    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : 'Invalid email'),
      password: (value) => (value.length >= 8 ? null : 'Password must be at least 8 characters'),
    },
  });

  const onSubmit = useCallback(async (values: typeof form.values) => {
    await signIn(values.email, values.password, "/", values.rememberMe, close);
  }, [signIn]);

  return <>
    <Modal opened={opened} onClose={close} title="Authentication" centered>
      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stack gap="md">
          <TextInput
            withAsterisk
            label="Email"
            placeholder="your@email.com"
            key={form.key('email')}
            {...form.getInputProps('email')}
          />

          <PasswordInput
            withAsterisk
            label="Password"
            placeholder="Enter your password"
            key={form.key('password')}
            {...form.getInputProps('password')}
          />

          <Checkbox
            mt="md"
            label="Remember me"
            key={form.key('rememberMe')}
            {...form.getInputProps('rememberMe', { type: 'checkbox' })}
          />

          <Group justify="flex-end" mt="md">
            <Button type="submit">Submit</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  </>
}
