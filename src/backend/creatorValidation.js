import {
  MUSEUM_LIMITS,
  cleanBlock,
  cleanLine,
} from '../../supabase/functions/_shared/validation.js';

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

  if (!title) fields.title = 'Add a museum title.';
  if (!recipient) fields.recipient = "Add the recipient's name.";
  if (!finalMessage) fields.finalMessage = 'Add a closing message.';

  const count = Number(photoCount) || 0;
  if (count < MUSEUM_LIMITS.minPhotos) {
    errors.push(`Add at least ${MUSEUM_LIMITS.minPhotos} photographs.`);
  } else if (count > MUSEUM_LIMITS.maxPhotos) {
    errors.push(`A museum can hold at most ${MUSEUM_LIMITS.maxPhotos} photographs.`);
  }

  const ok = errors.length === 0 && Object.keys(fields).length === 0;

  return {
    ok,
    errors,
    fields,
    value: ok ? { title, recipient, dedication, finalMessage } : null,
  };
}
