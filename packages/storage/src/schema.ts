export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "normalized-core-and-agent-runtime",
    sql: `
      CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('character','ensemble','scenario','world')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        legacy_payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'participant',
        profile_json TEXT NOT NULL DEFAULT '{}',
        legacy_payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX participants_card_idx ON participants(card_id);

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE conversation_participants (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, participant_id)
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
        participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

      CREATE TABLE swipes (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        content TEXT NOT NULL,
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (message_id, position)
      );

      CREATE TABLE worldbooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent_editable INTEGER NOT NULL DEFAULT 0 CHECK (agent_editable IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1,
        legacy_payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE worldbook_entries (
        id TEXT PRIMARY KEY,
        worldbook_id TEXT NOT NULL REFERENCES worldbooks(id) ON DELETE CASCADE,
        legacy_uid INTEGER,
        keys_json TEXT NOT NULL DEFAULT '[]',
        content TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        position INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX worldbook_entries_book_idx
        ON worldbook_entries(worldbook_id, enabled, position);

      CREATE TABLE worldbook_bindings (
        id TEXT PRIMARY KEY,
        worldbook_id TEXT NOT NULL REFERENCES worldbooks(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('global','card','conversation','participant','persona')),
        scope_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (worldbook_id, scope_type, scope_id)
      );

      CREATE TABLE presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        legacy_payload_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX artifacts_scope_idx ON artifacts(kind, scope_type, scope_id, updated_at);

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_confirmation','completed','failed','cancelled')),
        requested_by TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running','awaiting_confirmation','succeeded','failed')),
        result_json TEXT,
        error_json TEXT,
        requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (requires_confirmation IN (0,1)),
        confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, idempotency_key)
      );

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human','agent','legacy_script','system')),
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        inverse_patch_json TEXT NOT NULL,
        undone_at TEXT,
        undo_audit_id TEXT REFERENCES audit_log(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_resource_idx ON audit_log(resource_type, resource_id, created_at);
      CREATE INDEX audit_run_idx ON audit_log(run_id, created_at);

      CREATE TABLE extension_settings (
        extension_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (extension_id, key)
      );
    `,
  },
  {
    version: 2,
    name: "agent-runtime-state-and-policy",
    sql: `
      ALTER TABLE agent_runs RENAME TO agent_runs_v1;

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (
          status IN ('queued','running','waiting_confirmation','completed','failed','cancelled')
        ),
        requested_by TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        max_steps INTEGER NOT NULL DEFAULT 8 CHECK (max_steps BETWEEN 1 AND 32),
        current_step INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
        tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count >= 0),
        write_call_count INTEGER NOT NULL DEFAULT 0 CHECK (write_call_count >= 0),
        idempotency_key TEXT NOT NULL,
        cancelled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (requested_by, idempotency_key)
      );

      INSERT INTO agent_runs(
        id, conversation_id, status, requested_by, provider, model,
        objective, max_steps, current_step, tool_call_count, write_call_count,
        idempotency_key, cancelled_at, created_at, updated_at
      )
      SELECT
        id, conversation_id, status, requested_by, provider, model,
        '', 8, 0, 0, 0, id, cancelled_at, created_at, updated_at
      FROM agent_runs_v1;

      ALTER TABLE tool_calls RENAME TO tool_calls_v1;

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'proposed','awaiting_confirmation','running','succeeded',
            'rejected','cancelled','failed'
          )
        ),
        result_json TEXT,
        error_json TEXT,
        effect TEXT NOT NULL DEFAULT 'read'
          CHECK (effect IN ('read','write','destructive')),
        requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (requires_confirmation IN (0,1)),
        confirmed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, idempotency_key)
      );

      INSERT INTO tool_calls(
        id, run_id, idempotency_key, tool_name, arguments_json, status,
        result_json, error_json, effect, requires_confirmation, confirmed_at,
        created_at, updated_at
      )
      SELECT
        id, run_id, idempotency_key, tool_name, arguments_json, status,
        result_json, error_json, 'read', requires_confirmation, confirmed_at,
        created_at, updated_at
      FROM tool_calls_v1;

      ALTER TABLE audit_log RENAME TO audit_log_v1;
      DROP INDEX audit_resource_idx;
      DROP INDEX audit_run_idx;

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human','agent','legacy_script','system')),
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        inverse_patch_json TEXT NOT NULL,
        undone_at TEXT,
        undo_audit_id TEXT REFERENCES audit_log(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO audit_log(
        id, run_id, tool_call_id, actor_kind, actor_id, action,
        resource_type, resource_id, before_json, after_json,
        inverse_patch_json, undone_at, undo_audit_id, created_at
      )
      SELECT
        id, run_id, tool_call_id, actor_kind, actor_id, action,
        resource_type, resource_id, before_json, after_json,
        inverse_patch_json, undone_at, undo_audit_id, created_at
      FROM audit_log_v1;

      DROP TABLE audit_log_v1;
      DROP TABLE tool_calls_v1;
      DROP TABLE agent_runs_v1;

      ALTER TABLE worldbooks ADD COLUMN permission_updated_by TEXT;
      ALTER TABLE worldbooks ADD COLUMN permission_updated_at TEXT;
      ALTER TABLE worldbooks ADD COLUMN agent_write_mode TEXT NOT NULL DEFAULT 'confirm'
        CHECK (agent_write_mode IN ('confirm','auto-create-update'));

      ALTER TABLE artifacts ADD COLUMN source_from_message_id TEXT;
      ALTER TABLE artifacts ADD COLUMN source_to_message_id TEXT;
      ALTER TABLE artifacts ADD COLUMN stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1));
      ALTER TABLE artifacts ADD COLUMN locked_fields_json TEXT NOT NULL DEFAULT '[]';

      CREATE INDEX agent_runs_conversation_idx
        ON agent_runs(conversation_id, created_at);
      CREATE INDEX tool_calls_run_idx
        ON tool_calls(run_id, created_at);
      CREATE INDEX audit_resource_idx
        ON audit_log(resource_type, resource_id, created_at);
      CREATE INDEX audit_run_idx
        ON audit_log(run_id, created_at);
    `,
  },
  {
    version: 3,
    name: "card-revisions-and-provider-connections",
    sql: `
      ALTER TABLE cards ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE provider_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (
          protocol IN ('openai-compatible','text-completion','fake')
        ),
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        headers_json TEXT NOT NULL DEFAULT '{}',
        api_key_ref TEXT,
        native_tool_calling INTEGER NOT NULL DEFAULT 0 CHECK (native_tool_calling IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    name: "legacy-extension-capability-grants",
    sql: `
      CREATE TABLE legacy_capability_grants (
        plugin_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0,1)),
        granted_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plugin_id, capability)
      );
    `,
  },
  {
    version: 5,
    name: "separate-legacy-actors",
    sql: `
      ALTER TABLE legacy_capability_grants
        RENAME TO legacy_capability_grants_v4;

      CREATE TABLE legacy_capability_grants (
        plugin_id TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('legacy-plugin','embedded-script')),
        capability TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0,1)),
        granted_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plugin_id, actor, capability)
      );

      INSERT INTO legacy_capability_grants(
        plugin_id, actor, capability, granted, granted_by, updated_at
      )
      SELECT
        plugin_id, 'legacy-plugin', capability, granted, granted_by, updated_at
      FROM legacy_capability_grants_v4;

      DROP TABLE legacy_capability_grants_v4;
    `,
  },
  {
    version: 6,
    name: "binary-chat-message-roles",
    sql: `
      CREATE TABLE messages_v6 (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_message_id TEXT REFERENCES messages_v6(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
        participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (role = 'assistant' OR participant_id IS NULL)
      );

      INSERT INTO messages_v6(
        id, conversation_id, parent_message_id, role, participant_id, content,
        revision, created_at, updated_at
      )
      SELECT
        id,
        conversation_id,
        parent_message_id,
        CASE role WHEN 'narrator' THEN 'assistant' ELSE role END,
        CASE
          WHEN role IN ('assistant', 'narrator') THEN participant_id
          ELSE NULL
        END,
        content,
        revision,
        created_at,
        updated_at
      FROM messages
      ORDER BY rowid;

      CREATE TABLE swipes_v6 (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages_v6(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        content TEXT NOT NULL,
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (message_id, position)
      );

      INSERT INTO swipes_v6(
        id, message_id, position, content, selected, revision, created_at, updated_at
      )
      SELECT
        id, message_id, position, content, selected, revision, created_at, updated_at
      FROM swipes
      ORDER BY rowid;

      DROP TABLE swipes;
      DROP TABLE messages;
      ALTER TABLE messages_v6 RENAME TO messages;
      ALTER TABLE swipes_v6 RENAME TO swipes;

      CREATE INDEX messages_conversation_idx
        ON messages(conversation_id, created_at);
    `,
  },
  {
    version: 7,
    name: "worldbook-entry-agent-permissions",
    sql: `
      ALTER TABLE worldbook_entries
        ADD COLUMN agent_editable INTEGER NOT NULL DEFAULT 0
          CHECK (agent_editable IN (0,1));
      ALTER TABLE worldbook_entries
        ADD COLUMN permission_updated_by TEXT;
      ALTER TABLE worldbook_entries
        ADD COLUMN permission_updated_at TEXT;
    `,
  },
  {
    version: 8,
    name: "card-bound-conversations",
    sql: `
      CREATE TABLE conversation_card_invariant_guard (
        valid INTEGER NOT NULL CHECK (valid = 1)
      );

      INSERT INTO conversation_card_invariant_guard(valid)
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM conversations WHERE card_id IS NULL
        ) THEN 0
        ELSE 1
      END;

      DROP TABLE conversation_card_invariant_guard;

      CREATE TRIGGER conversations_card_required_insert
      BEFORE INSERT ON conversations
      WHEN NEW.card_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'conversation card_id is required');
      END;

      CREATE TRIGGER conversations_card_required_update
      BEFORE UPDATE OF card_id ON conversations
      WHEN NEW.card_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'conversation card_id is required');
      END;

      CREATE INDEX conversations_card_updated_idx
        ON conversations(card_id, updated_at DESC, id);
    `,
  },
  {
    version: 9,
    name: "user-personas-and-conversation-binding",
    sql: `
      CREATE TABLE personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX personas_default_idx
        ON personas(is_default)
        WHERE is_default = 1;

      ALTER TABLE conversations
        ADD COLUMN persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL;
      CREATE INDEX conversations_persona_idx
        ON conversations(persona_id, updated_at DESC, id);
    `,
  },
];
