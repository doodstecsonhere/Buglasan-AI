import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const TEMPLATE_DIRECTORY = 'templates/pwa'
const OUTPUTS = Object.freeze({ 'index.html': 'index.html', 'manifest.webmanifest': 'manifest.webmanifest', 'offline.html': 'offline.html', 'service-worker.js': 'service-worker.js' })
const REQUIRED_KEYS = ['product', 'deployment', 'metadata', 'locale', 'colors', 'pwa', 'assets', 'offline']
const SAFE_PUBLIC_PATH = /^\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/
const SAFE_SOURCE_PATH = /^(?!.*(?:^|\/)\.\.?\/)public\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/
const SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const PNG_SIGNATURE = '89504e470d0a1a0a'

function fail(path, message) { throw new Error(`Invalid deployment branding at ${path}: ${message}`) }
function exactObject(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  const ownKeys = Reflect.ownKeys(value); const missing = keys.find(key => !ownKeys.includes(key)); const extra = ownKeys.find(key => typeof key !== 'string' || !keys.includes(key))
  if (missing) fail(`${path}.${missing}`, 'is required'); if (extra !== undefined) fail(`${path}.${String(extra)}`, 'is not supported'); return value
}
function text(value, path) {
  if (typeof value !== 'string' || value.trim() !== value || !value) fail(path, 'must be a non-empty trimmed string')
  if ([...value].some(character => character.charCodeAt(0) < 32)) fail(path, 'must not contain control characters')
  return value
}
function safeUrl(value, path) {
  text(value, path); let url; try { url = new URL(value) } catch { fail(path, 'must be a valid URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(path, 'must be credential-free HTTPS without query or fragment')
}
function validatePathAsset(asset, path, raster, exact = true) {
  if (exact) exactObject(asset, path, raster ? ['source', 'publicPath', 'width', 'height', 'mediaType'] : ['source', 'publicPath', 'mediaType'])
  if (!SAFE_SOURCE_PATH.test(text(asset.source, `${path}.source`))) fail(`${path}.source`, 'must be a safe path below public/')
  if (!SAFE_PUBLIC_PATH.test(text(asset.publicPath, `${path}.publicPath`))) fail(`${path}.publicPath`, 'must be a safe root-relative path')
  if (raster) for (const key of ['width', 'height']) if (!Number.isInteger(asset[key]) || asset[key] <= 0) fail(`${path}.${key}`, 'must be a positive integer')
}
function cacheOwnershipPrefix(config) { return `${config.deployment.storageNamespace}.${config.deployment.id}.shell-` }
function cacheName(config) { return `${cacheOwnershipPrefix(config)}${config.deployment.cacheVersion}` }
function iconBy(config, predicate, description) { const matches = config.assets.icons.filter(predicate); if (matches.length !== 1) fail('assets.icons', `must contain exactly one ${description} icon`); return matches[0] }

export function validateDeploymentBranding(input) {
  const config = exactObject(input, 'deploymentBranding', REQUIRED_KEYS)
  const product = exactObject(config.product, 'product', ['assistantName', 'eventName', 'eventShortName', 'description', 'officialUrl', 'wordmark', 'avatarPath', 'avatarAlt'])
  Object.keys(product).forEach(key => text(product[key], `product.${key}`)); safeUrl(product.officialUrl, 'product.officialUrl')
  for (const key of ['avatarPath']) if (!SAFE_PUBLIC_PATH.test(product[key])) fail(`product.${key}`, 'must be a safe root-relative path')
  const deployment = exactObject(config.deployment, 'deployment', ['id', 'storageNamespace', 'cacheVersion'])
  Object.keys(deployment).forEach(key => { if (!SAFE_ID.test(text(deployment[key], `deployment.${key}`))) fail(`deployment.${key}`, 'must be a safe lowercase identifier') })
  const metadata = exactObject(config.metadata, 'metadata', ['htmlDescription', 'socialDescription']); Object.keys(metadata).forEach(key => text(metadata[key], `metadata.${key}`))
  const locale = exactObject(config.locale, 'locale', ['htmlLanguage', 'manifestLanguage', 'openGraphLocale']); Object.keys(locale).forEach(key => text(locale[key], `locale.${key}`))
  const colors = exactObject(config.colors, 'colors', ['theme', 'background', 'offlineTheme']); Object.keys(colors).forEach(key => { if (!HEX_COLOR.test(colors[key])) fail(`colors.${key}`, 'must be a six-digit hex color') })
  const pwa = exactObject(config.pwa, 'pwa', ['shortName', 'id', 'startUrl', 'scope', 'display', 'orientation', 'categories'])
  text(pwa.shortName, 'pwa.shortName')
  for (const key of ['id', 'startUrl', 'scope']) if (pwa[key] !== '/') fail(`pwa.${key}`, 'must be root-relative /')
  if (pwa.display !== 'standalone' || pwa.orientation !== 'portrait') fail('pwa', 'must retain standalone portrait behavior')
  if (!Array.isArray(pwa.categories) || !pwa.categories.length || new Set(pwa.categories).size !== pwa.categories.length) fail('pwa.categories', 'must be a non-empty unique array')
  pwa.categories.forEach((category, index) => { if (!/^[a-z][a-z-]*$/.test(category)) fail(`pwa.categories[${index}]`, 'must be a safe lowercase category') })
  const assets = exactObject(config.assets, 'assets', ['favicon', 'logo', 'icons', 'appleTouchIcon'])
  validatePathAsset(assets.favicon, 'assets.favicon', false); if (assets.favicon.mediaType !== 'image/svg+xml') fail('assets.favicon.mediaType', 'must be image/svg+xml')
  validatePathAsset(assets.logo, 'assets.logo', true); validatePathAsset(assets.appleTouchIcon, 'assets.appleTouchIcon', true)
  if (assets.logo.mediaType !== 'image/png' || assets.appleTouchIcon.mediaType !== 'image/png') fail('assets', 'raster assets must be PNG')
  if (!Array.isArray(assets.icons)) fail('assets.icons', 'must be an array')
  assets.icons.forEach((icon, index) => { exactObject(icon, `assets.icons[${index}]`, ['source', 'publicPath', 'width', 'height', 'purpose']); validatePathAsset(icon, `assets.icons[${index}]`, true, false); if (!['any', 'maskable'].includes(icon.purpose)) fail(`assets.icons[${index}].purpose`, 'must be any or maskable') })
  iconBy(config, icon => icon.width === 192 && icon.height === 192 && icon.purpose === 'any', '192x192 any-purpose')
  iconBy(config, icon => icon.width === 512 && icon.height === 512 && icon.purpose === 'any', '512x512 any-purpose')
  iconBy(config, icon => icon.width === 512 && icon.height === 512 && icon.purpose === 'maskable', '512x512 maskable')
  if (assets.appleTouchIcon.width !== 180 || assets.appleTouchIcon.height !== 180) fail('assets.appleTouchIcon', 'must be 180x180')
  if (product.avatarPath !== assets.icons[0].publicPath && product.avatarPath !== assets.logo.publicPath) fail('product.avatarPath', 'must select a declared logo or PWA icon')
  const offline = exactObject(config.offline, 'offline', ['symbol', 'heading', 'message']); Object.keys(offline).forEach(key => text(offline[key], `offline.${key}`))
  if (/demo fixture|api[ _-]?key|client[ _-]?secret|access[ _-]?token|password|private[ _-]?key|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(JSON.stringify(config))) fail('deploymentBranding', 'must not contain demo markers or obvious credential indicators')
  cacheName(config)
  return config
}

async function validatePng(asset, path, root) {
  const source = resolve(root, asset.source); let info; try { info = await stat(source) } catch { fail(`${path}.source`, 'does not exist') }
  if (!info.isFile()) fail(`${path}.source`, 'must be a file'); const bytes = await readFile(source)
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) fail(`${path}.source`, 'must be a PNG file')
  if (bytes.readUInt32BE(16) !== asset.width || bytes.readUInt32BE(20) !== asset.height) fail(`${path}.source`, `must be ${asset.width}x${asset.height}`)
}
export async function validateDeploymentAssets(config, root = process.cwd()) {
  validateDeploymentBranding(config)
  await validatePng(config.assets.logo, 'assets.logo', root); await validatePng(config.assets.appleTouchIcon, 'assets.appleTouchIcon', root)
  for (const [index, icon] of config.assets.icons.entries()) await validatePng(icon, `assets.icons[${index}]`, root)
  let svg; try { svg = await readFile(resolve(root, config.assets.favicon.source), 'utf8') } catch { fail('assets.favicon.source', 'does not exist') }
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(svg) || /<script\b|\bon\w+\s*=|javascript:|data:text\/html|<!DOCTYPE|<!ENTITY/i.test(svg)) fail('assets.favicon.source', 'must be a safe standalone SVG without active content')
}

