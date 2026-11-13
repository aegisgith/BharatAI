// ==================== WHO AN EMAIL IS SENT FROM (13 Nov 2026) ====================
//
// The organiser asked: "can we give option to select email from which it will be
// delivered other than the default email like email id of organising teams".
//
// So an admin email may go out as one of the organising team instead of the event's
// own address (register@). The rules:
//   - The team is whoever holds the Organiser pass for the event (organiserTeam()).
//   - Only an address on our own domain can be the sender. Elastic Email has the
//     DOMAIN bharataiinnovation.com verified, so any address on it sends; an address
//     on another domain (Gmail, a company) would be refused or land in spam, and
//     sending as someone's outside mailbox is not ours to do. A team member with an
//     outside address is listed apart, with the reason, so the screen can say why.
//   - A sender is picked from this list by address. Anything else (a typed address, a
//     forged request) is refused, never quietly replaced.
//   - The default is the event's own sender, exactly as before, so every existing
//     email is unchanged unless someone picks a person.
// Replies go to the sender's address, so the person picked must have a real mailbox
// there (the old delegates@ sender had none, and every reply bounced).

import { organiserTeam, type TeamMember } from './team'

export const SENDER_DOMAIN = 'bharataiinnovation.com'
export const BRAND_SHORT = 'Bharat AI Innovation'

export type Sender = { email: string; name: string; default: boolean; person: string }
export type Outside = { name: string; email: string; reason: string }

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

export function cleanAddress(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

export function onOurDomain(email: unknown): boolean {
  const e = cleanAddress(email)
  return EMAIL_RE.test(e) && e.endsWith('@' + SENDER_DOMAIN)
}

// A display name safe inside a From header: no quotes, angle brackets, backslashes
// or line breaks, one space between words, 70 characters at most.
export function headerName(v: unknown): string {
  return String(v ?? '').replace(/["<>\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)
}

// "Anita Ram, Bharat AI Innovation": the inbox shows who wrote and for which event.
export function personSenderName(name: string): string {
  return headerName(name + ', ' + BRAND_SHORT)
}

// The From header. Always quoted, so a comma or a "Dr." in the name cannot split it.
export function fromHeader(s: { email: string; name: string }): string {
  const n = headerName(s.name)
  return n ? `"${n}" <${cleanAddress(s.email)}>` : cleanAddress(s.email)
}

// What sendAdminEmail puts on the envelope. No `from`, or the event's own address:
// exactly as before. A team member: their From, and a blind copy to the event's own
// address so everything sent in a person's name is on record in one place (never a
// copy when the email is to that address anyway). An address off our domain: refused.
export function sendAs(own: { email: string; name: string }, from: { email: string; name: string } | null | undefined, to: string):
    { ok: true; from: string; bcc: string[] } | { ok: false; error: string } {
  const ownEmail = cleanAddress(own.email)
  if (!from || !cleanAddress(from.email) || cleanAddress(from.email) === ownEmail) return { ok: true, from: `${own.name} <${ownEmail}>`, bcc: [] }
  if (!onOurDomain(from.email)) return { ok: false, error: 'Emails can only be sent from an @' + SENDER_DOMAIN + ' address.' }
  return { ok: true, from: fromHeader(from), bcc: cleanAddress(to) === ownEmail ? [] : [ownEmail] }
}

// The list, pure: the event's own sender first, then each team member on our domain
// (by name, once per address); team members on another domain go to `outside`.
export function senderList(def: { email: string; name: string }, team: TeamMember[]): { senders: Sender[]; outside: Outside[] } {
  const own = cleanAddress(def.email)
  const senders: Sender[] = [{ email: own, name: headerName(def.name), default: true, person: '' }]
  const outside: Outside[] = []
  const seen = new Set<string>([own])
  for (const m of team) {
    const email = cleanAddress(m.email)
    if (!email) { outside.push({ name: m.name, email: '', reason: 'No email address on their pass.' }); continue }
    if (!onOurDomain(email)) { outside.push({ name: m.name, email, reason: 'Not an @' + SENDER_DOMAIN + ' address, so emails cannot be sent as them.' }); continue }
    if (seen.has(email)) continue
    seen.add(email)
    senders.push({ email, name: personSenderName(m.name), default: false, person: m.name })
  }
  return { senders, outside }
}

// '' (or nothing) means the default. Any other address must be on the list.
export function pickFrom(senders: Sender[], email: unknown): Sender | null {
  const e = cleanAddress(email)
  if (!e) return senders.find(s => s.default) || null
  return senders.find(s => s.email === e) || null
}

export async function sendersFor(db: any, eventId: number, def: { email: string; name: string }) {
  return senderList(def, await organiserTeam(db, eventId))
}

export async function pickSender(db: any, eventId: number, def: { email: string; name: string }, email: unknown): Promise<Sender | null> {
  if (!cleanAddress(email)) return pickFrom(senderList(def, []).senders, '')
  return pickFrom((await sendersFor(db, eventId, def)).senders, email)
}
