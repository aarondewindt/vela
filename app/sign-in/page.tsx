"use client";

import { useAuth } from '@/hooks/auth';
import { Button, PasswordInput, Group, TextInput, Container, Stack, Checkbox } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useCallback } from 'react';


export default () => {
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
    await signIn(values.email, values.password);
  }, [signIn]);

  return (
    <Container>
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
    </Container>
    
  );
}