// Norwegian organisation number validation (9 digits, modulus-11 check digit).

export function validateOrgnr(rawInput: string): { valid: boolean; normalized: string; reason?: string } {
  const digits = String(rawInput).replace(/\s+/g, '');
  if (!/^\d{9}$/.test(digits)) {
    return { valid: false, normalized: digits, reason: 'Organisation number must be exactly 9 digits.' };
  }
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * weights[i];
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;
  if (checkDigit === 10 || checkDigit !== Number(digits[8])) {
    return { valid: false, normalized: digits, reason: 'Check digit does not match (modulus-11).' };
  }
  return { valid: true, normalized: digits };
}
