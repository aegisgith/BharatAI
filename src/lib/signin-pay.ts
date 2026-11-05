// Which sign-in emails carry on to payment (5 Nov 2026).
//
// The /register paid form, and the app's sign-in box when it was opened for paying,
// ask for a sign-in email "for" a pass. Only these exact words pass, because the key
// goes into the emailed link and the name into its subject and text. Anything else
// gets the plain sign-in email, word for word as before.
const PASS_BY_KEY = new Map<string, string>([
  ['delegate', 'Delegate Pass'],
  ['premium', 'Premium Delegate Pass'],
  ['vip', 'VIP Pass'],
  ['academic', 'Academic Pass'],
])

export function signinPayIntent(nextAction: unknown, pass: unknown): { key: string; name: string } {
  if (nextAction !== 'pay' || typeof pass !== 'string') return { key: '', name: '' }
  const key = pass.toLowerCase()
  const name = PASS_BY_KEY.get(key)
  return name ? { key, name } : { key: '', name: '' }
}
