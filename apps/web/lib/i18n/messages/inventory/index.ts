import { defineMessages } from '../../translate';
import { controlRoomEn, controlRoomHe } from './controlRoom';
import { en } from './en';
import { he } from './he';

export const inventory = defineMessages('inventory', { ...he, controlRoom: controlRoomHe }, { ...en, controlRoom: controlRoomEn });
