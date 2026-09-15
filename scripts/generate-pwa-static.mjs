import { deploymentBranding } from '../config/deployment-branding.mjs'
import { writeStaticDeployment } from '../build/pwa-static.mjs'

const targetRoot = process.argv[2] || 'dist/pwa-static'
await writeStaticDeployment(deploymentBranding, process.cwd(), targetRoot)
console.log(`Generated and validated static PWA branding in ${targetRoot}`)
