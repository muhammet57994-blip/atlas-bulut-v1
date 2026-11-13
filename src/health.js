// Read-only self-diagnosis. Reports configuration readiness, whether the live D1
// schema matches migrations/ and whether the approved free model is configured.
// Never returns record counts, record content, secrets or raw database error text.
import {reportError} from './log.js';
import {approvedModel} from './models.js';
import {telemetrySnapshot} from './telemetry.js';

// Migration ledger kept in code because the Worker cannot read migrations/ at
// runtime. test/health.test.js re-reads the SQL files and fails if a name or a
// created table drifts from this list.
export const MIGRATIONS = [
  {version: '0001', name: '0001_memory.sql', tables: ['atlas_memories']},
  {version: '0002', name: '0002_tasks.sql', tables: ['atlas_tasks']},
  {version: '0003', name: '0003_notes.sql', tables: ['atlas_notes']},
  {version: '0004', name: '0004_instagram.sql', tables: ['atlas_instagram_connection']},
  {version: '0005', name: '0005_instagram_oauth.sql', tables: ['atlas_instagram_oauth']},
  {version: '0006', name: '0006_organizer.sql', tables: ['atlas_task_completions', 'atlas_content_calendar', 'atlas_instagram_snapshots']},
  {version: '0007', name: '0007_plans.sql', tables: ['atlas_plans']},
  {version: '0008', name: '0008_routines.sql', tables: ['atlas_routines']},
  {version: '0009', name: '0009_daily_records.sql', tables: ['atlas_agenda', 'atlas_expenses']},
  {version: '0010', name: '0010_focus.sql', tables: ['atlas_focus_sessions']},
  {version: '0011', name: '0011_record_management.sql', tables: ['atlas_record_changes']},
  {version: '0012', name: '0012_named_lists.sql', tables: ['atlas_lists', 'atlas_list_changes']},
  {version: '0013', name: '0013_replan.sql', tables: ['atlas_replan_state', 'atlas_replan_receipts']},
  {version: '0014', name: '0014_bills.sql', tables: ['atlas_bills', 'atlas_bill_operations', 'atlas_bill_payments']},
  {version: '0015', name: '0015_offline.sql', tables: ['atlas_offline_receipts']},
  {version: '0016', name: '0016_budgets.sql', tables: ['atlas_budgets', 'atlas_budget_operations']},
  {version: '0017', name: '0017_waiting.sql', tables: ['atlas_waiting', 'atlas_waiting_operations']},
  {version: '0018', name: '0018_multi.sql', tables: ['atlas_multi_receipts']},
  // Retention migration: it only replaces delete triggers, so it creates no table.
  {version: '0019', name: '0019_retention.sql', tables: []},
  {version: '0020', name: '0020_session_epoch.sql', tables: ['atlas_settings']}
];

export const REQUIRED_TABLES = MIGRATIONS.flatMap(migration => migration.tables);
export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;
const REQUIRED_TABLE_SET = new Set(REQUIRED_TABLES);

function configurationReady(env) {
  return typeof env?.ATLAS_ACCESS_PASSWORD === 'string' && env.ATLAS_ACCESS_PASSWORD.length >= 20 &&
    typeof env?.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32 &&
    Boolean(env?.LOGIN_LIMIT) && Boolean(env?.CHAT_LIMIT);
}

// A migration counts as applied only when every table it creates exists. The
// applied version is the last one in an unbroken run; anything applied beyond a
// gap is reported separately as ahead, so drift is visible by name.
function migrationState(present) {
  const applied = MIGRATIONS.map(migration => migration.tables.every(table => present.has(table)));
  const gap = applied.indexOf(false);
  return {
    appliedVersion: gap === -1 ? SCHEMA_VERSION : gap === 0 ? '0000' : MIGRATIONS[gap - 1].version,
    applied: MIGRATIONS.filter((_, index) => applied[index]).map(migration => migration.name),
    missing: MIGRATIONS.filter((_, index) => !applied[index]).map(migration => migration.name),
    ahead: gap === -1 ? [] : MIGRATIONS.filter((_, index) => index > gap && applied[index]).map(migration => migration.name)
  };
}

