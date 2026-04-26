PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- Module 1: Playbook Engine
-- ============================================================
CREATE TABLE playbooks (
  id                    INTEGER PRIMARY KEY,
  slug                  TEXT    UNIQUE NOT NULL,
  title                 TEXT    NOT NULL,
  scope                 TEXT    DEFAULT 'global',
  version               INTEGER DEFAULT 1,
  content               TEXT    NOT NULL,
  tags                  TEXT    DEFAULT '[]',
  is_active             INTEGER DEFAULT 1,
  last_applied_at       TEXT,
  effectiveness_score   REAL    DEFAULT 0,
  created_at            TEXT    DEFAULT (datetime('now')),
  updated_at            TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE playbook_versions (
  id          INTEGER PRIMARY KEY,
  playbook_id INTEGER NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT    NOT NULL,
  change_note TEXT,
  changed_at  TEXT    DEFAULT (datetime('now'))
);

-- ============================================================
-- Module 2: Task Log
-- ============================================================
CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY,
  title            TEXT    NOT NULL,
  description      TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','in_progress','hitl_wait','done','cancelled')),
  complexity       TEXT    NOT NULL DEFAULT 'standard'
                           CHECK(complexity IN ('trivial','standard','complex','critical')),
  project          TEXT,
  ai_context       TEXT    DEFAULT '{}',
  hitl_required    INTEGER DEFAULT 0,
  hitl_approved_at TEXT,
  hitl_trigger     TEXT,
  verification_id  INTEGER,
  tags             TEXT    DEFAULT '[]',
  created_at       TEXT    DEFAULT (datetime('now')),
  updated_at       TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE task_steps (
  id            INTEGER PRIMARY KEY,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_no       INTEGER NOT NULL,
  prompt        TEXT,
  response      TEXT,
  model         TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL    DEFAULT 0,
  latency_ms    INTEGER DEFAULT 0,
  tool_calls    TEXT    DEFAULT '[]',
  verified      INTEGER DEFAULT 0,
  created_at    TEXT    DEFAULT (datetime('now'))
);

-- ============================================================
-- Module 3: Knowledge Store (3+2 layers)
-- ============================================================
CREATE TABLE knowledge_items (
  id                 INTEGER PRIMARY KEY,
  layer              TEXT    NOT NULL
                             CHECK(layer IN ('global','project','incident','ephemeral','candidate')),
  title              TEXT    NOT NULL,
  content            TEXT    NOT NULL,
  project            TEXT,
  domain             TEXT,
  source_incident_id INTEGER,
  relevance_score    REAL    DEFAULT 0,
  applied_count      INTEGER DEFAULT 0,
  is_active          INTEGER DEFAULT 1,
  tags               TEXT    DEFAULT '[]',
  created_at         TEXT    DEFAULT (datetime('now')),
  updated_at         TEXT    DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title,
  content,
  tags,
  content=knowledge_items,
  content_rowid=id,
  tokenize="trigram"
);

CREATE TRIGGER knowledge_fts_insert AFTER INSERT ON knowledge_items BEGIN
  INSERT INTO knowledge_fts(rowid, title, content, tags)
    VALUES (new.id, new.title, new.content, new.tags);
END;

CREATE TRIGGER knowledge_fts_update AFTER UPDATE ON knowledge_items BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
    VALUES ('delete', old.id, old.title, old.content, old.tags);
  INSERT INTO knowledge_fts(rowid, title, content, tags)
    VALUES (new.id, new.title, new.content, new.tags);
END;

CREATE TRIGGER knowledge_fts_delete AFTER DELETE ON knowledge_items BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
    VALUES ('delete', old.id, old.title, old.content, old.tags);
END;

-- ============================================================
-- Module 4: Verify Engine
-- ============================================================
CREATE TABLE verifications (
  id              INTEGER PRIMARY KEY,
  task_id         INTEGER REFERENCES tasks(id),
  complexity      TEXT    NOT NULL,
  mode            TEXT    NOT NULL CHECK(mode IN ('skip','single','peer','da_loop')),
  model_reviewer  TEXT,
  verdict         TEXT    CHECK(verdict IN ('pass','fail','partial',NULL)),
  confidence      REAL,
  findings        TEXT    DEFAULT '[]',
  hitl_escalated  INTEGER DEFAULT 0,
  created_at      TEXT    DEFAULT (datetime('now'))
);

-- ============================================================
-- Module 5: Audit Trail (SHA-256 hash chain)
-- ============================================================
CREATE TABLE audit_events (
  id            INTEGER PRIMARY KEY,
  -- 64 zero hex digits: chain sentinel for the first row.
  -- MUST match GENESIS_HASH in packages/core/src/audit/chain.ts.
  -- SQL cannot import the TS constant; future v0.2 work proposes a
  -- schema_metadata table with assertGenesisHash() to make this verifiable
  -- at startup (final.txt H5중기).
  prev_hash     TEXT    NOT NULL DEFAULT ('0000000000000000000000000000000000000000000000000000000000000000'),
  content_hash  TEXT    NOT NULL,
  chain_hash    TEXT    NOT NULL,
  event_type    TEXT    NOT NULL,
  actor         TEXT    NOT NULL DEFAULT 'ai',
  actor_model   TEXT,
  task_id       INTEGER,
  resource_type TEXT,
  resource_id   TEXT,
  action        TEXT    NOT NULL,
  payload       TEXT    NOT NULL DEFAULT '{}',
  ip_addr       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Module 6: Incident Registry (후보 큐 포함)
-- ============================================================
CREATE TABLE incidents (
  id              INTEGER PRIMARY KEY,
  title           TEXT    NOT NULL,
  severity        TEXT    NOT NULL DEFAULT 'medium'
                          CHECK(severity IN ('low','medium','high','critical')),
  ai_service      TEXT,
  task_id         INTEGER REFERENCES tasks(id),
  playbook_id     INTEGER REFERENCES playbooks(id),
  description     TEXT    NOT NULL,
  root_cause      TEXT,
  resolution      TEXT,
  prevention_rule TEXT,
  status          TEXT    NOT NULL DEFAULT 'open'
                          CHECK(status IN ('open','resolved','wont_fix')),
  pattern_hash    TEXT,
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE incident_patterns (
  id                INTEGER PRIMARY KEY,
  pattern_hash      TEXT    UNIQUE NOT NULL,
  pattern_summary   TEXT    NOT NULL,
  occurrence_count  INTEGER DEFAULT 1,
  promotion_status  TEXT    NOT NULL DEFAULT 'watching'
                            CHECK(promotion_status IN ('watching','candidate','promoted','rejected')),
  human_approved    INTEGER DEFAULT 0,
  promoted_at       TEXT,
  last_seen_at      TEXT    DEFAULT (datetime('now'))
);

-- ============================================================
-- Module 7: OTel Tracer (gen_ai.* adapter layer)
-- ============================================================
CREATE TABLE traces (
  id                              INTEGER PRIMARY KEY,
  trace_id                        TEXT    NOT NULL,
  span_id                         TEXT,
  task_id                         INTEGER REFERENCES tasks(id),
  operation                       TEXT,
  model                           TEXT,
  provider                        TEXT,
  input_tokens                    INTEGER DEFAULT 0,
  output_tokens                   INTEGER DEFAULT 0,
  cost_usd                        REAL    DEFAULT 0,
  latency_ms                      INTEGER DEFAULT 0,
  gen_ai_system                   TEXT,
  gen_ai_operation_name           TEXT,
  gen_ai_request_model            TEXT,
  gen_ai_response_finish_reason   TEXT,
  span_data                       TEXT    DEFAULT '{}',
  created_at                      TEXT    DEFAULT (datetime('now'))
);

-- ============================================================
-- Module 8: Action Policy Engine
-- ============================================================
CREATE TABLE policies (
  id          INTEGER PRIMARY KEY,
  tool_name   TEXT    NOT NULL,
  resource    TEXT    NOT NULL DEFAULT '*',
  action_type TEXT    NOT NULL CHECK(action_type IN ('read','write','execute','delete')),
  effect      TEXT    NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  rate_limit  INTEGER,
  conditions  TEXT    NOT NULL DEFAULT '{}',
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE policy_evaluations (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER REFERENCES tasks(id),
  tool_name   TEXT    NOT NULL,
  action_type TEXT    NOT NULL,
  policy_id   INTEGER REFERENCES policies(id),
  result      TEXT    NOT NULL CHECK(result IN ('allow','deny','rate_limited')),
  evaluated_at TEXT   DEFAULT (datetime('now'))
);

-- ============================================================
-- 인덱스
-- ============================================================
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_project ON tasks(project);
CREATE INDEX idx_tasks_complexity ON tasks(complexity);
CREATE INDEX idx_task_steps_task ON task_steps(task_id);
CREATE INDEX idx_knowledge_layer ON knowledge_items(layer, is_active);
CREATE INDEX idx_knowledge_project ON knowledge_items(project);
CREATE INDEX idx_audit_task ON audit_events(task_id);
CREATE INDEX idx_audit_created ON audit_events(created_at);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_pattern ON incidents(pattern_hash);
CREATE INDEX idx_patterns_status ON incident_patterns(promotion_status);
CREATE INDEX idx_traces_task ON traces(task_id);
CREATE INDEX idx_traces_model ON traces(model, created_at);
CREATE INDEX idx_policies_tool ON policies(tool_name, is_active);
