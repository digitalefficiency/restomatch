import { defineMessages } from '../../translate';
import { controlRoomEn, controlRoomHe } from './controlRoom';
import { en } from './en';
import { priceWhyEn, priceWhyHe } from './priceWhy';
import { he } from './he';

export const inventory = defineMessages(
  'inventory',
  { ...he, controlRoom: controlRoomHe, priceWhy: priceWhyHe },
  { ...en, controlRoom: controlRoomEn, priceWhy: priceWhyEn },
);
