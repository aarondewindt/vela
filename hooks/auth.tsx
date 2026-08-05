'use client';

import { authClient } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useCallback } from 'react';
import { nprogress } from '@mantine/nprogress';

export function useAuth() {
  const session = authClient.useSession();

  return {
    session: session,

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
          session.refetch();
          redirect('/');
        },
        onError: (ctx) => {
          nprogress.complete();
          session.refetch();
          alert(ctx.error.message);          
        },
      });
    }, [authClient]),

    signIn: useCallback(async (email: string, password: string, callbackURL: string="/", rememberMe: boolean=true, onSuccess?: () => void) => {
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
          session.refetch();
          if (onSuccess) onSuccess();
          redirect('/');          
        },
        onError: (ctx) => {
          nprogress.complete();
          session.refetch();
          alert(ctx.error.message);
        },
      })
    }, [authClient]),

    signOut: useCallback(async () => {
      await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          session.refetch();
          redirect("/"); // redirect to login page
        },
        onError: (ctx) => {
          session.refetch();
          alert(ctx.error.message);
        }
      }});
    }, [authClient]),
  }
}
