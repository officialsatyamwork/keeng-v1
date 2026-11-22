export function passwordError(value) {
  if (!value || value.length < 8) return 'Use at least 8 characters'
  if (!/[A-Z]/.test(value)) return 'Include one capital letter'
  if (!/[a-z]/.test(value)) return 'Include one small letter'
  if (!/\d/.test(value)) return 'Include one number'
  if (!/[^A-Za-z0-9]/.test(value)) return 'Include one special character'
  return ''
}

export const PASSWORD_HINT = '8 or more characters, with a capital letter, a small letter, a number, and a special character.'
