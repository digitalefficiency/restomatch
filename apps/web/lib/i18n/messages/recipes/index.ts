import { defineMessages } from '../../translate';
import { en } from './en';
import { he } from './he';
import { workbenchEn, workbenchHe } from './workbench';

export const recipes = defineMessages('recipes', { ...he, workbench: workbenchHe }, { ...en, workbench: workbenchEn });
