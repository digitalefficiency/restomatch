import { defineMessages, withReceiverLocales } from '../../translate';
import { en } from './en';
import { explainReceiver } from './explain.receiver';
import { he } from './he';

// Receiver languages (ar/ru/th/ti): the toggle labels + receiver-rendered concepts
// (./explain.receiver.ts); any other concept falls back to Hebrew.
export const explain = withReceiverLocales(defineMessages('explain', he, en), explainReceiver);
