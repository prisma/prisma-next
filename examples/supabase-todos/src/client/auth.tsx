/**
 * AuthProvider — keeps the SPA in sync with `supabase.auth`.
 *
 * Reads the initial session at mount, then subscribes to
 * `onAuthStateChange` so sign-in / sign-out / token-refresh events
 * propagate to consumers. `useAuth()` exposes the current session +
 * helpers (`signIn`, `signUp`, `signOut`).
 *
 * Why a Context, not a top-level prop drill: realtime + apiFetch +
 * the protected route all need the session token. Threading it
 * through props would create incidental coupling between unrelated
 * components. Context is the lightweight default for "global app
 * state read by many components."
 */
import type { Session } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface AuthState {
  readonly status: 'loading' | 'authenticated' | 'anonymous';
  readonly session: Session | null;
}

export interface AuthApi {
  readonly state: AuthState;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signUp: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null });

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setState({
        status: data.session ? 'authenticated' : 'anonymous',
        session: data.session,
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        status: session ? 'authenticated' : 'anonymous',
        session,
      });
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  return (
    <AuthContext.Provider value={{ state, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be called inside <AuthProvider>');
  }
  return ctx;
}
