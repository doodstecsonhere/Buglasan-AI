/**
 * Buglasan AI - Date & Year Utilities
 * Timezone-aware date resolution for Asia/Manila
 * Festival year resolution with explicit query override
 */

import type { FestivalYear, DateResolution, YearResolution } from '../types'

// Timezone constant for Philippines
export const PH_TIMEZONE = 'Asia/Manila'

/**
 * Get current date in Asia/Manila timezone
 */
export function getCurrentDateInPH(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: PH_TIMEZONE }))
}

/**
 * Get current festival year based on Asia/Manila current date
 * Buglasan Festival typically happens in October
 * Defaults to CURRENT CALENDAR YEAR in Asia/Manila ALWAYS.
 * Festival occurs in October but year does NOT advance early.
 *
 * Examples:
 * - September 2026 → default 2026
 * - October 2026 → default 2026 (NOT 2027)
 * - November 2026 → default 2026
 * - January 2027 → default 2027
 */
export function getCurrentFestivalYear(): FestivalYear {
  const now = getCurrentDateInPH()
  const currentYear = now.getFullYear()
  
  // Always return current calendar year in Asia/Manila
  // Festival year does not advance early (e.g., October doesn't mean next year)
  return currentYear
}

/**
 * Resolve festival year from user query
 * Priority: explicit year in query > current festival year
 */
export function resolveFestivalYear(query: string, defaultYear?: FestivalYear): YearResolution {
  const currentYear = defaultYear ?? getCurrentFestivalYear()
  
  // Pattern to match explicit year mentions (2024, 2025, 2026, etc.)
  const yearPatterns = [
    /\b(20\d{2})\b/g,  // Matches 2020-2099
    /\b(year\s+20\d{2})\b/gi,
    /\b(festival\s+20\d{2})\b/gi,
    /\b(buglasan\s+20\d{2})\b/gi,
  ]
  
  for (const pattern of yearPatterns) {
    const matches = query.match(pattern)
    if (matches) {
      // Extract the year number from the first match
      const yearMatch = matches[0].match(/\d{4}/)
      if (yearMatch) {
        const explicitYear = parseInt(yearMatch[0], 10)
        // Validate reasonable range
        if (explicitYear >= 2020 && explicitYear <= 2030) {
          return {
            festivalYear: explicitYear,
            isExplicit: true,
            originalExpression: matches[0],
          }
        }
      }
    }
  }
  
  // Check for relative year references
  const relativePatterns = [
    { pattern: /\b(last|previous|past)\s+year\b/i, offset: -1 },
    { pattern: /\b(next|upcoming|coming)\s+year\b/i, offset: 1 },
    { pattern: /\b(this|current)\s+year\b/i, offset: 0 },
  ]
  
  for (const { pattern, offset } of relativePatterns) {
    if (pattern.test(query)) {
      return {
        festivalYear: currentYear + offset,
        isExplicit: true,
        originalExpression: query.match(pattern)?.[0],
      }
    }
  }
  
  return {
    festivalYear: currentYear,
    isExplicit: false,
  }
}

/**
 * Resolve relative date expressions in Asia/Manila timezone
 * Handles: today, tomorrow, yesterday, this weekend, upcoming, etc.
 */
