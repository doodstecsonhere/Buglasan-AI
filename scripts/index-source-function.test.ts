import { describe,expect,it } from 'vitest'
import { readFileSync } from 'node:fs'
const code=readFileSync('supabase/functions/index-source/index.ts','utf8')
describe('index-source contract',()=>{
 it.each(['x-index-source-token','x-indexing-acceptance-fixture-token','SUPABASE_SECRET_KEYS','claim_source_indexing','persist_source_indexing','fail_source_indexing','image_only_source_requires_ocr','INDEXING_ACCEPTANCE_FIXTURE_TOKEN','indexing-test-'])(`contains %s`,value=>expect(code).toContain(value))
 it('uses the shared document boundary and constant-time comparison',()=>{expect(code).toContain('generateDocumentEmbeddings');expect(code).toContain('let d=x.length^y.length')})
 it('rejects broad bodies and never accepts caller embeddings',()=>{expect(code).toContain('Object.keys(body).length!==1');expect(code).not.toMatch(/body\.embedding/)})
 it('requires production auth before reading the acceptance-only header',()=>expect(code.indexOf("if (!TOKEN || !equal(supplied,TOKEN))")).toBeLessThan(code.indexOf("request.headers.get('x-indexing-acceptance-fixture-token')")))
})
