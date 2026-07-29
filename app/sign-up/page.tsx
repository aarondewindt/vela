"use client";

import { useAuth } from '@/hooks/auth';
import { Button, PasswordInput, Group, TextInput, Container, Stack } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useCallback } from 'react';


export default () => {
  const { signUp } = useAuth();

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      name: '',
      email: '',
      password: '',
    },

    validate: {
      name: (value) => (value.length > 0 ? null : 'Name is required'),
      email: (value) => (/^\S+@\S+$/.test(value) ? null : 'Invalid email'),
      password: (value) => (value.length >= 8 ? null : 'Password must be at least 8 characters'),
    },
  });

  const onSubmit = useCallback(async (values: typeof form.values) => {
    await signUp(values.email, values.password, values.name);
  }, [signUp]);

  return (
    <Container>
      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stack gap="md">
          <TextInput
            withAsterisk
            label="Name"
            placeholder="Jhon"
            key={form.key('name')}
            {...form.getInputProps('name')}
          />

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

          <Group justify="flex-end" mt="md">
            <Button type="submit">Submit</Button>
          </Group>
        </Stack>
      </form>
    </Container>
    
  );
}