function html(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function replaceTemplate(template, values, name) {
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => { if (!(key in values)) throw new Error(`Unknown template token ${key} in ${name}`); return values[key] })
  const residue = rendered.match(/\{\{[^}]+\}\}/); if (residue) throw new Error(`Unresolved template token ${residue[0]} in ${name}`); return rendered
}
export async function renderStaticDeployment(config, root = process.cwd()) {
  await validateDeploymentAssets(config, root)
  const icon192 = iconBy(config, icon => icon.width === 192 && icon.height === 192 && icon.purpose === 'any', '192x192 any-purpose')
  const icon512 = iconBy(config, icon => icon.width === 512 && icon.height === 512 && icon.purpose === 'any', '512x512 any-purpose')
  const raw = { HTML_LANGUAGE: config.locale.htmlLanguage, HTML_DESCRIPTION: config.metadata.htmlDescription, THEME_COLOR: config.colors.theme, NAME: config.product.assistantName, EVENT_NAME: config.product.eventName, OFFICIAL_URL: config.product.officialUrl, FAVICON: config.assets.favicon.publicPath, LOGO: config.assets.logo.publicPath, ICON_192: icon192.publicPath, ICON_512: icon512.publicPath, APPLE_TOUCH_ICON: config.assets.appleTouchIcon.publicPath, SOCIAL_DESCRIPTION: config.metadata.socialDescription, OPEN_GRAPH_LOCALE: config.locale.openGraphLocale, OFFLINE_THEME_COLOR: config.colors.offlineTheme, OFFLINE_SYMBOL: config.offline.symbol, OFFLINE_HEADING: config.offline.heading, OFFLINE_MESSAGE: config.offline.message }
  const escaped = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, html(value)]))
  const assetPaths = [config.assets.favicon.publicPath, config.assets.logo.publicPath, ...config.assets.icons.map(icon => icon.publicPath), config.assets.appleTouchIcon.publicPath]
  const appShell = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', ...new Set(assetPaths)]
  const manifest = { name: config.product.assistantName, short_name: config.pwa.shortName, description: config.product.description, id: config.pwa.id, start_url: config.pwa.startUrl, scope: config.pwa.scope, display: config.pwa.display, background_color: config.colors.background, theme_color: config.colors.theme, orientation: config.pwa.orientation, icons: config.assets.icons.map(icon => ({ src: icon.publicPath, sizes: `${icon.width}x${icon.height}`, type: 'image/png', purpose: icon.purpose })), categories: config.pwa.categories, lang: config.locale.manifestLanguage, dir: 'ltr' }
  const quoteJavaScript = value => JSON.stringify(value)
  const load = name => readFile(resolve(root, TEMPLATE_DIRECTORY, name), 'utf8')
  return { 'index.html': replaceTemplate(await load('index.html'), escaped, 'index.html'), 'manifest.webmanifest': `${JSON.stringify(manifest, null, 2)}\n`, 'offline.html': replaceTemplate(await load('offline.html'), escaped, 'offline.html'), 'service-worker.js': replaceTemplate(await load('service-worker.js.template'), { CACHE_OWNERSHIP_PREFIX_JSON: quoteJavaScript(cacheOwnershipPrefix(config)), CACHE_NAME_JSON: quoteJavaScript(cacheName(config)), APP_SHELL_JSON: JSON.stringify(appShell, null, 2) }, 'service-worker.js') }
}
export async function writeStaticDeployment(config, root = process.cwd(), targetRoot) {
  if (!targetRoot) throw new Error('A dedicated ignored/build targetRoot is required; source output is forbidden')
  const rendered = await renderStaticDeployment(config, root)
  for (const [name, content] of Object.entries(rendered)) { const target = resolve(targetRoot, OUTPUTS[name]); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, 'utf8') }
  return rendered
}
export function staticPwaPlugin(config, root = process.cwd()) {
  let rendered
  return {
    name: 'validated-static-pwa-branding',
    async configResolved(viteConfig) { if (viteConfig.command === 'build') rendered = await renderStaticDeployment(config, root) },
    transformIndexHtml: { order: 'pre', async handler() { return (rendered ?? await renderStaticDeployment(config, root))['index.html'] } },
    generateBundle() { for (const name of ['manifest.webmanifest', 'offline.html', 'service-worker.js']) this.emitFile({ type: 'asset', fileName: OUTPUTS[name], source: rendered[name] }) },
  }
}
export { OUTPUTS, cacheName, cacheOwnershipPrefix }
