import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  title: 'Welcome to RestoMatch',
  subtitle: 'First, let’s create your restaurant. You’ll join it automatically as the owner.',
  yourName: 'Your name',
  yourNamePlaceholder: 'Dana Cohen',
  yourNameHint: 'This is how your name appears on invites you send to your team.',
  name: 'Restaurant name',
  namePlaceholder: 'e.g. Harbour Bistro',
  businessId: 'Company / VAT number',
  optional: '(optional)',
  businessIdHint: '9–12 digits. Dashes are fine.',
  submit: 'Create restaurant and continue',
  invitedNote: 'Invited to an existing team? Open the invite link from your email instead of creating a new restaurant.',
  signOut: 'Sign out',
  closed: {
    title: 'Sign-up is by invitation only',
    body: 'Sign-up is currently by invitation only. For details:',
    contactName: 'Rom Koren',
  },
  required: '(required)',
  errors: {
    yourName: 'Enter your name (2–80 characters).',
    name: 'The restaurant name must be 2–120 characters.',
    businessId: 'The company number must be 9–12 digits.',
  },
};
