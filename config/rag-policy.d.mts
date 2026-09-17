export interface RagPolicy {
  readonly identity: {
    readonly assistantName: string
    readonly festivalName: string
    readonly description: string
    readonly productStatus: 'unofficial'
    readonly knowledgeStewardship: 'operator-curated'
  }
  readonly regional: { readonly timeZone: string }
  readonly languages: {
    readonly default: string
    readonly supported: readonly { readonly code: string; readonly label: string }[]
  }
  readonly years: { readonly minimum: number; readonly maximum: number; readonly defaultBehavior: 'current-calendar-year' }
  readonly verification: { readonly authority: 'official-source'; readonly label: string; readonly url: string }
  readonly citations: {
    readonly required: true
    readonly platform: string
    readonly host: string
    readonly pagePath: string
    readonly postPathPrefix: string
  }
  readonly chat: { readonly conversationHistoryLimit: number }
}

export const genericRagPrinciples: Readonly<{
  evidence: Readonly<{
    unknownIsNotNo: true
    zeroEvidenceRequiresFallback: true
    exactYearIsolation: true
    supersessionAware: true
    citationsRequired: true
  }>
  provenance: Readonly<{
    operatorCuratedIsNotOfficial: true
    officialSourceDoesNotImplyOfficialProduct: true
  }>
}>
export const canonicalAuthorizedFacebookReelPathPrefix: '/reel/'
export function assertValidRagPolicy(input: unknown): asserts input is RagPolicy
export function defineRagPolicy(input: unknown): RagPolicy
export function assertProductRagParity(product: import('../src/config/productConfig').ProductConfig, policy: RagPolicy): true
export const ragPolicy: RagPolicy
