export interface DeploymentBranding {
  readonly product: Readonly<Record<'assistantName' | 'eventName' | 'eventShortName' | 'description' | 'officialUrl' | 'wordmark' | 'avatarPath' | 'avatarAlt', string>>
  readonly deployment: Readonly<Record<'id' | 'storageNamespace' | 'cacheVersion', string>>
  readonly metadata: Readonly<Record<'htmlDescription' | 'socialDescription', string>>
  readonly locale: Readonly<Record<'htmlLanguage' | 'manifestLanguage' | 'openGraphLocale', string>>
  readonly colors: Readonly<Record<'theme' | 'background' | 'offlineTheme', string>>
  readonly pwa: { readonly shortName: string; readonly id: '/'; readonly startUrl: '/'; readonly scope: '/'; readonly display: 'standalone'; readonly orientation: 'portrait'; readonly categories: readonly string[] }
  readonly assets: {
    readonly favicon: { readonly source: string; readonly publicPath: string; readonly mediaType: 'image/svg+xml' }
    readonly logo: { readonly source: string; readonly publicPath: string; readonly width: number; readonly height: number; readonly mediaType: 'image/png' }
    readonly icons: readonly { readonly source: string; readonly publicPath: string; readonly width: number; readonly height: number; readonly purpose: 'any' | 'maskable' }[]
    readonly appleTouchIcon: { readonly source: string; readonly publicPath: string; readonly width: number; readonly height: number; readonly mediaType: 'image/png' }
  }
  readonly offline: Readonly<Record<'symbol' | 'heading' | 'message', string>>
}
export const OUTPUTS: Readonly<Record<string, string>>
export function cacheOwnershipPrefix(config: DeploymentBranding): string
export function cacheName(config: DeploymentBranding): string
export function validateDeploymentBranding(input: unknown): DeploymentBranding
export function validateDeploymentAssets(config: DeploymentBranding, root?: string): Promise<void>
export function renderStaticDeployment(config: DeploymentBranding, root?: string): Promise<Record<string, string>>
export function writeStaticDeployment(config: DeploymentBranding, root: string | undefined, targetRoot: string): Promise<Record<string, string>>
export function staticPwaPlugin(config: DeploymentBranding, root?: string): import('vite').Plugin
