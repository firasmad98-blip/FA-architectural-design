-- FA Architectural Design · client portal database
-- Runs automatically every time the server starts. Every statement is safe to run again.

CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  role          text NOT NULL CHECK (role IN ('admin','client')),
  name          text NOT NULL,
  email         text NOT NULL,
  phone         text,
  password_hash text NOT NULL,
  lang          text NOT NULL DEFAULT 'en' CHECK (lang IN ('en','fr','ar')),
  active        boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS remember boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS projects (
  id             serial PRIMARY KEY,
  code           text,
  name           text NOT NULL,
  location       text,
  type           text,
  client_id      integer REFERENCES users(id) ON DELETE SET NULL,
  current_stage  integer NOT NULL DEFAULT 0,
  progress       integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  progress_note  text,
  handover_label text,
  contract_value numeric(14,2),
  currency       text NOT NULL DEFAULT 'USD',
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  cover_photo_id integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_client_idx ON projects (client_id);

CREATE TABLE IF NOT EXISTS project_stages (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  name       text NOT NULL,
  date_label text
);
CREATE INDEX IF NOT EXISTS project_stages_project_idx ON project_stages (project_id, position);

CREATE TABLE IF NOT EXISTS work_items (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      text NOT NULL,
  note       text,
  percent    integer NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  position   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  id            serial PRIMARY KEY,
  project_id    integer REFERENCES projects(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('document','photo','approval','message')),
  original_name text NOT NULL,
  stored_name   text NOT NULL,
  mime          text NOT NULL,
  size          integer NOT NULL,
  uploaded_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id    integer NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  title      text NOT NULL,
  category   text NOT NULL DEFAULT 'Drawings',
  version    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id    integer NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caption    text,
  taken_on   date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id             serial PRIMARY KEY,
  project_id     integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text,
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_date       date,
  file_id        integer REFERENCES files(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','changes')),
  chosen_option  text,
  client_comment text,
  decided_at     timestamptz,
  decided_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id  integer REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL DEFAULT '',
  file_id    integer REFERENCES files(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_project_idx ON messages (project_id, created_at);

CREATE TABLE IF NOT EXISTS project_reads (
  user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id       integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  messages_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      text NOT NULL,
  milestone  text,
  amount     numeric(14,2) NOT NULL DEFAULT 0,
  due_date   date,
  status     text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','due','paid')),
  paid_on    date,
  position   integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id integer REFERENCES projects(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  url        text NOT NULL DEFAULT '/portal/',
  read_at    timestamptz,
  pushed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS params jsonb;
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         serial PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text,
  auth       text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  contact      text,
  project_type text,
  location     text,
  budget       text,
  timeline     text,
  message      text,
  language     text,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
