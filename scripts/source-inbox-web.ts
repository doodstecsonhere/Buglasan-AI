import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createWorker, type Worker } from 'tesseract.js'
import localEnglishData from '@tesseract.js-data/eng'
import { createLocalVideoProvider, requiredAbsoluteVideoToolPaths } from './local-video-provider.ts'
import { analyzeSourceInbox, createOfflineTesseractImageProvider, type MediaAnalysisProvider, type SourceInboxImage, type SourceInboxVideo } from '../src/ingestion/sourceInbox.ts'
import { confirmSourceInboxProduction, productionConfirmationContent } from './source-inbox-production.ts'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_REQUEST_BYTES = 384 * 1024 * 1024
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const PAGE_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }

export interface SourceInboxWebServer { readonly host: typeof LOOPBACK_HOST; readonly port: number; readonly url: string; close(): Promise<void> }
interface WebMediaInput { readonly name: unknown; readonly mimeType: unknown; readonly base64: unknown }
interface WebAnalyzeInput { readonly facebookPostUrl: unknown; readonly operatorCaption: unknown; readonly festivalYear: unknown; readonly images?: unknown; readonly videos?: unknown }
interface WebProductionConfirmation { readonly replayKey: unknown; readonly confirmProduction: unknown; readonly confirmOcrReview?: unknown; readonly confirmOfficialBuglasanSource?: unknown }

function isLoopbackRequest(request: IncomingMessage): boolean { return request.socket.remoteAddress === '127.0.0.1' || request.socket.remoteAddress === '::1' || request.socket.remoteAddress === '::ffff:127.0.0.1' }
function sendJson(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, JSON_HEADERS); response.end(JSON.stringify(value)) }
async function readJson(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = []; let length = 0
  for await (const part of request) { const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part); length += bytes.byteLength; if (length > MAX_REQUEST_BYTES) throw new Error('Request body exceeds the local Source Inbox limit'); parts.push(bytes) }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { throw new Error('Request body must be valid JSON') }
}
function decodeMedia(value: unknown, label: string): SourceInboxImage[] {
  if (!Array.isArray(value)) throw new Error(`${label}s must be an array`)
  return value.map((item: WebMediaInput) => {
    if (!item || typeof item.name !== 'string' || typeof item.mimeType !== 'string' || typeof item.base64 !== 'string') throw new Error(`Each ${label} must include a name, MIME type, and base64 bytes`)
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64) || item.base64.length % 4 !== 0) throw new Error(`${label} bytes must be valid base64`)
    return { name: item.name, mimeType: item.mimeType, bytes: new Uint8Array(Buffer.from(item.base64, 'base64')) }
  })
}
function inputFromBody(body: unknown): { facebookPostUrl: string; operatorCaption: string | null; festivalYear: number | null; images: SourceInboxImage[]; videos: SourceInboxVideo[] } {
  if (!body || typeof body !== 'object') throw new Error('Request body must be an object')
  const input = body as WebAnalyzeInput
  if (typeof input.facebookPostUrl !== 'string') throw new Error('facebookPostUrl is required')
  if (input.operatorCaption !== null && input.operatorCaption !== undefined && typeof input.operatorCaption !== 'string') throw new Error('operatorCaption must be text')
  if (input.festivalYear !== null && input.festivalYear !== undefined && (typeof input.festivalYear !== 'number' || !Number.isInteger(input.festivalYear) || input.festivalYear < 1900 || input.festivalYear > 9999)) throw new Error('festivalYear must be a four-digit year')
  return { facebookPostUrl: input.facebookPostUrl, operatorCaption: input.operatorCaption ?? null, festivalYear: typeof input.festivalYear === 'number' ? input.festivalYear : null, images: decodeMedia(input.images ?? [], 'image'), videos: decodeMedia(input.videos ?? [], 'video') }
}