export function resolveRelativeDate(expression: string, referenceDate?: Date): DateResolution {
  const ref = referenceDate ?? getCurrentDateInPH()
  const lowerExpr = expression.toLowerCase().trim()
  
  const today = new Date(ref)
  today.setHours(0, 0, 0, 0)
  
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  // This weekend (Saturday and Sunday)
  const dayOfWeek = today.getDay() // 0 = Sunday, 6 = Saturday
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7
  const thisSaturday = new Date(today)
  thisSaturday.setDate(today.getDate() + (daysUntilSaturday || 7))
  const thisSunday = new Date(thisSaturday)
  thisSunday.setDate(thisSunday.getDate() + 1)
  
  // Next weekend
  const nextSaturday = new Date(thisSaturday)
  nextSaturday.setDate(nextSaturday.getDate() + 7)
  const nextSunday = new Date(nextSaturday)
  nextSunday.setDate(nextSunday.getDate() + 1)
  
  const patterns: Array<{ regex: RegExp; resolver: () => Date; confidence: number }> = [
    { regex: /\b(today|now)\b/i, resolver: () => today, confidence: 1.0 },
    { regex: /\b(tomorrow|tmrw)\b/i, resolver: () => tomorrow, confidence: 1.0 },
    { regex: /\b(yesterday|ystdy)\b/i, resolver: () => yesterday, confidence: 1.0 },
    { regex: /\b(this\s+weekend|weekend)\b/i, resolver: () => thisSaturday, confidence: 0.9 },
    { regex: /\b(next\s+weekend)\b/i, resolver: () => nextSaturday, confidence: 0.9 },
    { regex: /\b(upcoming|coming|soon)\b/i, resolver: () => tomorrow, confidence: 0.7 },
    { regex: /\b(this\s+week)\b/i, resolver: () => today, confidence: 0.8 },
    { regex: /\b(next\s+week)\b/i, resolver: () => {
      const nextWeek = new Date(today)
      nextWeek.setDate(today.getDate() + 7)
      return nextWeek
    }, confidence: 0.8 },
  ]
  
  for (const { regex, resolver, confidence } of patterns) {
    if (regex.test(lowerExpr)) {
      return {
        resolvedDate: resolver(),
        isRelative: true,
        originalExpression: expression,
        confidence,
      }
    }
  }
  
  // Try parsing specific date formats
  const datePatterns = [
    // MM/DD/YYYY or MM/DD/YY
    { regex: /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, confidence: 0.95 },
    // Month DD, YYYY
    { regex: /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s*(\d{4})?/i, confidence: 0.9 },
    // DD Month YYYY
    { regex: /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})?/i, confidence: 0.9 },
  ]
  
  for (const { regex, confidence } of datePatterns) {
    const match = lowerExpr.match(regex)
    if (match) {
      try {
        const parsed = new Date(expression)
        if (!isNaN(parsed.getTime())) {
          return {
            resolvedDate: parsed,
            isRelative: false,
            originalExpression: expression,
            confidence,
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
  
  // Default: return reference date with low confidence
  return {
    resolvedDate: ref,
    isRelative: false,
    originalExpression: expression,
    confidence: 0.1,
  }
}

/**
 * Check if a date falls within a festival year's typical date range
 * Buglasan Festival: typically mid-October (15th-25th)
 */
export function isDateInFestivalRange(date: Date, festivalYear: FestivalYear): boolean {
  const festivalStart = new Date(festivalYear, 9, 15) // October 15
  const festivalEnd = new Date(festivalYear, 9, 25)   // October 25
  
  const checkDate = new Date(date)
  checkDate.setHours(0, 0, 0, 0)
  
  return checkDate >= festivalStart && checkDate <= festivalEnd
}

/**
 * Get festival date range for a given year
 */
export function getFestivalDateRange(festivalYear: FestivalYear): { start: Date; end: Date } {
  return {
    start: new Date(festivalYear, 9, 15), // October 15
    end: new Date(festivalYear, 9, 25),   // October 25
  }
}

/**
 * Format date for display in Philippine context
 */
export function formatPHDate(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: PH_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }
  
  return new Intl.DateTimeFormat('en-PH', defaultOptions).format(date)
}

/**
 * Format date relative to now (e.g., "2 days ago", "in 3 days")
 */
export function formatRelativeTime(date: Date, referenceDate?: Date): string {
  const ref = referenceDate ?? getCurrentDateInPH()
  const diffMs = date.getTime() - ref.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === -1) return 'yesterday'
  if (diffDays > 0 && diffDays <= 7) return `in ${diffDays} days`
  if (diffDays < 0 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`
  
  return formatPHDate(date)
}

/**
 * Check if a source/event is current for the given festival year
 */
export function isCurrentForYear(item: { festivalYear: FestivalYear | null; isCurrent: boolean }, targetYear: FestivalYear): boolean {
  return item.festivalYear === targetYear && item.isCurrent
}

/**
 * Sort sources by relevance: current year first, then by recency, prefer non-superseded
 */
export function sortSourcesByRelevance(
  sources: Array<{ festivalYear: FestivalYear | null; isCurrent: boolean; status: string; publishedAt: Date | null; supersedesSourceId?: string }>,
  targetYear: FestivalYear
): typeof sources {
  return [...sources].sort((a, b) => {
    // Primary: current year sources first
    const aCurrentYear = a.festivalYear === targetYear
    const bCurrentYear = b.festivalYear === targetYear
    if (aCurrentYear !== bCurrentYear) return bCurrentYear ? 1 : -1
    
    // Secondary: current/non-superseded first
    const aActive = a.isCurrent && a.status === 'active'
    const bActive = b.isCurrent && b.status === 'active'
    if (aActive !== bActive) return bActive ? 1 : -1
    
    // Tertiary: more recent first
    return (b.publishedAt ? new Date(b.publishedAt).getTime() : 0) - (a.publishedAt ? new Date(a.publishedAt).getTime() : 0)
  })
}