// The version a database last applied in an unbroken run from the first file.
function unbrokenVersion(versions) {
  let version = '0000';
  for (const migration of MIGRATIONS) {
    if (!versions.has(migration.version)) break;
    version = migration.version;
  }
  return version;
}

// Wrangler keeps applied migrations in d1_migrations. Reading that ledger tells
// the real live version even when the answer only moves forward through ALTER
// statements, which leave no new table behind. Absent ledger means the database
// was built by executing the SQL files directly, so the caller falls back to the
// table-based run above.
async function appliedLedger(env) {
  const table = await env.MEMORY_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'").first();
  if (!table) return null;
  const rows = (await env.MEMORY_DB.prepare('SELECT name FROM d1_migrations').all()).results;
  const names = new Set((Array.isArray(rows) ? rows : []).map(row => row?.name).filter(name => typeof name === 'string'));
  return new Set(MIGRATIONS.filter(migration => names.has(migration.name)).map(migration => migration.version));
}

export async function healthSnapshot(env, {now = new Date(), requestId = ''} = {}) {
  const report = {
    service: 'atlas',
    version: 1,
    ready: configurationReady(env),
    model: {
      configured: typeof env?.GEMINI_API_KEY === 'string' && env.GEMINI_API_KEY.length > 0,
      approved: env?.GEMINI_MODEL === undefined || approvedModel(env.GEMINI_MODEL),
      // Per-isolate counters: quota replies and failures since the last cold start.
      stats: telemetrySnapshot()
    },
    schema: {
      version: null,
      appliedVersion: null,
      expectedVersion: SCHEMA_VERSION,
      upToDate: false,
      source: 'none',
      expected: REQUIRED_TABLES.length,
      applied: 0,
      missing: [...REQUIRED_TABLES],
      unexpected: [],
      migrations: {applied: [], missing: [], ahead: []}
    },
    db: {reachable: false, latencyMs: null},
    checkedAt: Number.isFinite(now.getTime()) ? now.toISOString() : null
  };
  if (env?.MEMORY_DB) {
    const started = Date.now();
    try {
      const rows = (await env.MEMORY_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'atlas_%'").all()).results;
      const present = new Set((Array.isArray(rows) ? rows : []).map(row => row?.name).filter(name => typeof name === 'string'));
      report.db = {reachable: true, latencyMs: Math.max(0, Date.now() - started)};
      const state = migrationState(present);
      let ledger = null;
      try { ledger = await appliedLedger(env); } catch { ledger = null; }
      const version = ledger ? unbrokenVersion(ledger) : state.appliedVersion;
      report.schema.version = version;
      report.schema.applied = REQUIRED_TABLES.filter(name => present.has(name)).length;
      report.schema.missing = REQUIRED_TABLES.filter(name => !present.has(name));
      report.schema.appliedVersion = version;
      report.schema.source = ledger ? 'd1_migrations' : 'tables';
      // A table the ledger never created means the database is ahead of this
      // code, so it is named rather than silently ignored.
      report.schema.unexpected = [...present].filter(name => !REQUIRED_TABLE_SET.has(name)).sort();
      report.schema.upToDate = version === SCHEMA_VERSION && report.schema.missing.length === 0 && report.schema.unexpected.length === 0;
      report.schema.migrations = {applied: state.applied, missing: state.missing, ahead: state.ahead};
    } catch (error) {
      // The diagnosis itself must not fail the request, and the driver message is
      // never returned. The table name is metadata only.
      reportError({stage: 'health.db', requestId, error, meta: {table: 'sqlite_master'}});
    }
  }
  const ok = report.ready && report.model.configured && report.model.approved && report.db.reachable && report.schema.upToDate;
  return {status: ok ? 200 : 503, payload: {ok, ...report}};
}
