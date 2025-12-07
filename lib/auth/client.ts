import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
  plugins: [
    emailOTPClient()
  ]
});

interface RouterLike {
  push: (href: string) => void;
}

interface SignOutOptions {
  router?: RouterLike;
  onError?: (error: unknown) => void;
}

export const signOut = async (options?: SignOutOptions) => {
  try {
    await authClient.signOut();
    
    if (options?.router) {
      options.router.push('/login');
    } else {
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Sign out failed:', error);
    
    if (options?.onError) {
      options.onError(error);
    }
    
    // Re-throw to allow caller to handle if needed
    throw error;
  }
};