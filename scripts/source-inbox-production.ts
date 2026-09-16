import { approveSourceInboxPreview, type SourceInboxPreview } from '../src/ingestion/sourceInbox.ts'
import { dispatchApprovedProductionSource, type ProductionDispatcherOptions, type ProductionIngestionReceipt } from './source-inbox-production-dispatcher.ts'

export interface ProductionConfirmationContent {
  readonly destination: 'Supabase production: /rest/v1/rpc/ingest_source'
  readonly reference: string
  readonly festivalYear: number | null
  readonly evidence: readonly string[]
  readonly warnings: readonly string[]
  readonly facebookAcquisition: 'No Facebook acquisition will occur; only operator-provided local evidence is sent.'
}

export function productionConfirmationContent(preview: SourceInboxPreview): ProductionConfirmationContent {
  return {
    destination: 'Supabase production: /rest/v1/rpc/ingest_source',
    reference: preview.reference.post_url,
    festivalYear: preview.festival_year,
    evidence: [...preview.image_evidence.filter((item) => item.validation === 'accepted').map((item) => `image:${item.sha256}`), ...preview.video_evidence.filter((item) => item.validation === 'accepted').map((item) => `video:${item.sha256}`)],
    warnings: [...preview.analyses.flatMap((item) => item.warnings), ...preview.video_analyses.flatMap((item) => item.warnings)],
    facebookAcquisition: 'No Facebook acquisition will occur; only operator-provided local evidence is sent.',
  }
}

/** The caller must produce this explicit confirmation immediately before the single production request. */
export async function confirmSourceInboxProduction(preview: SourceInboxPreview, confirmation: { readonly confirmProduction: true; readonly confirmOcrReview?: boolean; readonly confirmOfficialBuglasanSource?: boolean }, options: ProductionDispatcherOptions = {}): Promise<ProductionIngestionReceipt> {
  if (confirmation.confirmProduction !== true) throw new Error('Explicit production confirmation is required')
  const payload = approveSourceInboxPreview(preview, (approved) => approved, confirmation)
  return dispatchApprovedProductionSource(payload, options)
}
