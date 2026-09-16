import { describe, expect, it, vi } from 'vitest'
import { analyzeSourceInbox, deterministicLocalImageProvider } from '../src/ingestion/sourceInbox.ts'
import { confirmSourceInboxProduction, productionConfirmationContent } from './source-inbox-production.ts'
import { dispatchApprovedProductionSource, ProductionIngestionError } from './source-inbox-production-dispatcher.ts'

const payload = { platform: 'facebook', post_id: 'source-inbox-test', post_url: 'https://www.facebook.com/Buglasan/posts/123', published_at: null, post_year: null, festival_year: 2026, raw_text: null, normalized_text: null, title: null, source_type: 'image', media_urls: [], collected_at: '2026-01-01T00:00:00.000Z', collection_method: 'manual', source_metadata: { source_inbox: {} } } as const
const acknowledgement = [{ source_id: '123e4567-e89b-42d3-a456-426614174000', post_id: payload.post_id, operation: 'inserted', changed: true }]

describe('controlled production source dispatcher', () => {
  it('posts exactly the canonical payload to the fixed service-role RPC and maps acknowledgements', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(acknowledgement), { status: 200 }))
    await expect(dispatchApprovedProductionSource(payload, { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'secret', fetch })).resolves.toEqual({ status: 'new', sourceId: acknowledgement[0].source_id, postId: payload.post_id })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://project.supabase.co/rest/v1/rpc/ingest_source', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ apikey: 'secret', authorization: 'Bearer secret' }), body: JSON.stringify({ p_payload: payload }) }))
  })

  it.each([['updated', true, 'updated'], ['unchanged', false, 'idempotent no-op']])('maps %s safely', async (operation, changed, status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ ...acknowledgement[0], operation, changed }]), { status: 200 }))
    await expect(dispatchApprovedProductionSource(payload, { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'secret', fetch })).resolves.toMatchObject({ status })
  })

  it('fails closed for configuration, malformed acknowledgements, and transport failures without retry', async () => {
    await expect(dispatchApprovedProductionSource(payload, { supabaseSecretKey: 'secret' })).rejects.toThrow('SUPABASE_URL')
    const malformed = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ ...acknowledgement[0], operation: 'inserted', changed: false }]), { status: 200 }))
    await expect(dispatchApprovedProductionSource(payload, { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'secret', fetch: malformed })).rejects.toBeInstanceOf(ProductionIngestionError)
    const offline = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(dispatchApprovedProductionSource(payload, { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'secret', fetch: offline })).rejects.toThrow('could not reach')
    expect(offline).toHaveBeenCalledTimes(1)
  })

  it('requires separate production confirmation and preserves provenance and media guards', async () => {
    const preview = await analyzeSourceInbox({ facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/123', images: [{ name: 'poster.png', mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }], collectedAt: '2026-01-01T00:00:00.000Z', festivalYear: 2026 }, deterministicLocalImageProvider)
    expect(productionConfirmationContent(preview)).toMatchObject({ reference: preview.reference.post_url, festivalYear: 2026, facebookAcquisition: expect.stringMatching(/No Facebook acquisition/) })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify([{ ...acknowledgement[0], post_id: (JSON.parse(String(init?.body)) as { p_payload: { post_id: string } }).p_payload.post_id }]), { status: 200 }))
    await expect(confirmSourceInboxProduction(preview, { confirmProduction: true }, { supabaseUrl: 'https://project.supabase.co', supabaseSecretKey: 'secret', fetch: fetchMock as unknown as typeof globalThis.fetch })).resolves.toMatchObject({ status: 'new' })
    expect(fetchMock.mock.calls[0][1]?.body).toContain('source_inbox')
  })
})
