import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createWorker } from 'tesseract.js'
import localEnglishData from '@tesseract.js-data/eng'
import { createLocalVideoProvider, requiredAbsoluteVideoToolPaths } from './local-video-provider.ts'
import {
  analyzeSourceInbox,
  approveSourceInboxPreview,
  createOfflineTesseractImageProvider,
  type SourceInboxImage,
  type SourceInboxVideo,
} from '../src/ingestion/sourceInbox.ts'

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function options(name: string): string[] {
  return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] ? [process.argv[index + 1]] : [])
}

function usage(): never {
  throw new Error('Usage: npm run source-inbox -- --post-url <https://www.facebook.com/Buglasan/...|https://www.facebook.com/reel/<id>> [--image <local-file>] [--video <local-file>] [--caption <text>] [--festival-year <year>] [--approve --confirm-official-buglasan-source]')
}

function videoMimeTypeFor(path: string): SourceInboxVideo['mimeType'] {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'mp4') return 'video/mp4'
  if (extension === 'webm') return 'video/webm'
  throw new Error(`Only MP4 and WebM files are supported: ${path}`)
}

function mimeTypeFor(path: string): SourceInboxImage['mimeType'] {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  throw new Error(`Only JPEG, PNG, and WebP files are supported: ${path}`)
}

const postUrl = option('--post-url') ?? usage()
const imagePaths = options('--image')
const videoPaths = options('--video')
if (imagePaths.length + videoPaths.length === 0 && option('--caption') === null) usage()
const langPath = process.env.SOURCE_INBOX_TESSDATA_PATH ?? localEnglishData.langPath

const localWorkerPath = process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH
const localCorePath = process.env.SOURCE_INBOX_TESSERACT_CORE_PATH
const worker = await createWorker('eng', 1, {
  langPath: resolve(langPath),
  cacheMethod: 'none',
  ...(localWorkerPath ? { workerPath: localWorkerPath } : {}),
  ...(localCorePath ? { corePath: localCorePath } : {}),
})

try {
  const images: SourceInboxImage[] = await Promise.all(imagePaths.map(async (path) => ({
    name: basename(path),
    mimeType: mimeTypeFor(path),
    bytes: new Uint8Array(await readFile(resolve(path))),
  })))
  const videos: SourceInboxVideo[] = await Promise.all(videoPaths.map(async (path) => ({
    name: basename(path),
    mimeType: videoMimeTypeFor(path),
    bytes: new Uint8Array(await readFile(resolve(path))),
  })))
  const festivalYear = option('--festival-year')
  const imageProvider = createOfflineTesseractImageProvider({ recognize: async (bytes) => worker.recognize(Buffer.from(bytes)) })
  const provider = videos.length > 0 ? createLocalVideoProvider({ tools: requiredAbsoluteVideoToolPaths(), recognizer: { recognize: async (bytes) => worker.recognize(Buffer.from(bytes)) } }) : imageProvider
  const preview = await analyzeSourceInbox({
    facebookPostUrl: postUrl,
    operatorCaption: option('--caption'),
    images,
    videos,
    collectedAt: new Date().toISOString(),
    festivalYear: festivalYear === null ? null : Number(festivalYear),
  }, provider)

  if (process.argv.includes('--approve')) {
    // This command never has collector credentials. It maps the explicitly approved
    // preview through sourceAdapter -> genericCollectorIngress and prints its payload.
    process.stdout.write(`${JSON.stringify(approveSourceInboxPreview(preview, (payload) => payload, { confirmOcrReview: true, confirmOfficialBuglasanSource: process.argv.includes('--confirm-official-buglasan-source') }), null, 2)}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`)
  }
} finally {
  await worker.terminate()
}
