declare module '*.mjs' {
  export const buglasanFreshnessConfig: {
    readonly deploymentId: string
    readonly identity: {
      readonly assistantName: string
      readonly eventName: string
    }
    readonly freshness: {
      readonly thresholds: {
        readonly agingAfterHours: number
        readonly staleAfterHours: number
      }
      readonly timeZone: string
      readonly dateTimeLocale: string
    }
  }
}
