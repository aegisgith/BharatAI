// The organising team in a test world (12 Nov 2026): who holds the Organiser pass,
// exhibitors with and without a Bharat AI owner from the booking sheet, enquiries,
// and the people who must NOT be on the team (a Visitor, an Organiser of another
// event). Laid on top of conference-world.mjs (0054 applied); adds migration 0050 for
// exhibitor_team_settings. Every name and address here is made up.
// Used by smoke-organiser-team.mjs, system-organiser-team.mjs and
// organiser-team-harness.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './conference-world.mjs';

export const TEAM = {
  ujwala: 'Ujwala Jangam', aswin: 'Aswin Kumar', puja: 'Puja Deka',
};

export function seedTeam(W) {
  const { db } = W;
  db.exec(readFileSync(join(ROOT, 'migrations', '0050_exhibitor_team.sql'), 'utf8'));
  db.run("INSERT OR IGNORE INTO events (id, title, venue, start_date, end_date, status) VALUES (2, 'Bharat AI Innovation Delhi 2027', 'Bharat Mandapam, New Delhi', '2027-07-28', '2027-07-29', 'upcoming')");
  const att = (id, name, email, badge, eventId = 1, extra = {}) => db.run(
    'INSERT INTO attendees (id, event_id, name, email, badge_type, role, payment_status, main_event, company) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
    [id, eventId, name, email, badge, extra.role || 'attendee', extra.pay || 'paid', extra.company || 'Bharat AI Innovation']);
  att(701, TEAM.ujwala, 'ujwala@team.example.test', 'Organiser', 1, { role: 'Organiser', pay: 'waived' });
  att(702, '  Aswin   Kumar ', 'Aswin@Team.Example.Test', 'Organiser', 1, { role: 'Organiser', pay: 'waived' });
  // The same name twice is one choice on a list.
  att(703, 'ujwala jangam', 'ujwala.second@team.example.test', 'Organiser', 1);
  // Not the team: a Visitor, and an Organiser of the Delhi edition.
  att(704, TEAM.puja, 'puja@team.example.test', 'Visitor Pass');
  att(705, 'Delhi Organiser', 'delhi@team.example.test', 'Organiser', 2);
  att(706, '<b>Bold</b> Name', 'bold@team.example.test', 'Visitor Pass');

  // Exhibitors: one the booking sheet gave to "Aswin Krishna Kumar" with his work
  // address, one the sheet gave to Ujwala, one with no row at all.
  db.run("INSERT INTO exhibitors (id, event_id, company_name, booth_number, contact_email) VALUES (51, 1, 'Harness Labs', '12', 'spoc@harness.example.test')");
  db.run("INSERT INTO exhibitors (id, event_id, company_name, booth_number, contact_email) VALUES (52, 1, 'Second Co', '14', 'spoc@second.example.test')");
  db.run("INSERT INTO exhibitors (id, event_id, company_name, booth_number, contact_email) VALUES (53, 1, 'Third Ltd', '15', 'spoc@third.example.test')");
  db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, passes, contact_name, owner_name, owner_email) VALUES (51, 3, 'Riya', 'Aswin Krishna Kumar', 'aswin.k@work.example.test')");
  db.run("INSERT INTO exhibitor_team_settings (exhibitor_id, contact_name, owner_name, owner_email) VALUES (52, 'Dev', 'Ujwala Jangam', 'ujwala.j@work.example.test')");
  // 53 has no settings row, but a dashboard account, so Teams & Passes lists it.
  db.run("INSERT INTO mp_companies (email, password_hash, company_name, exhibitor_id, role) VALUES ('spoc@third.example.test', 'x', 'Third Ltd', 53, 'company')");

  db.run("INSERT INTO inquiries (id, event_id, inquiry_type, name, email, subject, status) VALUES (901, 1, 'booth_inquiry', 'Asha Buyer', 'asha@buyer.example.test', 'A booth', 'new')");
  db.run("INSERT INTO inquiries (id, event_id, inquiry_type, name, email, subject, status, assigned_to) VALUES (902, 1, 'sponsorship', 'Ravi Sponsor', 'ravi@sponsor.example.test', 'Gold', 'new', 'Someone Else')");
}
