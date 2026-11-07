import {
  MUSEUM_LIMITS,
  cleanBlock,
  cleanLine,
} from '../../supabase/functions/_shared/validation.js';
import { t } from '../i18n.js';

/**
 * Client-side mirror of the required creator fields. The server validates
 * again; this only exists to give immediate, field-level feedback.
 */
export function validateCreatorDetails(details = {}, photoCount = 0) {
  const errors = [];
  const fields = {};

  const title = cleanLine(details.title, MUSEUM_LIMITS.maxTitleLength);
  const recipient = cleanLine(details.recipient, MUSEUM_LIMITS.maxNameLength);
  const dedication = cleanBlock(details.dedication, MUSEUM_LIMITS.maxDedicationLength);
  const finalMessage = cleanBlock(details.finalMessage, MUSEUM_LIMITS.maxFinalMessageLength);

  if (!title) fields.title = t('validation.title');
  if (!recipient) fields.recipient = t('validation.recipient');
  if (!finalMessage) fields.finalMessage = t('validation.finalMessage');

  const count = Number(photoCount) || 0;
  if (count < MUSEUM_LIMITS.minPhotos) {
    errors.push(t('validation.minPhotos', { count: MUSEUM_LIMITS.minPhotos }));
  } else if (count > MUSEUM_LIMITS.maxPhotos) {
    errors.push(t('validation.maxPhotos', { count: MUSEUM_LIMITS.maxPhotos }));
  }

  const ok = errors.length === 0 && Object.keys(fields).length === 0;

  return {
    ok,
    errors,
    fields,
    value: ok ? { title, recipient, dedication, finalMessage } : null,
  };
}
