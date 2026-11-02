function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomHex(length: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(length)));
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Same construction as the server: HMAC-SHA256 over the three parts joined by newlines. */
export async function hmacHex(
  secret: string,
  label: string,
  first: string,
  second: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    fromHex(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = new TextEncoder().encode(`${label}\n${first}\n${second}`);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, payload)));
}
