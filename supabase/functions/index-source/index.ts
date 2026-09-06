import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { chunkSourceText, INDEXER_VERSION, normalizeSourceText } from '../_shared/chunking.ts'
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EmbeddingFailure, classifyEmbeddingError, generateDocumentEmbeddings } from '../_shared/embedding.ts'

const URL = Deno.env.get('SUPABASE_URL') ?? ''
const KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? ''
const TOKEN = Deno.env.get('INDEX_SOURCE_TOKEN') ?? ''
const FIXTURE_TOKEN = Deno.env.get('INDEXING_ACCEPTANCE_FIXTURE_TOKEN') ?? ''
const API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const MODEL = Deno.env.get('GEMINI_EMBEDDING_MODEL') ?? DEFAULT_EMBEDDING_MODEL
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const equal = (a: string, b: string) => { const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x[i]??0)^(y[i]??0);return d===0 }
async function db(path: string, init: RequestInit = {}) { const r=await fetch(`${URL}/rest/v1/${path}`,{...init,headers:{apikey:KEY,'content-type':'application/json',...(init.headers??{})}});const text=await r.text();if(!r.ok)throw new Error(`database_${r.status}`);return text?JSON.parse(text):null }

serve(async (request) => {
  if (request.method !== 'POST') return json(405,{status:'permanent_error',error:'method_not_allowed'})
  const supplied=request.headers.get('x-index-source-token')??''
  if (!TOKEN || !equal(supplied,TOKEN)) return json(401,{status:'permanent_error',error:'unauthorized'})
  if (!URL || !KEY || !API_KEY) return json(500,{status:'permanent_error',error:'server_not_configured'})
  let body: Record<string,unknown>; try{body=await request.json()}catch{return json(400,{status:'permanent_error',error:'invalid_request'})}
  if(Object.keys(body).length!==1||typeof body.source_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.source_id))return json(400,{status:'permanent_error',error:'invalid_request'})
  try {
    const rows=await db(`sources?id=eq.${encodeURIComponent(body.source_id)}&select=id,post_id,status,is_current,content_fingerprint,normalized_text,raw_text,media_urls,source_metadata,festival_year&limit=1`) as Record<string,unknown>[]
    const source=rows[0]; if(!source)return json(404,{status:'permanent_error',source_id:body.source_id,error:'source_not_found'})
    if(!['active','updated','postponed'].includes(String(source.status))||source.is_current!==true||typeof source.content_fingerprint!=='string'||!source.content_fingerprint.trim())return json(409,{status:'permanent_error',source_id:body.source_id,error:'source_ineligible'})
    const metadata=source.source_metadata as Record<string,unknown>; const test=metadata?.acceptance===true||metadata?.test===true
    const fixtureSupplied=request.headers.get('x-indexing-acceptance-fixture-token')??''
    const fixtureAuthorized=test&&FIXTURE_TOKEN&&FIXTURE_TOKEN!==TOKEN&&equal(fixtureSupplied,FIXTURE_TOKEN)&&String(source.post_id).startsWith('indexing-test-')
    if(test&&!fixtureAuthorized)return json(409,{status:'permanent_error',source_id:body.source_id,error:'stale_test_artifact'})
    const claimToken=crypto.randomUUID(); const claim=await db('rpc/claim_source_indexing',{method:'POST',body:JSON.stringify({p_source_id:body.source_id,p_source_fingerprint:source.content_fingerprint,p_indexer_version:INDEXER_VERSION,p_embedding_model:MODEL,p_embedding_dimensions:EMBEDDING_DIMENSIONS,p_claim_token:claimToken,p_lease_seconds:120})}) as Record<string,unknown>
    if(claim.status!=='processing'||claim.claim_token!==claimToken)return json(200,{status:claim.status,source_id:body.source_id,cached:claim.status!=='processing',in_progress:claim.status==='processing'})
    try {
      const selected=typeof source.normalized_text==='string'&&source.normalized_text.trim()?source.normalized_text:typeof source.raw_text==='string'?source.raw_text:''
      const text=normalizeSourceText(selected); const chunks=await chunkSourceText(text)
      let status='indexed', reasons:string[]=[]; if(!chunks.length){status=Array.isArray(source.media_urls)&&source.media_urls.length?'needs_review':'no_text';if(status==='needs_review')reasons=['image_only_source_requires_ocr']}
      const vectors=chunks.length?await generateDocumentEmbeddings(chunks.map(c=>c.content),{apiKey:API_KEY,model:MODEL,timeoutMs:90_000}):[]
      const persisted=await db('rpc/persist_source_indexing',{method:'POST',body:JSON.stringify({p_indexing_id:claim.id,p_claim_token:claimToken,p_source_id:body.source_id,p_source_fingerprint:source.content_fingerprint,p_indexer_version:INDEXER_VERSION,p_embedding_model:MODEL,p_embedding_dimensions:EMBEDDING_DIMENSIONS,p_status:status,p_chunks:chunks.map((c,i)=>({chunk_index:c.chunkIndex,content:c.content,content_hash:c.contentHash,embedding:vectors[i]})),p_review_reasons:reasons})}) as Record<string,unknown>
      return json(200,{status,source_id:body.source_id,cached:false,persisted_chunks:persisted.persisted_chunks??0,review_reasons:reasons})
    } catch(error) {
      const failure=classifyEmbeddingError(error); await db('rpc/fail_source_indexing',{method:'POST',body:JSON.stringify({p_indexing_id:claim.id,p_claim_token:claimToken,p_status:failure.status,p_error_code:failure.code,p_error_message:failure.safeMessage})}).catch(()=>null)
      return json(failure.httpStatus??500,{status:failure.status,source_id:body.source_id,error:failure.code})
    }
  } catch(error) { const failure=error instanceof EmbeddingFailure?error:null; return json(failure?.httpStatus??500,{status:failure?.status??'permanent_error',source_id:body.source_id,error:failure?.code??'database_unavailable'}) }
})
