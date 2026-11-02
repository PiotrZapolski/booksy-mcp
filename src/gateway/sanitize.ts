const SECRET_KEY = /(^|_)(access_?token|auth_?token|token|secret|password|api_?key|fingerprint)$/i;
/** Fields named for a contact detail, API names and the column labels of exported reports. */
const CONTACT_KEY =
  /(e[-_ ]?mail|phone|telefon|\btel\.?|mobile|msisdn|kom[oó]rk[ai])(_?(number|address)| klienta)?$/i;
/** Contact details inside free text, whatever the field. */
const EMAIL_IN_TEXT = /[\p{L}\d._%+-]+@[\p{L}\d-]+(\.[\p{L}\d-]+)+/gu;
const PHONE_IN_TEXT = /\+\d[\d\s()-]{6,}\d/g;

function maskContact(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskInText(value: string): string {
  return value.replace(EMAIL_IN_TEXT, maskContact).replace(PHONE_IN_TEXT, maskContact);
}

/** Removes credentials from any response, and contact details when the user asked for that. */
export function sanitize(value: unknown, options: { redactPii: boolean }): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, options));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        output[key] = '[redacted]';
      } else if (
        options.redactPii &&
        CONTACT_KEY.test(key) &&
        (typeof item === 'string' || typeof item === 'number')
      ) {
        output[key] = item === '' ? '' : maskContact(String(item));
      } else {
        output[key] = sanitize(item, options);
      }
    }
    return output;
  }
  if (options.redactPii && typeof value === 'string') return maskInText(value);
  return value;
}
