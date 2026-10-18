import type { Shape } from '../../../../translate';
import type { he } from '../../../auth/he';

/** auth — th overlay (TODO: translate from English). */
export const auth: Shape<Pick<typeof he, 'login' | 'checkEmail' | 'twoFactor'>> = {
  login: {
    title: 'Sign in to RestoMatch',
    subtitle: 'Sign in with your password, or get a magic link by email.',
    email: 'Email address',
    emailPlaceholder: 'you@restaurant.com',
    password: 'Password',
    rememberMe: 'Remember me on this device',
    submit: 'Sign in',
    or: 'or',
    magicLabel: 'Email address for a sign-in link',
    magicSubmit: 'Email me a sign-in link',
    forgot: 'Forgot your password?',
    invitedHint: 'Your invite was sent to this address — sign in with it to get access.',
    sent: 'We sent a sign-in link to your email. Check your inbox.',
    resetDone: 'Your password was updated and all devices were signed out. Sign in with your new password.',
    signedOut: 'You have been signed out.',
    errors: {
      verification: 'This link has expired or was already used. Please try again.',
      credentials: 'Wrong email or password.',
      rate: 'Too many attempts. Please try again later.',
      emailSignin: 'We could not send a sign-in link. There may have been too many requests — try again in a few minutes.',
      generic: 'Something went wrong signing in. Please try again.',
    },
  },
  checkEmail: {
    title: 'Check your email',
    body: 'We sent you a sign-in link. Click it to enter the app. The link is valid for 24 hours.',
    devHint: 'In development — look in the server log under',
    back: 'Back to sign in',
  },
  twoFactor: {
    title: 'Two-step verification',
    subtitle: 'Enter the 6-digit code from your authenticator app, or a one-time recovery code.',
    error: 'The code is wrong or has expired. Please try again.',
    codeLabel: 'Verification code',
    submit: 'Verify',
    switchAccount: 'Sign in with a different account',
  },
};
