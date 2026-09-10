export const INSTALL_DISMISSED_STORAGE_KEY = 'buglasan-install-dismissed'

export function readInstallDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(INSTALL_DISMISSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeInstallDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_STORAGE_KEY, '1')
  } catch {
    // Storage may be disabled or unavailable. The in-memory state still hides the prompt.
  }
}
