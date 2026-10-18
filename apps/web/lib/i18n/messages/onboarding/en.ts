import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  title: 'Welcome to RestoMatch',
  subtitle: 'First, let’s create your restaurant. You’ll join it automatically as the owner.',
  name: 'Restaurant name',
  namePlaceholder: 'Olive Village',
  businessId: 'Company / VAT number',
  optional: '(optional)',
  businessIdHint: '9–12 digits, no dashes.',
  submit: 'Create restaurant and continue',
  invitedNote: 'Invited to an existing team? Open the invite link from your email instead of creating a new restaurant.',
  signOut: 'Sign out',
  errors: {
    name: 'The restaurant name must be 2–120 characters.',
    businessId: 'The company number must be 9–12 digits.',
  },
};
