import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createWorker, type Worker } from 'tesseract.js'
import localEnglishData from '@tesseract.js-data/eng'
import {
  SOURCE_INBOX_LIMITS,
  analyzeSourceInbox,
  createOfflineTesseractImageProvider,
  type MediaAnalysisProvider,
  type SourceInboxImage,
} from '../src/ingestion/sourceInbox.ts'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_REQUEST_BYTES = 96 * 1024 * 1024
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

export interface SourceInboxWebServer {
  readonly host: typeof LOOPBACK_HOST
  readonly port: number
  readonly url: string
  close(): Promise<void>
}

interface WebImageInput { readonly name: unknown; readonly mimeType: unknown; readonly base64: unknown }
interface WebAnalyzeInput { readonly facebookPostUrl: unknown; readonly operatorCaption: unknown; readonly festivalYear: unknown; readonly images: unknown }

function isLoopbackRequest(request: IncomingMessage): boolean {
  return request.socket.remoteAddress === '127.0.0.1' || request.socket.remoteAddress === '::1' || request.socket.remoteAddress === '::ffff:127.0.0.1'
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = []
  let length = 0
  for await (const part of request) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part)
    length += bytes.byteLength
    if (length > MAX_REQUEST_BYTES) throw new Error('Request body exceeds the local Source Inbox limit')
    parts.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { throw new Error('Request body must be valid JSON') }
}

function decodeImages(value: unknown): SourceInboxImage[] {
  if (!Array.isArray(value)) throw new Error('images must be an array')
  return value.map((item: WebImageInput): SourceInboxImage => {
    if (!item || typeof item.name !== 'string' || typeof item.mimeType !== 'string' || typeof item.base64 !== 'string') throw new Error('Each image must include a name, MIME type, and base64 bytes')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64) || item.base64.length % 4 !== 0) throw new Error('Image bytes must be valid base64')
    return { name: item.name, mimeType: item.mimeType, bytes: new Uint8Array(Buffer.from(item.base64, 'base64')) }
  })
}

function inputFromBody(body: unknown): { facebookPostUrl: string; operatorCaption: string | null; festivalYear: number | null; images: SourceInboxImage[] } {
  if (!body || typeof body !== 'object') throw new Error('Request body must be an object')
  const input = body as WebAnalyzeInput
  if (typeof input.facebookPostUrl !== 'string') throw new Error('facebookPostUrl is required')
  if (input.operatorCaption !== null && input.operatorCaption !== undefined && typeof input.operatorCaption !== 'string') throw new Error('operatorCaption must be text')
  if (input.festivalYear !== null && input.festivalYear !== undefined && (typeof input.festivalYear !== 'number' || !Number.isInteger(input.festivalYear) || input.festivalYear < 1900 || input.festivalYear > 9999)) throw new Error('festivalYear must be a four-digit year')
  return { facebookPostUrl: input.facebookPostUrl, operatorCaption: input.operatorCaption ?? null, festivalYear: typeof input.festivalYear === 'number' ? input.festivalYear : null, images: decodeImages(input.images) }
}

/** Local-only UI; it has neither a dispatcher nor any production credential path. */
export async function startSourceInboxWebServer(options: { readonly port?: number; readonly provider?: MediaAnalysisProvider } = {}): Promise<SourceInboxWebServer> {
  let worker: Worker | null = null
  let provider = options.provider
  if (!provider) {
    worker = await createWorker('eng', 1, { langPath: localEnglishData.langPath, cacheMethod: 'none', ...(process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH ? { workerPath: process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH } : {}), ...(process.env.SOURCE_INBOX_TESSERACT_CORE_PATH ? { corePath: process.env.SOURCE_INBOX_TESSERACT_CORE_PATH } : {}) })
    provider = createOfflineTesseractImageProvider({ recognize: async (bytes) => worker!.recognize(Buffer.from(bytes)) })
  }
  const server = createServer(async (request, response) => {
    if (!isLoopbackRequest(request)) return sendJson(response, 403, { error: 'Source Inbox accepts loopback requests only' })
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, PAGE_HEADERS)
      return response.end(SOURCE_INBOX_HTML)
    }
    if (request.method === 'POST' && request.url === '/api/analyze') {
      try {
        const input = inputFromBody(await readJson(request))
        const preview = await analyzeSourceInbox({ ...input, collectedAt: new Date().toISOString() }, provider)
        return sendJson(response, 200, { preview })
      } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Unable to analyze local submission' }) }
    }
    return sendJson(response, 404, { error: 'Not found' })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, LOOPBACK_HOST, resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Source Inbox did not bind a TCP loopback address')
  return {
    host: LOOPBACK_HOST, port: address.port, url: `http://${LOOPBACK_HOST}:${address.port}/`,
    async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await worker?.terminate() },
  }
}

