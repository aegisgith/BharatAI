// ==================== THE ORGANISING TEAM (12 Nov 2026) ====================
//
// The organiser named the team on 12 Nov 2026 and asked for two things: each of them
// holds the Organiser pass, and each may own enquiries, exhibitors, speakers and panel
// discussions (the person who looks after them).
//
// So the team is read from the passes: give someone the Organiser pass in Admin and
// they are on every owner list; take it away and they leave the lists. Whatever they
// already own stays in their name, as a typed name would, until someone changes it.
//
// Where each owner is kept:
//   enquiry     inquiries.assigned_to                    (0027, the Inquiries desk)
//   exhibitor   exhibitor_team_settings.owner_name/email (0050, Teams & Passes)
//   speaker     app_settings row owner:speaker:<id>      (here)
//   session     app_settings row owner:session:<id>      (here)
// The last two are rows in app_settings, the way panel mail jobs are kept
// (mail_job:<kind>:<slug>), so they work the day this deploys with no migration.
// The value is JSON: { name, email }, the email being the team member's own when the
// name is on the team.

export const ORGANISER_BADGE = 'Organiser'
export const OWNER_KINDS = ['session', 'speaker'] as const
export type OwnerKind = typeof OWNER_KINDS[number]
export type TeamMember = { id: number; name: string; email: string }
export type Owner = { name: string; email: string }

export const isOwnerKind = (v: unknown): v is OwnerKind => (OWNER_KINDS as readonly string[]).includes(String(v))

// A name as an owner list shows it: one space between words, 80 characters at most
// (the width inquiries.assigned_to has always been cut to).
export function cleanOwnerName(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

// Everyone holding the Organiser pass for the event, by name. A name held twice is
// listed once: an owner is a name, so two rows with it are one choice.
export async function organiserTeam(db: any, eventId = 1): Promise<TeamMember[]> {
  try {
    const { results } = await db.prepare(
      'SELECT id, name, email FROM attendees WHERE event_id = ? AND badge_type = ? ORDER BY name COLLATE NOCASE, id'
    ).bind(eventId, ORGANISER_BADGE).all()
    const seen = new Set<string>()
    const out: TeamMember[] = []
    for (const r of (results || []) as any[]) {
      const name = cleanOwnerName(r.name)
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      out.push({ id: Number(r.id), name, email: String(r.email || '').trim().toLowerCase() })
    }
    return out
  } catch { return [] }
}

export function teamMemberNamed(team: TeamMember[], name: string): TeamMember | null {
  const n = cleanOwnerName(name).toLowerCase()
  return (n && team.find(m => m.name.toLowerCase() === n)) || null
}

const ownerKey = (kind: OwnerKind, id: number) => 'owner:' + kind + ':' + id

function parseOwner(v: unknown): Owner | null {
  try {
    const o = JSON.parse(String(v || ''))
    const name = cleanOwnerName(o && o.name)
    return name ? { name, email: String((o && o.email) || '').trim().toLowerCase() } : null
  } catch { return null }
}

// Every owner of one kind, by id. One read for the whole screen.
export async function ownersOf(db: any, kind: OwnerKind): Promise<Map<number, Owner>> {
  const out = new Map<number, Owner>()
  try {
    const { results } = await db.prepare('SELECT key, value FROM app_settings WHERE key LIKE ?').bind('owner:' + kind + ':%').all()
    for (const r of (results || []) as any[]) {
      const id = Number(String(r.key).slice(('owner:' + kind + ':').length))
      const o = parseOwner(r.value)
      if (Number.isInteger(id) && id > 0 && o) out.set(id, o)
    }
  } catch { /* no app_settings: nobody owns anything yet */ }
  return out
}

export async function ownerOf(db: any, kind: OwnerKind, id: number): Promise<Owner | null> {
  try {
    const r = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(ownerKey(kind, id)).first()
    return r ? parseOwner(r.value) : null
  } catch { return null }
}

// Gives one speaker or session to a person, or to nobody when the name is empty.
// Answers what it was and what it is now, for the audit log; changed is false when
// the same name was given again.
export async function setOwner(db: any, kind: OwnerKind, id: number, name: unknown, team: TeamMember[]):
  Promise<{ before: Owner | null; after: Owner | null; changed: boolean }> {
  const before = await ownerOf(db, kind, id)
  const clean = cleanOwnerName(name)
  if (!clean) {
    if (before) await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(ownerKey(kind, id)).run()
    return { before, after: null, changed: !!before }
  }
  const member = teamMemberNamed(team, clean)
  const after: Owner = { name: member ? member.name : clean, email: member ? member.email : '' }
  if (before && before.name === after.name && before.email === after.email) return { before, after, changed: false }
  await db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(ownerKey(kind, id), JSON.stringify(after)).run()
  return { before, after, changed: true }
}

// A deleted speaker or session leaves no owner row behind.
export async function clearOwner(db: any, kind: OwnerKind, id: number): Promise<void> {
  try { await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(ownerKey(kind, id)).run() } catch { /* nothing to clear */ }
}
