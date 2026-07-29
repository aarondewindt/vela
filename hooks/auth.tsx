'use client';

import { authClient } from '@/app/lib/auth-client';
import { redirect } from 'next/navigation';
import { useCallback } from 'react';
import { nprogress } from '@mantine/nprogress';

export function useAuth() {
  return {
    session: authClient.useSession(),

    signUp: useCallback(async (email: string, password: string, name: string) => {
      authClient.signUp.email({
        email,
        password,
        name,
      }, {
        onRequest: (ctx) => {
          nprogress.start();
        },
        onSuccess: (ctx) => {
          nprogress.complete();
          redirect('/');
        },
        onError: (ctx) => {
          nprogress.complete();
          alert(ctx.error.message);
        },
      });
    }, []),

    signIn: useCallback(async (email: string, password: string, callbackURL: string="/", rememberMe: boolean=true) => {
      await authClient.signIn.email({
        email,
        password,
        callbackURL,
        rememberMe
      }, {
        onRequest: (ctx) => {
          nprogress.start();
        },
        onSuccess: (ctx) => {
          nprogress.complete();
          redirect('/');
        },
        onError: (ctx) => {
          nprogress.complete();
          alert(ctx.error.message);
        },
      })
    }, []),

    signOut: useCallback(async () => {
      await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          redirect("/login"); // redirect to login page
        },
      }});
    }, []),
  }
}
