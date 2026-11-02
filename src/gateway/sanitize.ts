const SECRET_KEY = /(^|_)(access_?token|auth_?token|token|secret|password|api_?key|fingerprint)$/i;
const CONTACT_KEY = /^(cell_phone|phone|phone_number|mobile|email|e_mail|buyer_customer_email)$/i;

function maskContact(value: string): string {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

/** Removes credentials from any response, and contact details when the user asked for that. */
export function sanitize(value: unknown, options: { maskContacts: boolean }): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, options));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        output[key] = '[redacted]';
      } else if (options.maskContacts && CONTACT_KEY.test(key) && typeof item === 'string') {
        output[key] = maskContact(item);
      } else {
        output[key] = sanitize(item, options);
      }
    }
    return output;
  }
  return value;
}
