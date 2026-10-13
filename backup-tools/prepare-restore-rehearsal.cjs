'use strict';

// Generates a plan for the disposable, no-network Docker database only.
// Never run these files on the hosted project. Original exports stay unchanged.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = 'C:/Users/Marc/Downloads/DILG Recovery Backup/Database';
const target = path.join(root, 'rehearsal');
assert(!fs.existsSync(target), 'Rehearsal plan already exists; do not overwrite it');
const managed = fs.readFileSync(path.join(root, 'managed-schema.sql'), 'utf8');
const policies = [...managed.matchAll(/^CREATE POLICY [\s\S]*?;\s*$/gm)].map(match => match[0]);
assert.equal(policies.length, 7, 'Unexpected managed policy statements; review before restore');
assert(policies.every(sql => /ON "storage"\./.test(sql)), 'Unexpected policy schema');
const before = managed.replace(/^CREATE POLICY [\s\S]*?;\s*$/gm, '');
fs.mkdirSync(target);
const header = '-- ISOLATED LOCAL REHEARSAL ONLY. Never execute against production.\n';
const bootstrap = `
-- The labelled disposable container has only image-initialized empty schemas.
-- Auth is rebuilt from this backup to match its precise provider table version.
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
`;
fs.writeFileSync(path.join(target, '00-local-bootstrap.sql'), header + bootstrap, { flag: 'wx' });
fs.writeFileSync(path.join(target, '01-managed-before.sql'), header + before, { flag: 'wx' });
fs.writeFileSync(path.join(target, '02-storage-policies.sql'), header + policies.join('\n'), { flag: 'wx' });
const driver = header + `
-- ON_ERROR_STOP and one transaction are also set by the psql caller.
\\i /backup/rehearsal/00-local-bootstrap.sql
\\i /backup/roles.sql
\\i /backup/rehearsal/01-managed-before.sql
\\i /backup/schema.sql
\\i /backup/rehearsal/02-storage-policies.sql
SET session_replication_role = replica;
\\i /backup/data.sql
\\i /backup/migration-history.sql
SET session_replication_role = origin;
`;
fs.writeFileSync(path.join(target, 'restore-local-only.sql'), driver, { flag: 'wx' });
console.log('Generated local-only rehearsal plan. Seven Storage policies deferred until public functions exist.');