/** Loopback-only local UI. The Node process, never browser code, owns any production credential. */
export async function startSourceInboxWebServer(options: { readonly port?: number; readonly provider?: MediaAnalysisProvider } = {}): Promise<SourceInboxWebServer> {
  let worker: Worker | null = null; let provider = options.provider
  const previews = new Map<string, Awaited<ReturnType<typeof analyzeSourceInbox>>>()
  if (!provider) {
    worker = await createWorker('eng', 1, { langPath: localEnglishData.langPath, cacheMethod: 'none', ...(process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH ? { workerPath: process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH } : {}), ...(process.env.SOURCE_INBOX_TESSERACT_CORE_PATH ? { corePath: process.env.SOURCE_INBOX_TESSERACT_CORE_PATH } : {}) })
    const recognizer = { recognize: async (bytes: Uint8Array) => worker!.recognize(Buffer.from(bytes)) }
    try { provider = createLocalVideoProvider({ tools: requiredAbsoluteVideoToolPaths(), recognizer }) } catch { provider = createOfflineTesseractImageProvider(recognizer) }
  }
  const server = createServer(async (request, response) => {
    if (!isLoopbackRequest(request)) return sendJson(response, 403, { error: 'Source Inbox accepts loopback requests only' })
    if (request.method === 'GET' && request.url === '/') { response.writeHead(200, PAGE_HEADERS); return response.end(SOURCE_INBOX_HTML) }
    if (request.method === 'POST' && request.url === '/api/analyze') try { const preview = await analyzeSourceInbox({ ...inputFromBody(await readJson(request)), collectedAt: new Date().toISOString() }, provider); previews.set(preview.replay_key, preview); return sendJson(response, 200, { preview, production_confirmation: productionConfirmationContent(preview) }) } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Unable to analyze local submission' }) }
    if (request.method === 'POST' && request.url === '/api/production-confirmation') try {
      const body = await readJson(request) as WebProductionConfirmation
      if (!body || typeof body.replayKey !== 'string' || body.confirmProduction !== true || (body.confirmOcrReview !== undefined && typeof body.confirmOcrReview !== 'boolean') || (body.confirmOfficialBuglasanSource !== undefined && typeof body.confirmOfficialBuglasanSource !== 'boolean')) throw new Error('A stored replay key and explicit production confirmation are required')
      const preview = previews.get(body.replayKey); if (!preview) throw new Error('Preview is unavailable; analyze the local evidence again before confirming')
      const receipt = await confirmSourceInboxProduction(preview, { confirmProduction: true, ...(body.confirmOcrReview === true ? { confirmOcrReview: true } : {}), ...(body.confirmOfficialBuglasanSource === true ? { confirmOfficialBuglasanSource: true } : {}) })
      previews.delete(body.replayKey)
      // The browser receives only the allowed operator-facing outcome; identifiers stay server-side.
      return sendJson(response, 200, { status: receipt.status })
    } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Production dispatch was not completed; review state was retained' }) }
    return sendJson(response, 404, { error: 'Not found' })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, LOOPBACK_HOST, resolve) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Source Inbox did not bind a TCP loopback address')
  return { host: LOOPBACK_HOST, port: address.port, url: `http://${LOOPBACK_HOST}:${address.port}/`, async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await worker?.terminate() } }
}

const SOURCE_INBOX_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Source Inbox</title><style>body{font:16px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;color:#18202a}label{display:block;font-weight:650;margin-top:1rem}input,textarea,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box}textarea{min-height:7rem}button{width:auto;margin:.7rem .5rem 0 0}pre{white-space:pre-wrap;background:#f4f6f8;padding:1rem;overflow:auto}.warn{color:#9a4b00}.error{color:#a00}</style><main><h1>Local Source Inbox</h1><p>Loopback-only analysis. No content is sent to production; preview artifacts remain in this browser session.</p><label>Official Buglasan Facebook post URL<input id="url" type="url" required placeholder="https://www.facebook.com/Buglasan/posts/..."></label><label>Optional caption<textarea id="caption" maxlength="12000"></textarea></label><label>Festival year<input id="year" type="number" min="1900" max="9999"></label><label>Images (JPEG, PNG, WebP)<input id="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><label>Videos (MP4, WebM; local tools required)<input id="videos" type="file" accept="video/mp4,video/webm" multiple></label><p id="files" aria-live="polite"></p><button id="analyze">Analyze locally</button><button id="clear" type="button">Reject / clear</button><p id="message" role="status"></p><h2>Preview</h2><p class="warn">Review generated transcript and OCR before the separate Node-owned production confirmation. No credentials are exposed to this page.</p><pre id="preview"></pre></main><script>const $=id=>document.getElementById(id),read=f=>new Promise((r,j)=>{const x=new FileReader;x.onload=()=>r({name:f.name,mimeType:f.type,base64:String(x.result).split(',')[1]});x.onerror=j;x.readAsDataURL(f)}),files=()=>[...$('images').files,...$('videos').files];for(const id of ['images','videos'])$(id).onchange=()=>$('files').textContent=files().map(f=>f.name+' ('+f.type+', '+f.size+' bytes)').join(', ');$('clear').onclick=()=>{for(const id of ['url','caption','year','images','videos'])$(id).value='';$('files').textContent='';$('message').textContent='';$('preview').textContent=''};$('analyze').onclick=async()=>{const button=$('analyze'),imageCount=$('images').files.length;button.disabled=true;$('message').textContent='Preparing local filesÃ¢â‚¬Â¦';try{const all=await Promise.all(files().map(read)),images=all.slice(0,imageCount),videos=all.slice(imageCount),response=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({facebookPostUrl:$('url').value,operatorCaption:$('caption').value||null,festivalYear:$('year').value?Number($('year').value):null,images,videos})}),data=await response.json();if(!response.ok)throw Error(data.error);$('preview').textContent=JSON.stringify(data.preview,null,2);$('message').textContent='Local analysis complete. Review the preview; nothing was dispatched.'}catch(e){$('message').className='error';$('message').textContent=e.message}finally{button.disabled=false}}</script>`

if (process.argv[1]?.endsWith('source-inbox-web.ts')) { const server = await startSourceInboxWebServer(); process.stdout.write(`Local Source Inbox is running at ${server.url} (Ctrl+C to stop)\n`); process.once('SIGINT', () => void server.close().finally(() => process.exit(0))) }
