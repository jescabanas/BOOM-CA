'use strict';

// Checks only the disposable local restore. Does not connect to Supabase.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = 'C:/Users/Marc/Downloads/DILG Recovery Backup';
const database = path.join(root, 'Database');
const expected = new Map();
for (const name of ['data.sql', 'migration-history.sql']) {
  let table = null;
  for (const line of fs.readFileSync(path.join(database, name), 'utf8').split(/\r?\n/)) {
    const match = /^COPY "([a-z_]+)"\."([a-z_]+)" \(.+\) FROM stdin;$/.exec(line);
    if (match) {
      table = `${match[1]}.${match[2]}`;
      assert(!expected.has(table), 'Duplicate exported table');
      expected.set(table, 0);
    } else if (line === '\\.') {
      table = null;
    } else if (table) {
      expected.set(table, expected.get(table) + 1);
    }
  }
  assert.equal(table, null, 'Unterminated COPY export');
}
assert(expected.size > 0, 'No exported tables');
if (process.argv.includes('--prepare')) {
  const queries = [...expected.keys()].map(table => {
    const [schema, name] = table.split('.');
    return `SELECT '${table}' AS name, count(*) AS rows FROM "${schema}"."${name}"`;
  });
  const sql = `SELECT json_agg(t ORDER BY name) FROM (${queries.join('\nUNION ALL\n')}) t;\n`;
  fs.writeFileSync(path.join(database, 'rehearsal/check-table-counts.sql'), sql, { flag: 'wx' });
  console.log(`Prepared checks for ${expected.size} exported tables.`);
} else if (process.argv.includes('--complete')) {
  const restored = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim());
  assert.equal(restored.length, expected.size, 'Restored table inventory mismatch');
  for (const item of restored) {
    assert(expected.has(item.name), 'Unexpected restored table');
    assert.equal(Number(item.rows), expected.get(item.name), `Restored row count mismatch: ${item.name}`);
  }
  const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'BACKUP-CHECKPOINT.json'), 'utf8'));
  for (const item of checkpoint.files) {
    const file = path.resolve(root, item.path);
    assert(file.startsWith(path.resolve(root) + path.sep), 'Unsafe checkpoint path');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(actual, item.sha256, 'Original backup changed during rehearsal');
  }
  const report = {
    generatedAt: new Date().toISOString(), projectRef: checkpoint.projectRef,
    databaseRestorePassed: true, environment: 'Disposable Docker PostgreSQL 17.6.1.155; network none; no published ports',
    containerLabel: 'dilg.backup-rehearsal=20261004', singleTransaction: true, stopOnError: true,
    exportedTablesChecked: expected.size, restoredCounts: Object.fromEntries(expected),
    originalBackupHashesRechecked: checkpoint.files.length,
    localPrerequisites: ['Empty image-initialized Auth/Storage schemas rebuilt from export',
      'Non-login supabase_realtime_admin role added; Storage policies restored after public functions'],
    limitations: ['Database-only restore; hosted Auth/Storage services and sign-in were not exercised',
      'Provider encryption/signing keys and deployed secret values are not included',
      'Custom hosted email templates and secret values must be preserved privately',
      'Refresh non-atomic exports before deployment if live records change'],
  };
  fs.writeFileSync(path.join(root, 'RESTORE-CHECKPOINT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Local database restore passed: ${expected.size} table counts and ${checkpoint.files.length} original backup hashes checked.`);
} else {
  throw new Error('Use --prepare or --complete');
}
