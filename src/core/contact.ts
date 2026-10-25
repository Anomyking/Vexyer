/** Where enquiries go. The static `mailto:` links in index.html must match (a test checks this). */
export const CONTACT_EMAIL = 'aiensleyshield@gmail.com';

export interface BriefFields {
  name: string;
  email: string;
  type: string;
  budget?: string;
  message: string;
}

/** Builds the mailto: link for the project brief form (subject + readable plain-text body). */
export function buildMailto(f: BriefFields, to: string = CONTACT_EMAIL): string {
  const clean = (s: string | undefined) => (s ?? '').replace(/\r\n?/g, '\n').trim();
  const name = clean(f.name);
  const subject = `New project enquiry: ${clean(f.type) || 'Website'}${name ? ` (${name})` : ''}`;
  const lines = [
    `Hi Aiensley,`,
    '',
    clean(f.message),
    '',
    '---',
    `Name: ${name}`,
    `Email: ${clean(f.email)}`,
    `Project: ${clean(f.type)}`,
  ];
  const budget = clean(f.budget);
  if (budget) lines.push(`Budget: ${budget}`);
  const body = lines.join('\n').replace(/\n/g, '\r\n');
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Minimal validity check used by the form (the browser's own validation is skipped via `novalidate`). */
export function validateBrief(f: BriefFields): Partial<Record<keyof BriefFields, string>> {
  const errors: Partial<Record<keyof BriefFields, string>> = {};
  if (!f.name.trim()) errors.name = 'Please add your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.email = 'Please enter a valid email address.';
  if (f.message.trim().length < 10) errors.message = 'Tell me a little about the project (a sentence or two is fine).';
  return errors;
}
