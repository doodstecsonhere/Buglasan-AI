/**
 * Buglasan AI - Synthetic Demo Dataset
 * Multi-year data with supersession examples for testing year-awareness
 */

import type { Message, Source, Event, FestivalYear } from '../types'
import { getCurrentFestivalYear } from '../utils/dateUtils'

export const currentYear = getCurrentFestivalYear()
export const previousYear = currentYear - 1
export const historicalYear = currentYear - 2

// Demo Sources with multi-year data and supersession
export const demoSources: Source[] = [
  // Current Year (2026) - Active sources
  {
    id: 'src-2026-001',
    platform: 'facebook',
    postId: 'buglasan_2026_schedule_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2026001',
    publishedAt: new Date('2026-09-01T10:00:00+08:00'),
    festivalYear: currentYear,
    rawText: 'Buglasan Festival 2026 Official Schedule Released! 🎉 Opening Ceremony Oct 15, Street Dancing Oct 19, Showdown Oct 20, Closing Oct 22. All at Dumaguete Freedom Park except Showdown at Lamberto Macias Sports Complex.',
    normalizedText: 'Buglasan Festival 2026 Official Schedule: Opening Ceremony October 15, Street Dancing Competition October 19, Showdown Competition October 20, Closing Ceremony October 22. Venues: Dumaguete Freedom Park (Opening, Closing), Rizal Boulevard (Street Dancing), Lamberto Macias Sports Complex (Showdown).',
    isCurrent: true,
    status: 'active',
    ingestedAt: new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: new Date('2026-09-01T10:00:00+08:00'),
  },
  {
    id: 'src-2026-002',
    platform: 'facebook',
    postId: 'buglasan_2026_venue_update_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2026002',
    publishedAt: new Date('2026-08-15T14:30:00+08:00'),
    festivalYear: currentYear,
    rawText: 'IMPORTANT UPDATE: Showdown Competition venue changed from Dumaguete Gymnasium to Lamberto Macias Sports Complex for better capacity and facilities. This supersedes previous announcement.',
    normalizedText: 'Venue Update: Showdown Competition moved from Dumaguete Gymnasium to Lamberto Macias Sports Complex. Supersedes previous venue announcement.',
    isCurrent: true,
    status: 'active',
    supersedesSourceId: 'src-2026-002-old',
    ingestedAt: new Date('2026-08-15T14:30:00+08:00'),
    updatedAt: new Date('2026-08-15T14:30:00+08:00'),
  },
  {
    id: 'src-2026-002-old',
    platform: 'facebook',
    postId: 'buglasan_2026_venue_original',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2026002_old',
    publishedAt: new Date('2026-07-01T09:00:00+08:00'),
    festivalYear: currentYear,
    rawText: 'Showdown Competition will be held at Dumaguete Gymnasium on October 20.',
    normalizedText: 'Showdown Competition venue: Dumaguete Gymnasium, October 20. SUPERSEDED - see updated post.',
    isCurrent: false,
    status: 'superseded',
    ingestedAt: new Date('2026-07-01T09:00:00+08:00'),
    updatedAt: new Date('2026-08-15T14:30:00+08:00'),
  },
  {
    id: 'src-2026-003',
    platform: 'facebook',
    postId: 'buglasan_2026_registration_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2026003',
    publishedAt: new Date('2026-08-01T11:00:00+08:00'),
    festivalYear: currentYear,
    rawText: 'Street Dancing Competition registration now OPEN! Deadline: September 30, 2026. Open to all LGUs, schools, and organizations in Negros Oriental. Contact: buglasan2026@negor.gov.ph',
    normalizedText: 'Street Dancing Competition registration open. Deadline September 30, 2026. Open to LGUs, schools, organizations in Negros Oriental. Contact: buglasan2026@negor.gov.ph',
    isCurrent: true,
    status: 'active',
    ingestedAt: new Date('2026-08-01T11:00:00+08:00'),
    updatedAt: new Date('2026-08-01T11:00:00+08:00'),
  },
  {
    id: 'src-2026-004',
    platform: 'facebook',
    postId: 'buglasan_2026_food_fair_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2026004',
    publishedAt: new Date('2026-09-10T16:00:00+08:00'),
    festivalYear: currentYear,
    rawText: 'Buglasan Food Fair 2026 featuring Negros Oriental delicacies: Budbod Kabog, Silvanas, Piaya, Buko Pie, and more! Oct 15-22 at Quezon Park. Free admission.',
    normalizedText: 'Buglasan Food Fair 2026 at Quezon Park, October 15-22. Features local delicacies: Budbod Kabog, Silvanas, Piaya, Buko Pie. Free admission.',
    isCurrent: true,
    status: 'active',
    ingestedAt: new Date('2026-09-10T16:00:00+08:00'),
    updatedAt: new Date('2026-09-10T16:00:00+08:00'),
  },

  // Previous Year (2025) - Historical but some still relevant
  {
    id: 'src-2025-001',
    platform: 'facebook',
    postId: 'buglasan_2025_schedule_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2025001',
    publishedAt: new Date('2025-09-01T10:00:00+08:00'),
    festivalYear: previousYear,
    rawText: 'Buglasan Festival 2025 Schedule: Opening Oct 16, Street Dancing Oct 18, Showdown Oct 19, Closing Oct 21. All at Freedom Park except Showdown at Dumaguete Gymnasium.',
    normalizedText: 'Buglasan Festival 2025 Schedule: Opening Ceremony October 16, Street Dancing October 18, Showdown October 19, Closing October 21. Venues: Freedom Park, Rizal Boulevard, Dumaguete Gymnasium.',
    isCurrent: false,
    status: 'archived',
    ingestedAt: new Date('2025-09-01T10:00:00+08:00'),
    updatedAt: new Date('2025-10-22T20:00:00+08:00'),
  },
  {
    id: 'src-2025-002',
    platform: 'facebook',
    postId: 'buglasan_2025_highlights_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2025002',
    publishedAt: new Date('2025-10-22T20:00:00+08:00'),
    festivalYear: previousYear,
    rawText: 'What an amazing Buglasan 2025! Congratulations to Bindoy LGU for winning Street Dancing Grand Champion! Bayawan City took Showdown crown. See you next year!',
    normalizedText: 'Buglasan 2025 Results: Street Dancing Grand Champion - Bindoy LGU. Showdown Champion - Bayawan City. Festival completed successfully.',
    isCurrent: false,
    status: 'archived',
    ingestedAt: new Date('2025-10-22T20:00:00+08:00'),
    updatedAt: new Date('2025-10-22T20:00:00+08:00'),
  },
  {
    id: 'src-2025-003',
    platform: 'website',
    postId: 'buglasan_2025_history',
    postUrl: 'https://buglasan.negor.gov.ph/history',
    publishedAt: new Date('2025-01-01T00:00:00+08:00'),
    festivalYear: previousYear,
    rawText: 'Buglasan Festival originated in 1981 as a harvest thanksgiving celebration. "Buglas" means to scatter or sprinkle in Visayan. Became official provincial festival in 2002.',
    normalizedText: 'Buglasan Festival history: Originated 1981 as harvest thanksgiving. "Buglas" = scatter/sprinkle in Visayan. Official provincial festival since 2002.',
    isCurrent: true, // Historical facts remain current
    status: 'active',
    ingestedAt: new Date('2025-01-01T00:00:00+08:00'),
    updatedAt: new Date('2025-01-01T00:00:00+08:00'),
  },

  // Historical Year (2024) - Archived
  {
    id: 'src-2024-001',
    platform: 'facebook',
    postId: 'buglasan_2024_schedule_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/2024001',
    publishedAt: new Date('2024-09-01T10:00:00+08:00'),
    festivalYear: historicalYear,
    rawText: 'Buglasan Festival 2024: Opening Oct 17, Street Dancing Oct 19, Showdown Oct 20, Closing Oct 22. Post-pandemic return to full scale!',
    normalizedText: 'Buglasan Festival 2024 Schedule: Opening October 17, Street Dancing October 19, Showdown October 20, Closing October 22. Full scale return after pandemic.',
    isCurrent: false,
    status: 'archived',
    ingestedAt: new Date('2024-09-01T10:00:00+08:00'),
    updatedAt: new Date('2024-10-22T20:00:00+08:00'),
  },
]

