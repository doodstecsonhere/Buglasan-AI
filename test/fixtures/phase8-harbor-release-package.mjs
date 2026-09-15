import { HARBOR_REFERENCE_TARGET, selectRegisteredEventReleasePackage } from '../../config/release-package.mjs'

// Fixture alias for the registered reference-only selector.
export const harborReferenceReleasePackage = selectRegisteredEventReleasePackage(HARBOR_REFERENCE_TARGET, { referenceOnlyAcknowledgement: 'reference-only' })
