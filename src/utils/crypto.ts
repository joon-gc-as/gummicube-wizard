import { randomBytes } from 'node:crypto';

export function generateHex(bytesLength: number = 16): string {
  return randomBytes(bytesLength).toString('hex');
}
