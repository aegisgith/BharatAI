-- Schema behind the admin gaps closed in this change.
--
-- 1. admin_audit: who changed what. The panel is opened with one shared password,
--    so until there are per-operator logins the actor is partly self-declared -
--    the panel sends the name the operator typed once. The IP and user agent are
--    not self-declared, and together they make a delete traceable. Recording
--    something attributable beats recording nothing.
--
-- 2. inquiries.assigned_to / responded_at: 274 inquiries with no owner and no
--    notion of how long one has been waiting. Both are needed before the list
--    can be worked rather than just read.
--
-- Additive only. No existing column or row is touched.

CREATE TABLE IF NOT EXISTS admin_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT    NOT NULL DEFAULT 'unknown',
  actor_kind  TEXT    NOT NULL DEFAULT 'admin',
  action      TEXT    NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- The viewer reads newest first, and filters by entity when drilling in.
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity  ON admin_audit(entity, entity_id);

ALTER TABLE inquiries ADD COLUMN assigned_to  TEXT;
ALTER TABLE inquiries ADD COLUMN responded_at TEXT;
