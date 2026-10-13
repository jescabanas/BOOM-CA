'use strict';

// Offline checks only: never connects to Supabase or restores anything.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const functions = {
  'create-user': 8, 'generate-report': 6, 'score-submission': 6,
  notify: 5, 'request-email-mfa': 11, 'verify-email-mfa': 5,
  'email-mfa-status': 5, 'resend-user-invite': 3,
  'submit-account-application': 1, 'review-account-application': 2,
};
function decodeCopy(value) {
  if (value === '\\N') return null;
  const chars = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' };
  return value.replace(/\\([0-7]{1,3}|[bfnrtv\\])/g,
    (_, match) => chars[match] ?? String.fromCharCode(parseInt(match, 8)));
}
function copyTables(sql) {
  const result = new Map();
  let table = null;
  for (const line of sql.split(/\r?\n/)) {
    const match = /^COPY "([^"]+)"\."([^"]+)" \((.+)\) FROM stdin;$/.exec(line);
    if (match) {
      table = { columns: Array.from(match[3].matchAll(/"([^"]+)"/g), m => m[1]), rows: [] };
      result.set(`${match[1]}.${match[2]}`, table);
    } else if (line === '\\.') {
      table = null;
    } else if (table) {
      const values = line.split('\t').map(decodeCopy);
      assert.equal(values.length, table.columns.length, 'COPY row has wrong number of columns');
      table.rows.push(Object.fromEntries(table.columns.map((name, index) => [name, values[index]])));
    }
  }
  assert.equal(table, null, 'Unterminated COPY section');
  return result;
}
function under(root, relative) {
  assert(relative && !path.isAbsolute(relative) && !relative.includes('\\'), 'Unsafe backup object path');
  const resolved = path.resolve(root, relative);
  assert(resolved.startsWith(path.resolve(root) + path.sep), 'Path escapes backup directory');
  return resolved;
}
function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.temp') return [];
    const file = path.join(root, entry.name);
    assert(!entry.isSymbolicLink(), 'Symbolic links are not accepted in backup');
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (process.argv.includes('--self-test')) {
  const sample = 'COPY "auth"."users" ("id", "name") FROM stdin;\na\tHello\\tWorld\n\\.\n';
  assert.equal(copyTables(sample).get('auth.users').rows[0].name, 'Hello\tWorld');
  assert.equal(decodeCopy('\\N'), null);
  assert.equal(decodeCopy('a\\\\b'), 'a\\b');
  assert.throws(() => under(process.cwd(), '../escape'));
  assert.throws(() => copyTables(sample.replace('\\.\n', '')));
  console.log('Offline verifier self-tests passed.');
  process.exit(0);
}

const root = path.resolve(process.argv[2] || '');
assert.equal(root.toLowerCase(), path.resolve('C:/Users/Marc/Downloads/DILG Recovery Backup').toLowerCase(),
  'This checkpoint verifier is restricted to the agreed backup directory');
const database = path.join(root, 'Database');
const reads = Object.fromEntries(['roles.sql', 'schema.sql', 'data.sql', 'managed-schema.sql', 'migration-history.sql']
  .map(name => {
    const text = fs.readFileSync(path.join(database, name), 'utf8');
    assert(text.trim().length > 0, `Empty export: ${name}`);
    return [name, text];
  }));
assert(reads['schema.sql'].includes('CREATE TABLE IF NOT EXISTS "public"."profiles"') ||
  reads['schema.sql'].includes('CREATE TABLE "public"."profiles"'), 'Public profile schema missing');
assert(reads['managed-schema.sql'].includes('"auth"."users"'), 'Auth schema missing');
assert(reads['managed-schema.sql'].includes('"storage"."objects"'), 'Storage schema missing');
const policyCount = (reads['managed-schema.sql'].match(/^CREATE POLICY .* ON "storage"\./gm) || []).length;
assert.equal(policyCount, 7, 'Storage policy count differs from live checkpoint');
const tables = copyTables(reads['data.sql']);
const counts = {};
for (const [table, expected] of Object.entries({ 'auth.users': 9, 'public.profiles': 9,
  'public.submissions': 24, 'public.documents': 24 })) {
  counts[table] = tables.get(table)?.rows.length;
  assert.equal(counts[table], expected, `Row count differs from live checkpoint: ${table}`);
}
const history = copyTables(reads['migration-history.sql']);
assert.equal(history.get('supabase_migrations.schema_migrations')?.rows.length, 12, 'Migration history mismatch');
const storage = tables.get('storage.objects');
assert(storage, 'Storage metadata missing');
const bucketChecks = [];
for (const [bucket, expectedCount] of Object.entries({ 'mov-documents': 51, avatars: 11,
  'account-application-proofs': 0 })) {
  const downloadRoot = path.join(root, 'Storage', bucket);
  const objects = storage.rows.filter(row => row.bucket_id === bucket);
  // CLI cp -r preserves the bucket directory inside the destination directory.
  const nestedRoot = path.join(downloadRoot, bucket);
  const bucketRoot = fs.existsSync(nestedRoot) && fs.statSync(nestedRoot).isDirectory()
    ? nestedRoot : downloadRoot;
  assert.equal(objects.length, expectedCount, `Storage metadata count differs: ${bucket}`);
  assert.equal(walk(bucketRoot).length, expectedCount, `Downloaded file count differs: ${bucket}`);
  let bytes = 0;
  for (const object of objects) {
    const file = under(bucketRoot, object.name);
    const stat = fs.statSync(file);
    assert(stat.isFile(), 'Expected Storage object is not a file');
    const metadata = JSON.parse(object.metadata);
    assert.equal(stat.size, Number(metadata.size), `Downloaded file size mismatch in ${bucket}`);
    bytes += stat.size;
  }
  bucketChecks.push({ bucket, directory: path.relative(root, bucketRoot).replaceAll(path.sep, '/'),
    files: objects.length, bytes });
}
const functionRoot = path.join(root, 'LiveServer', 'supabase', 'functions');
for (const slug of Object.keys(functions)) {
  assert(fs.statSync(path.join(functionRoot, slug, 'index.ts')).size > 0, `Missing deployed function: ${slug}`);
}
for (const file of walk(functionRoot).filter(file => file.endsWith('.ts'))) {
  const text = fs.readFileSync(file, 'utf8');
  const imports = [...text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)];
  for (const match of imports) {
    const dependency = path.resolve(path.dirname(file), match[1]);
    assert(dependency.startsWith(functionRoot + path.sep), 'Function import escapes backup');
    assert(fs.existsSync(dependency), `Missing deployed relative dependency for ${path.basename(path.dirname(file))}`);
  }
}
const config = fs.readFileSync(path.join(root, 'LiveServer', 'supabase', 'config.toml'), 'utf8');
assert(config.includes('https://dilgtest2.netlify.app/'), 'Hosted configuration has unexpected site URL');
const mfaSection = config.match(/\[auth\.mfa\.totp\]([\s\S]*?)(?=\n\[|$)/)?.[1] || '';
assert(/enroll_enabled\s*=\s*true/.test(mfaSection) && /verify_enabled\s*=\s*true/.test(mfaSection),
  'Hosted TOTP flags not captured');
const sourceRoot = path.resolve(__dirname, '..');
const codeBackup = path.join(root, 'CurrentApplication');
let codeFilesChecked = 0;
for (const area of ['frontend', 'supabase/functions', 'supabase/migrations', 'supabase/templates']) {
  for (const file of walk(path.join(sourceRoot, area))) {
    const copy = path.join(codeBackup, path.relative(sourceRoot, file));
    assert(fs.existsSync(copy) && hash(copy) === hash(file),
      `Local code backup mismatch: ${path.relative(sourceRoot, file)}`);
    codeFilesChecked++;
  }
}
for (const name of ['package.json', 'package-lock.json', 'netlify.toml', 'README.md',
  '.env.example', '.gitignore', '.gitattributes', 'supabase/config.toml']) {
  assert.equal(hash(path.join(sourceRoot, name)), hash(path.join(codeBackup, name)),
    `Configuration backup mismatch: ${name}`);
  codeFilesChecked++;
}
const manifestFiles = [database, path.join(root, 'Storage'), path.join(root, 'LiveServer'), codeBackup]
  .flatMap(walk).map(file => ({ path: path.relative(root, file).replaceAll(path.sep, '/'),
    bytes: fs.statSync(file).size, sha256: hash(file) }));
const report = { generatedAt: new Date().toISOString(), projectRef: 'nptfdsblgsufghdtnjvk',
  collectionChecked: true, restoredToIsolatedProject: false,
  rowCounts: counts, migrations: 12, storagePolicies: policyCount, storage: bucketChecks,
  deployedFunctions: Object.entries(functions).map(([slug, version]) => ({ slug, version, verifyJwt: true })),
  localCodeFilesCompared: codeFilesChecked, files: manifestFiles,
  limitations: [
    'Collection and integrity checks are not a full restore rehearsal.',
    'Preserve hosted custom email templates and secret values separately using an approved private vault.',
    'Provider Auth encryption/signing material is not exported; cross-project restoration needs provider guidance.',
    'Exports and Storage download are not one transaction; refresh before rollout if records change.',
    'Do not replay managed-schema.sql wholesale into production or a different provider version.',
  ] };
const reportPath = path.join(root, 'BACKUP-CHECKPOINT.json');
assert(!fs.existsSync(reportPath), 'Checkpoint file already exists; do not overwrite an earlier audit');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ collectionChecked: true, restoredToIsolatedProject: false,
  storageFiles: 62, deployedFunctions: 10, localCodeFilesCompared: codeFilesChecked,
  checkpoint: reportPath }, null, 2));