// Demo Events with multi-year data
export const demoEvents: Event[] = [
  // Current Year Events
  {
    id: 'evt-2026-001',
    eventName: 'Opening Ceremony',
    aliases: ['Opening', 'Kickoff', 'Pagsugod'],
    description: 'Grand opening ceremony with cultural performances, dignitaries, and festival declaration',
    category: 'ceremony',
    startDatetime: new Date(`${currentYear}-10-15T18:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-15T21:00:00+08:00`),
    venue: 'Dumaguete City Freedom Park',
    organizer: 'Provincial Government of Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free',
    contactInfo: 'tourism@negor.gov.ph',
    status: 'confirmed',
    isCurrent: true,
    festivalYear: currentYear,
    createdAt: new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: new Date('2026-09-01T10:00:00+08:00'),
  },
  {
    id: 'evt-2026-002',
    eventName: 'Street Dancing Competition',
    aliases: ['Street Dancing', 'Sayaw sa Kalsada', 'Parade'],
    description: 'Colorful street dancing parade along Rizal Boulevard with contingents from municipalities',
    category: 'parade',
    startDatetime: new Date(`${currentYear}-10-19T08:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-19T12:00:00+08:00`),
    venue: 'Rizal Boulevard, Dumaguete City',
    organizer: 'Provincial Tourism Office',
    deadline: new Date(`${currentYear}-09-30T23:59:00+08:00`),
    eligibility: 'Open to all LGUs, schools, and organizations in Negros Oriental',
    fees: 'Free registration',
    contactInfo: 'buglasan2026@negor.gov.ph',
    status: 'confirmed',
    isCurrent: true,
    festivalYear: currentYear,
    createdAt: new Date('2026-08-01T11:00:00+08:00'),
    updatedAt: new Date('2026-08-01T11:00:00+08:00'),
  },
  {
    id: 'evt-2026-003',
    eventName: 'Showdown Competition',
    aliases: ['Showdown', 'Ritual Showdown', 'Main Competition'],
    description: 'Main festival competition showcasing ritual dances and cultural presentations',
    category: 'competition',
    startDatetime: new Date(`${currentYear}-10-20T13:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-20T18:00:00+08:00`),
    venue: 'Lamberto Macias Sports Complex', // Updated venue
    organizer: 'Provincial Government of Negros Oriental',
    deadline: new Date(`${currentYear}-09-30T23:59:00+08:00`),
    eligibility: 'Qualified contingents from Street Dancing',
    fees: 'Free',
    contactInfo: 'buglasan2026@negor.gov.ph',
    status: 'confirmed',
    isCurrent: true,
    festivalYear: currentYear,
    createdAt: new Date('2026-07-01T09:00:00+08:00'),
    updatedAt: new Date('2026-08-15T14:30:00+08:00'),
  },
  {
    id: 'evt-2026-004',
    eventName: 'Closing Ceremony & Fireworks',
    aliases: ['Closing', 'Fireworks', 'Pagpangulo'],
    description: 'Grand closing ceremony with awarding, fireworks display, and thanksgiving',
    category: 'ceremony',
    startDatetime: new Date(`${currentYear}-10-22T19:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-22T22:00:00+08:00`),
    venue: 'Dumaguete City Freedom Park',
    organizer: 'Provincial Government of Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free',
    contactInfo: 'tourism@negor.gov.ph',
    status: 'scheduled',
    isCurrent: true,
    festivalYear: currentYear,
    createdAt: new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: new Date('2026-09-01T10:00:00+08:00'),
  },
  {
    id: 'evt-2026-005',
    eventName: 'Buglasan Food Fair',
    aliases: ['Food Fair', 'Food Festival', 'Pagkaon'],
    description: 'Showcase of Negros Oriental delicacies and local food products',
    category: 'food',
    startDatetime: new Date(`${currentYear}-10-15T10:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-22T22:00:00+08:00`),
    venue: 'Quezon Park, Dumaguete City',
    organizer: 'DTI Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free admission',
    contactInfo: 'dti.negor@dti.gov.ph',
    status: 'confirmed',
    isCurrent: true,
    festivalYear: currentYear,
    createdAt: new Date('2026-09-10T16:00:00+08:00'),
    updatedAt: new Date('2026-09-10T16:00:00+08:00'),
  },

  // Previous Year Events (for historical reference)
  {
    id: 'evt-2025-001',
    eventName: 'Opening Ceremony',
    aliases: ['Opening', 'Kickoff'],
    description: 'Grand opening ceremony for Buglasan 2025',
    category: 'ceremony',
    startDatetime: new Date(`${previousYear}-10-16T18:00:00+08:00`),
    endDatetime: new Date(`${previousYear}-10-16T21:00:00+08:00`),
    venue: 'Dumaguete City Freedom Park',
    organizer: 'Provincial Government of Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free',
    contactInfo: 'tourism@negor.gov.ph',
    status: 'completed',
    isCurrent: false,
    festivalYear: previousYear,
    createdAt: new Date('2025-09-01T10:00:00+08:00'),
    updatedAt: new Date('2025-10-16T21:00:00+08:00'),
  },
  {
    id: 'evt-2025-003',
    eventName: 'Showdown Competition',
    aliases: ['Showdown', 'Ritual Showdown'],
    description: 'Main competition at Dumaguete Gymnasium (old venue)',
    category: 'competition',
    startDatetime: new Date(`${previousYear}-10-19T13:00:00+08:00`),
    endDatetime: new Date(`${previousYear}-10-19T18:00:00+08:00`),
    venue: 'Dumaguete Gymnasium', // Old venue
    organizer: 'Provincial Government of Negros Oriental',
    deadline: new Date(`${previousYear}-09-30T23:59:00+08:00`),
    eligibility: 'Qualified contingents',
    fees: 'Free',
    contactInfo: 'buglasan2025@negor.gov.ph',
    status: 'completed',
    isCurrent: false,
    festivalYear: previousYear,
    createdAt: new Date('2025-07-01T09:00:00+08:00'),
    updatedAt: new Date('2025-10-19T18:00:00+08:00'),
  },
]

