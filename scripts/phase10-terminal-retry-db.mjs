// Isolated Docker-only integration suite. No env files, host ports or live harnesses.
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const name = `phase10-retry-test-${process.pid}`
function docker(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout)
  return r.stdout.trim()
}
const sql = (text) => docker(['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], text)
const id = '0f73eba4-daa0-48ca-82a8-a4ae02284793'
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const claim = `SELECT public.claim_phase10_terminal_retry('${id}', repeat('a',64), 'phase6-v1', (SELECT to_jsonb(s) FROM sources s WHERE id='${id}'), (SELECT to_jsonb(x) FROM source_extractions x WHERE source_id='${id}'), '${token}');`
const rejected = (text, pattern) => assert.throws(() => sql(text), pattern)
const snapshot = (table, where = 'true') => JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') FROM ${table} t WHERE ${where};`))
try {
  docker(['run', '--detach', '--rm', '--name', name, '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg17'])
  for (let n = 0; n < 40; n++) {
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) break
    await new Promise((r) => setTimeout(r, 250))
  }
  sql(`CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_user::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;`)
  const migrations = readdirSync('supabase/migrations').filter((f) => /^(00[1-9]|01[0-6])_.*\.sql$/.test(f)).sort()
  assert.equal(migrations.length, 16)
  for (const file of migrations) {
    sql(readFileSync(`supabase/migrations/${file}`, 'utf8'))
    console.log(`applied ${file}`)
  }
  sql(`INSERT INTO sources(id,platform,post_id,post_url,raw_text,normalized_text,source_type,media_urls,collected_at,collection_method,source_metadata,content_fingerprint)
    VALUES ('${id}','facebook','123456','https://www.facebook.com/Buglasan/posts/123456','Announcement','Announcement','text','{}',now(),'manual',
    '{"provenance":{"operator":"reviewer","reviewed_at":"2026-09-01","capture_note":"official post"}}',repeat('a',64));
    INSERT INTO source_extractions(source_id,source_fingerprint,extractor_version,status,attempt_count,last_error_code,last_error_message,result_json)
    VALUES ('${id}',repeat('a',64),'phase6-v1','permanent_error',4,'extraction_failed','historical error','{"candidates":[]}');`)
  const sourceBefore = snapshot('sources')
  const extractionBefore = snapshot('source_extractions')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(sql(`SELECT has_table_privilege('${role}', 'public.source_extractions', 'TRUNCATE');`), 'f')
    rejected(`SET ROLE ${role}; TRUNCATE public.source_extractions;`, /permission denied/)
  }
  for (const [label, expression] of [
    ['wrong source', claim.replaceAll(id, '254d56af-7bf4-4913-8a9b-d5ab34367b33')],
    ['fingerprint', claim.replace("repeat('a',64)", "repeat('b',64)")],
    ['version', claim.replace("'phase6-v1'", "'other'")],
    ['null', claim.replace(`'${token}'`, 'NULL')],
    ['null snapshot', claim.replace('(SELECT to_jsonb(s) FROM sources s WHERE id=' + `'${id}')`, 'NULL')],
    ['changed snapshot', claim.replace('to_jsonb(s)', `to_jsonb(s) || '{"title":"changed"}'::jsonb`)],
  ]) { rejected(expression); console.log(`rejected ${label}`) }
  for (const update of [
    "UPDATE source_extractions SET attempt_count=3", "UPDATE source_extractions SET status='retryable_error'",
    `UPDATE source_extractions SET claim_token='${token}'`, "UPDATE source_extractions SET lease_expires_at=now()-interval '1 hour'",
    "UPDATE sources SET status='archived'", "UPDATE sources SET normalized_text='',raw_text=''",
    "UPDATE sources SET source_metadata=source_metadata || '{\"synthetic\":true}'::jsonb",
    "UPDATE sources SET source_metadata='{}'", "UPDATE sources SET content_fingerprint=NULL",
    "UPDATE source_extractions SET last_error_code=NULL",
  ]) { rejected(`BEGIN; ${update}; ${claim} ROLLBACK;`); console.log(`rejected ${update}`) }
  rejected(`BEGIN; INSERT INTO events(event_name,extraction_identity,extracted_source_id,source_fingerprint,extractor_version,candidate_index) VALUES ('old','old','${id}',repeat('a',64),'phase6-v1',0); ${claim} ROLLBACK;`)
  for (const role of ['anon', 'authenticated']) rejected(`SET ROLE ${role}; ${claim}`)
  assert.equal(sql(`SELECT attempt_count FROM claim_source_extraction('${id}',repeat('a',64),'phase6-v1','${token}',60);`), '4')
  assert.deepEqual(snapshot('sources'), sourceBefore)
  assert.deepEqual(snapshot('source_extractions'), extractionBefore)
  // Two real sessions start concurrently. Exactly one transaction can acquire ownership.
  function concurrent() {
    return new Promise((resolve) => {
      const p = spawn('docker', ['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'])
      p.stdout.resume(); p.stderr.resume(); p.on('close', resolve)
      p.stdin.end(`BEGIN; ${claim} SELECT pg_sleep(0.3); COMMIT;`)
    })
  }
  assert.deepEqual((await Promise.all([concurrent(), concurrent()])).sort(), [0, 3])
  rejected(claim)
  assert.equal(sql(`SELECT attempt_count || ':' || last_error_message FROM source_extractions;`), '5:historical error')
  assert.equal(sql(`SELECT extraction_before->>'attempt_count' FROM phase10_terminal_retry_audit;`), '4')
  const auditBefore = snapshot('phase10_terminal_retry_audit')
  assert.deepEqual(auditBefore[0].source_before, sourceBefore[0])
  assert.deepEqual(auditBefore[0].extraction_before, extractionBefore[0])
  assert.deepEqual(snapshot('sources'), sourceBefore)
  assert.equal(sql(`SELECT claim_token IS NULL FROM claim_source_extraction('${id}',repeat('a',64),'phase6-v1','${token}',60);`), 't')
  rejected(`UPDATE source_extractions SET attempt_count=6;`)
  rejected(`UPDATE phase10_terminal_retry_audit SET source_before='{}';`)
  rejected(`SET ROLE service_role; DELETE FROM phase10_terminal_retry_audit;`)
  const processingBefore = snapshot('source_extractions')
  rejected(`SET ROLE service_role; TRUNCATE source_extractions;`, /permission denied/)
  rejected(`SET ROLE service_role; TRUNCATE source_extractions CASCADE;`, /permission denied/)
  rejected(`SET ROLE service_role; DELETE FROM source_extractions;`, /permanent Phase 10 tuple fence/)
  assert.deepEqual(snapshot('source_extractions'), processingBefore)
  // Real clock expiry, not a privileged trigger bypass or mocked lease.
  sql('SELECT pg_sleep(61);')
  assert.equal(sql(`SELECT claim_token IS NULL FROM claim_source_extraction('${id}',repeat('a',64),'phase6-v1','${token}',60);`), 't')
  assert.equal(sql('SELECT attempt_count FROM source_extractions;'), '5')
  rejected(`SELECT persist_source_extraction((SELECT id FROM source_extractions),'${token}','${id}',repeat('a',64),'phase6-v1','no_event','{"candidates":[]}','{}');`)
  sql(`SELECT fail_source_extraction((SELECT id FROM source_extractions),'${token}','retryable_error','timeout','new failure');`)
  assert.equal(sql(`SELECT status || ':' || attempt_count FROM source_extractions;`), 'permanent_error:5')
  assert.equal(sql(`SELECT extraction_before->>'last_error_message' FROM phase10_terminal_retry_audit;`), 'historical error')
  assert.equal(sql(`SELECT count(*) FROM phase10_terminal_retry_outcomes;`), '1')
  const firstOutcome = snapshot('phase10_terminal_retry_outcomes')
  assert.deepEqual(firstOutcome[0].extraction_after, snapshot('source_extractions')[0])
  assert.equal(firstOutcome[0].extraction_after.last_error_code, 'timeout')
  assert.equal(firstOutcome[0].extraction_after.last_error_message, 'new failure')
  assert.deepEqual(snapshot('phase10_terminal_retry_audit'), auditBefore)
  assert.deepEqual(snapshot('sources'), sourceBefore)
  assert.equal(sql(`SELECT claim_token IS NULL FROM claim_source_extraction('${id}',repeat('a',64),'phase6-v1','${token}',60);`), 't')
  assert.equal(sql('SELECT count(*) FROM events;'), '0')
  // Independent authorized tuple: service-role authorization and normal atomic persistence.
  const second = '2d9a28eb-a142-4bc2-b694-530d141e0cbc'
  sql(`INSERT INTO sources(id,platform,post_id,post_url,raw_text,normalized_text,source_type,media_urls,collected_at,collection_method,source_metadata,content_fingerprint)
    SELECT '${second}',platform,'654321','https://www.facebook.com/Buglasan/posts/654321',raw_text,normalized_text,source_type,media_urls,collected_at,collection_method,source_metadata,content_fingerprint FROM sources WHERE id='${id}';
    INSERT INTO source_extractions(source_id,source_fingerprint,extractor_version,status,attempt_count,last_error_code,last_error_message,result_json)
    VALUES ('${second}',repeat('a',64),'phase6-v1','permanent_error',4,'extraction_failed','second historical error','{"candidates":[]}');`)
  const secondToken = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  // Supabase normally supplies source read grants outside these migrations.
  sql('GRANT SELECT ON sources TO service_role;')
  const secondSourceBefore = snapshot('sources', `id='${second}'`)[0]
  const secondExtractionBefore = snapshot('source_extractions', `source_id='${second}'`)[0]
  sql(`SET ROLE service_role; ${claim.replaceAll(id, second).replaceAll(token, secondToken)}`)
  const secondAudit = snapshot('phase10_terminal_retry_audit', `source_id='${second}'`)[0]
  assert.deepEqual(secondAudit.source_before, secondSourceBefore)
  assert.deepEqual(secondAudit.extraction_before, secondExtractionBefore)
  sql(`SELECT persist_source_extraction((SELECT id FROM source_extractions WHERE source_id='${second}'),'${secondToken}','${second}',repeat('a',64),'phase6-v1','no_event','{"candidates":[]}','{}');`)
  assert.equal(sql(`SELECT status || ':' || attempt_count FROM source_extractions WHERE source_id='${second}';`), 'no_event:5')
  assert.equal(sql('SELECT count(*) FROM phase10_terminal_retry_outcomes;'), '2')
  assert.equal(sql('SELECT count(*) FROM events;'), '0')
  assert.deepEqual(snapshot('phase10_terminal_retry_outcomes', `extraction_id='${secondAudit.extraction_id}'`)[0].extraction_after,
    snapshot('source_extractions', `source_id='${second}'`)[0])
  assert.deepEqual(snapshot('phase10_terminal_retry_outcomes', `extraction_id='${auditBefore[0].extraction_id}'`), firstOutcome)
  assert.deepEqual(snapshot('phase10_terminal_retry_audit', `source_id='${id}'`), auditBefore)
  assert.deepEqual(snapshot('sources', `id='${second}'`)[0], secondSourceBefore)
  // Ordinary unaudited tuples retain their legacy contract (different versions,
  // plus a different fingerprint); never use the excluded source as normal work.
  const ordinary = (version, fp = "repeat('a',64)") => `SELECT to_jsonb(x) FROM claim_source_extraction('${second}',${fp},'${version}','${token}',60) x;`
  for (const status of ['pending', 'retryable_error', 'extracted', 'no_event', 'needs_review', 'permanent_error']) {
    const version = `normal-${status}`
    sql(`INSERT INTO source_extractions(source_id,source_fingerprint,extractor_version,status,attempt_count,last_error_code,last_error_message,result_json)
      VALUES ('${second}',repeat('a',64),'${version}','${status}',2,'old_code','old message','{"candidates":[]}');`)
    const before = snapshot('source_extractions', `extractor_version='${version}'`)[0]
    const result = JSON.parse(sql(`SET ROLE service_role; ${ordinary(version)}`).split('\n').at(-1))
    if (['pending', 'retryable_error'].includes(status)) {
      assert.equal(result.status, 'processing'); assert.equal(result.attempt_count, 3)
      assert.equal(result.claim_token, token); assert.ok(result.lease_expires_at)
      assert.equal(result.last_error_code, null); assert.equal(result.last_error_message, null)
      assert.deepEqual(result.result_json, before.result_json)
      assert.deepEqual(JSON.parse(sql(ordinary(version))), result) // active lease is cached
    } else assert.deepEqual(result, before)
  }
  assert.equal(JSON.parse(sql(ordinary('phase6-v1', "repeat('b',64)"))).attempt_count, 1)
  assert.equal(sql('SELECT count(*) FROM phase10_terminal_retry_audit;'), '2')
  // Defense in depth: privileged maintenance is OUTSIDE the app boundary.
  // Roll back each simulated lost/replaced row; application claim must still
  // recognize the consumed logical tuple and not leave a new pending insert.
  const allExtractions = snapshot('source_extractions')
  for (const replacement of ['', `INSERT INTO source_extractions(source_id,source_fingerprint,extractor_version) VALUES ('${id}',repeat('a',64),'phase6-v1');`]) {
    rejected(`BEGIN; TRUNCATE source_extractions; ${replacement} SET LOCAL ROLE service_role;
      SELECT claim_source_extraction('${id}',repeat('a',64),'phase6-v1','${token}',60); COMMIT;`, /consumed Phase 10 tuple has changed extraction identity/)
    assert.deepEqual(snapshot('source_extractions'), allExtractions)
  }
  for (const table of ['phase10_terminal_retry_audit', 'phase10_terminal_retry_outcomes']) {
    rejected(`SET ROLE service_role; TRUNCATE ${table} CASCADE;`, /permission denied/)
    rejected(`SET ROLE service_role; UPDATE ${table} SET extraction_id=extraction_id;`, /permission denied/)
    rejected(`SET ROLE service_role; DELETE FROM ${table};`, /permission denied/)
  }
  assert.deepEqual(snapshot('phase10_terminal_retry_outcomes', `extraction_id='${auditBefore[0].extraction_id}'`), firstOutcome)
  assert.deepEqual(snapshot('phase10_terminal_retry_audit', `source_id='${id}'`), auditBefore)
  assert.deepEqual(snapshot('sources', `id='${id}'`), sourceBefore)
  assert.equal(sql(`SELECT count(*) FROM sources WHERE id='254d56af-7bf4-4913-8a9b-d5ab34367b33';`), '0')
  assert.equal(sql('SELECT count(*) FROM events;'), '0')
  console.log('PASS: migrations 001-016, rejection matrix, concurrent single winner, real expiry, service-role TRUNCATE denial, replaced/missing-row logical tuple refusal, full before/after evidence, prior outcome preservation, unaudited pending/retryable/terminal compatibility, receipt ownership redaction, excluded source absent, no events')
} finally {
  // Only our fresh, uniquely named disposable container; never a shared/local Supabase stack.
  docker(['rm', '--force', name])
}