const SOURCE_INBOX_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Source Inbox</title><style>body{font:16px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;color:#18202a}label{display:block;font-weight:650;margin-top:1rem}input,textarea,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box}textarea{min-height:7rem}.drop{border:2px dashed #567;padding:1.4rem;text-align:center;margin-top:.5rem}.drop.drag{background:#eaf5ff}button{width:auto;margin:.7rem .5rem 0 0}button:disabled{opacity:.5}pre{white-space:pre-wrap;background:#f4f6f8;padding:1rem;overflow:auto}.warn{color:#9a4b00}.error{color:#a00}.hidden{display:none}</style><main><h1>Local Source Inbox</h1><p>This page runs only on your computer. Analyze does not send content to production. Approval only prepares a downloadable or printable local payload.</p><label>Official Buglasan Facebook post URL<input id="url" type="url" required placeholder="https://www.facebook.com/Buglasan/posts/..." autocomplete="off"></label><label>Optional operator caption<textarea id="caption" maxlength="12000"></textarea></label><label>Festival year (optional)<input id="year" type="number" min="1900" max="9999" step="1"></label><label>Images (JPEG, PNG, WebP; up to 8, 8 MiB each)<input id="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="drop" class="drop" tabindex="0">Drop image files here</div><p id="files" aria-live="polite"></p><button id="analyze">Analyze locally</button><button id="reject" type="button">Reject / clear</button><p id="message" role="status"></p><section id="review" class="hidden"><h2>Evidence and normalized preview</h2><p class="warn">Review OCR against the source images. This UI cannot dispatch to production.</p><pre id="preview"></pre><label><input id="ocr-confirm" type="checkbox" style="width:auto"> I reviewed all machine-generated OCR text against the source images.</label><button id="download">Download approved local payload</button><button id="print">Print approved local payload</button></section></main><script>const $=id=>document.getElementById(id), files=[], image=$('images'), message=$('message'), review=$('review'), preview=$('preview'); let analyzed=null; const limits={max:8,bytes:${SOURCE_INBOX_LIMITS.maxImageBytes}}; function note(text,error=false){message.textContent=text;message.className=error?'error':''} function renderFiles(){ $('files').textContent=files.length?files.map(f=>f.name+' ('+f.size+' bytes)').join(', '):'No images selected.' } function add(list){for(const f of list){if(files.length>=limits.max){note('At most '+limits.max+' images are allowed.',true);break}if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>limits.bytes){note('Only supported images no larger than 8 MiB can be added.',true);continue}files.push(f)}renderFiles()} image.addEventListener('change',()=>add(image.files)); const drop=$('drop'); for(const e of ['dragenter','dragover'])drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add('drag')}); for(const e of ['dragleave','drop'])drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove('drag')});drop.addEventListener('drop',e=>add(e.dataTransfer.files)); async function encode(f){return new Promise((ok,bad)=>{const r=new FileReader;r.onerror=bad;r.onload=()=>ok(r.result.split(',')[1]);r.readAsDataURL(f)})} $('analyze').onclick=async()=>{try{note('Analyzing locally…');review.classList.add('hidden');const body={facebookPostUrl:$('url').value,operatorCaption:$('caption').value||null,festivalYear:$('year').value?Number($('year').value):null,images:await Promise.all(files.map(async f=>({name:f.name,mimeType:f.type,base64:await encode(f)})))};const r=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Error(data.error);analyzed=data.preview;preview.textContent=JSON.stringify(analyzed,null,2);review.classList.remove('hidden');note('Local analysis complete. Review evidence before preparing a payload.')}catch(e){note(e.message||'Analysis failed.',true)}}; $('reject').onclick=()=>{files.length=0;image.value='';analyzed=null;review.classList.add('hidden');renderFiles();note('Submission cleared locally. Nothing was dispatched.')}; function approved(){if(!analyzed)throw Error('Analyze a submission first.');if(analyzed.requires_ocr_review&&!$('ocr-confirm').checked)throw Error('Confirm OCR review before preparing a payload.');if(analyzed.status!=='ready_for_approval')throw Error('Only ready previews can be prepared.');return {approved_at:new Date().toISOString(),approval:'local operator review only; no production dispatch',preview:analyzed}} $('download').onclick=()=>{try{const blob=new Blob([JSON.stringify(approved(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='source-inbox-approved-payload.json';a.click();URL.revokeObjectURL(a.href)}catch(e){note(e.message,true)}}; $('print').onclick=()=>{try{const w=open('','_blank','noopener,noreferrer');if(!w)throw Error('Allow pop-ups to print the local payload.');w.document.write('<pre></pre>');w.document.querySelector('pre').textContent=JSON.stringify(approved(),null,2);w.print()}catch(e){note(e.message,true)}};renderFiles();</script></html>`

if (process.argv[1]?.endsWith('source-inbox-web.ts')) {
  const server = await startSourceInboxWebServer()
  process.stdout.write(`Local Source Inbox is running at ${server.url} (Ctrl+C to stop)\n`)
  process.once('SIGINT', () => void server.close().finally(() => process.exit(0)))
}