// Demo Messages for initial chat state
export const demoMessages: Message[] = [
  {
    id: 'msg-welcome',
    role: 'assistant',
    content: `🎉 **Welcome to Buglasan AI!** Your multilingual, year-aware companion for the Buglasan Festival of Negros Oriental.\n\nI can help you with:\n• 📅 **Festival schedules** for any year\n• 📍 **Venue information** (including updates!)\n• 🎫 **Registration & participation** details\n• 🍽️ **Food fair & cultural exhibits**\n• 📜 **History & significance** of Buglasan\n\n**Current Festival Year: ${currentYear}** (tap the year badge to change)\n\nTry asking: *"What's the schedule for ${currentYear}?"* or *"Where is the Showdown held?"*`,
    timestamp: new Date(),
    festivalYear: currentYear,
  },
]

// Quick question suggestions
export const demoQuickQuestions = [
  `What's the schedule for ${currentYear}?`,
  'Where is the Street Dancing held?',
  'Showdown venue for this year?',
  'How to join Street Dancing?',
  'What food at the Food Fair?',
  'What does Buglasan mean?',
  `Schedule for ${previousYear}?`,
  'Venue changes this year?',
]

// Demo Event-Source mappings
export const demoEventSources = [
  { eventId: 'evt-2026-001', sourceId: 'src-2026-001', relevanceScore: 0.95 },
  { eventId: 'evt-2026-002', sourceId: 'src-2026-001', relevanceScore: 0.9 },
  { eventId: 'evt-2026-003', sourceId: 'src-2026-001', relevanceScore: 0.85 },
  { eventId: 'evt-2026-003', sourceId: 'src-2026-002', relevanceScore: 0.98 }, // Supersession link
  { eventId: 'evt-2026-004', sourceId: 'src-2026-001', relevanceScore: 0.9 },
  { eventId: 'evt-2026-005', sourceId: 'src-2026-004', relevanceScore: 0.95 },
  { eventId: 'evt-2025-001', sourceId: 'src-2025-001', relevanceScore: 0.95 },
  { eventId: 'evt-2025-003', sourceId: 'src-2025-001', relevanceScore: 0.9 },
]

// Helper to get sources for a specific year
export function getSourcesForYear(year: FestivalYear): Source[] {
  return demoSources.filter(s => s.festivalYear === year)
}

// Helper to get events for a specific year
export function getEventsForYear(year: FestivalYear): Event[] {
  return demoEvents.filter(e => e.festivalYear === year)
}

// Helper to get current/active sources for a year
export function getCurrentSourcesForYear(year: FestivalYear): Source[] {
  return demoSources.filter(s => s.festivalYear === year && s.isCurrent && s.status === 'active')
}

// Helper to get current/active events for a year
export function getCurrentEventsForYear(year: FestivalYear): Event[] {
  return demoEvents.filter(e => e.festivalYear === year && e.isCurrent && e.status !== 'cancelled')
}