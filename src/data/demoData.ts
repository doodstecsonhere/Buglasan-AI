/**
 * Buglasan AI - Synthetic Demo Dataset
 *
 * ⚠️  ALL DEMO DATA IS SYNTHETIC AND CLEARLY MARKED. NOT REAL BUGLASAN FESTIVAL INFORMATION. ⚠️
 *
 * Every `Source.rawText` and `Source.normalizedText` below is prefixed with `[DEMO FIXTURE]`
 * to make it obvious the data is fabricated for demonstration purposes only.
 *
 * Each `Event` is linked to one or more backing `Source` records via `demoEventSources`.
 * Demo response generation in `chatService.sendMessageDemo()` derives every factual
 * claim (date, venue, organizer, description) from these sources — never from
 * hard-coded strings inside the events themselves.
 *
 * Real ingestion (Supabase + n8n) will replace this synthetic data with actual
 * official Facebook / website posts. See README.md for the synthetic data disclaimer.
 *
 * Multi-year data with supersession examples for testing year-awareness.
 */

import type { Message, Source, Event, FestivalYear, EventSource } from '../types'
import { getCurrentFestivalYear } from '../utils/dateUtils'

export const currentYear = getCurrentFestivalYear()
export const previousYear = currentYear - 1
export const historicalYear = currentYear - 2

/**
 * Prefix every synthetic source text with this marker.
 * Keeping it as a constant makes it easy to filter / detect demo fixtures later.
 */
const DEMO_PREFIX = '[DEMO FIXTURE]'

/**
 * Helper: produce synthetic source text content prefixed with the demo marker.
 */
function demo(text: string): string {
  return `${DEMO_PREFIX} ${text}`
}

// ----------------------------------------------------------------------------
// Demo Sources with multi-year data and supersession
// Note: `isCurrent` is a derived/computed property derived from `status`.
// Status values: 'active' | 'updated' | 'superseded' | 'cancelled' | 'postponed' | 'archived'
// ----------------------------------------------------------------------------
export const demoSources: Source[] = [
  // ============================================================
  // Current Year (currentYear) - Active sources
  // ============================================================
  {
    id: 'src-current-001',
    platform: 'facebook',
    postId: 'demo_current_schedule_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_schedule_001',
    publishedAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Buglasan Festival currentYear Official Schedule Released! Opening Ceremony Oct 15, Street Dancing Oct 19, Showdown Oct 20, Closing Oct 22. All at Dumaguete Freedom Park except Showdown at Lamberto Macias Sports Complex.'),
    normalizedText: demo('Buglasan Festival currentYear Official Schedule: Opening Ceremony October 15, Street Dancing Competition October 19, Showdown Competition October 20, Closing Ceremony October 22. Venues: Dumaguete Freedom Park (Opening, Closing), Rizal Boulevard (Street Dancing), Lamberto Macias Sports Complex (Showdown).'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
  },
  {
    id: 'src-current-002',
    platform: 'facebook',
    postId: 'demo_current_venue_update_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_venue_update_001',
    publishedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('IMPORTANT UPDATE: Showdown Competition venue changed from Dumaguete Gymnasium to Lamberto Macias Sports Complex for better capacity and facilities. This supersedes previous announcement.'),
    normalizedText: demo('Venue Update: Showdown Competition moved from Dumaguete Gymnasium to Lamberto Macias Sports Complex. Supersedes previous venue announcement.'),
    status: 'updated',
    supersedesSourceId: 'src-current-002-old',
    ingestedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
    updatedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
  },
  {
    id: 'src-current-002-old',
    platform: 'facebook',
    postId: 'demo_current_venue_original',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_venue_original',
    publishedAt: new Date(`${currentYear}-07-01T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Showdown Competition will be held at Dumaguete Gymnasium on October 20.'),
    normalizedText: demo('Showdown Competition venue: Dumaguete Gymnasium, October 20. SUPERSEDED - see updated post.'),
    status: 'superseded',
    ingestedAt: new Date(`${currentYear}-07-01T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
  },
  {
    id: 'src-current-003',
    platform: 'facebook',
    postId: 'demo_current_registration_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_registration_001',
    publishedAt: new Date(`${currentYear}-08-01T11:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Street Dancing Competition registration now OPEN! Deadline: September 30, currentYear. Open to all LGUs, schools, and organizations in Negros Oriental. Contact: buglasandemo@example.test'),
    normalizedText: demo('Street Dancing Competition registration open. Deadline September 30, currentYear. Open to LGUs, schools, organizations in Negros Oriental. Contact: buglasandemo@example.test'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-08-01T11:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-08-01T11:00:00+08:00`),
  },
  {
    id: 'src-current-004',
    platform: 'facebook',
    postId: 'demo_current_food_fair_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_food_fair_001',
    publishedAt: new Date(`${currentYear}-09-10T16:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Buglasan Food Fair currentYear featuring Negros Oriental delicacies: Demo Dish A, Demo Dish B, Demo Dish C, Demo Dish D. Oct 15-22 at Quezon Park. Free admission.'),
    normalizedText: demo('Buglasan Food Fair currentYear at Quezon Park, October 15-22. Features synthetic delicacies: Demo Dish A, Demo Dish B, Demo Dish C, Demo Dish D. Free admission.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-09-10T16:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-09-10T16:00:00+08:00`),
  },

  // ============================================================
  // Dedicated source records for organizers (per event)
  // These back the `organizer` field on each event.
  // ============================================================
  {
    id: 'src-current-organizer-pgov',
    platform: 'official',
    postId: 'demo_current_organizer_pgov',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_organizer_pgov',
    publishedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Organizer announcement: Opening Ceremony, Showdown Competition, and Closing Ceremony are organized by the Provincial Government of Negros Oriental (synthetic demo fixture).'),
    normalizedText: demo('Organizers for Opening Ceremony, Showdown Competition, Closing Ceremony: Provincial Government of Negros Oriental.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
  },
  {
    id: 'src-current-organizer-ptourism',
    platform: 'official',
    postId: 'demo_current_organizer_ptourism',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_organizer_ptourism',
    publishedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Organizer announcement: Street Dancing Competition is organized by the Provincial Tourism Office (synthetic demo fixture).'),
    normalizedText: demo('Organizer for Street Dancing Competition: Provincial Tourism Office.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
  },
  {
    id: 'src-current-organizer-dti',
    platform: 'official',
    postId: 'demo_current_organizer_dti',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_organizer_dti',
    publishedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Organizer announcement: Food Fair is organized by DTI Negros Oriental (synthetic demo fixture).'),
    normalizedText: demo('Organizer for Buglasan Food Fair: DTI Negros Oriental.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-07-15T09:00:00+08:00`),
  },

  // ============================================================
  // Dedicated source records for venues
  // These back the `venue` field on each event.
  // ============================================================
  {
    id: 'src-current-venue-freedom-park',
    platform: 'official',
    postId: 'demo_current_venue_freedom_park',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_venue_freedom_park',
    publishedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Venue confirmation: Dumaguete City Freedom Park will host the Opening Ceremony and Closing Ceremony (synthetic demo fixture).'),
    normalizedText: demo('Venue: Dumaguete City Freedom Park. Hosts: Opening Ceremony, Closing Ceremony.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
  },
  {
    id: 'src-current-venue-rizal-blvd',
    platform: 'official',
    postId: 'demo_current_venue_rizal_blvd',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_venue_rizal_blvd',
    publishedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Venue confirmation: Rizal Boulevard will host the Street Dancing Competition parade route (synthetic demo fixture).'),
    normalizedText: demo('Venue: Rizal Boulevard, Dumaguete City. Hosts: Street Dancing Competition.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
  },
  {
    id: 'src-current-venue-lamberto',
    platform: 'official',
    postId: 'demo_current_venue_lamberto',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_venue_lamberto',
    publishedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Venue confirmation: Lamberto Macias Sports Complex will host the Showdown Competition (synthetic demo fixture, supersedes Dumaguete Gymnasium).'),
    normalizedText: demo('Venue: Lamberto Macias Sports Complex. Hosts: Showdown Competition.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
    updatedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
  },
  {
    id: 'src-current-venue-quezon-park',
    platform: 'official',
    postId: 'demo_current_venue_quezon_park',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_current_venue_quezon_park',
    publishedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
    festivalYear: currentYear,
    rawText: demo('Venue confirmation: Quezon Park, Dumaguete City will host the Food Fair (synthetic demo fixture).'),
    normalizedText: demo('Venue: Quezon Park, Dumaguete City. Hosts: Food Fair.'),
    status: 'active',
    ingestedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-07-20T09:00:00+08:00`),
  },

  // ============================================================
  // Dedicated source for history / meaning
  // ============================================================
  {
    id: 'src-history-meaning',
    platform: 'website',
    postId: 'demo_history_meaning',
    postUrl: 'https://buglasan.example.test/history',
    publishedAt: new Date(`${previousYear}-01-01T00:00:00+08:00`),
    festivalYear: previousYear,
    rawText: demo('Buglasan Festival history: a provincial cultural festival. The synthetic demo name "Buglasan" is used here for illustrative purposes only — real history text will be ingested from official sources.'),
    normalizedText: demo('Buglasan Festival history: provincial cultural festival (synthetic demo fixture). Real history text will be ingested from official sources.'),
    status: 'active', // Historical facts remain current
    ingestedAt: new Date(`${previousYear}-01-01T00:00:00+08:00`),
    updatedAt: new Date(`${previousYear}-01-01T00:00:00+08:00`),
  },

  // ============================================================
  // Previous Year (currentYear - 1) - Historical but some still relevant
  // ============================================================
  {
    id: 'src-previous-001',
    platform: 'facebook',
    postId: 'demo_previous_schedule_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_previous_schedule_001',
    publishedAt: new Date(`${previousYear}-09-01T10:00:00+08:00`),
    festivalYear: previousYear,
    rawText: demo('Buglasan Festival previousYear Schedule: Opening Oct 16, Street Dancing Oct 18, Showdown Oct 19, Closing Oct 21. All at Freedom Park except Showdown at Dumaguete Gymnasium.'),
    normalizedText: demo('Buglasan Festival previousYear Schedule: Opening Ceremony October 16, Street Dancing October 18, Showdown October 19, Closing October 21. Venues: Freedom Park, Rizal Boulevard, Dumaguete Gymnasium.'),
    status: 'archived',
    ingestedAt: new Date(`${previousYear}-09-01T10:00:00+08:00`),
    updatedAt: new Date(`${previousYear}-10-22T20:00:00+08:00`),
  },
  {
    id: 'src-previous-002',
    platform: 'facebook',
    postId: 'demo_previous_highlights_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_previous_highlights_001',
    publishedAt: new Date(`${previousYear}-10-22T20:00:00+08:00`),
    festivalYear: previousYear,
    rawText: demo('Buglasan previousYear highlights (synthetic demo fixture). Festival completed successfully. No real winners or champions are reported here.'),
    normalizedText: demo('Buglasan previousYear Highlights (synthetic demo fixture). Festival completed successfully. Real winners will come from official posts.'),
    status: 'archived',
    ingestedAt: new Date(`${previousYear}-10-22T20:00:00+08:00`),
    updatedAt: new Date(`${previousYear}-10-22T20:00:00+08:00`),
  },

  // ============================================================
  // Historical Year (currentYear - 2) - Archived
  // ============================================================
  {
    id: 'src-historical-001',
    platform: 'facebook',
    postId: 'demo_historical_schedule_001',
    postUrl: 'https://www.facebook.com/Buglasan/posts/demo_historical_schedule_001',
    publishedAt: new Date(`${historicalYear}-09-01T10:00:00+08:00`),
    festivalYear: historicalYear,
    rawText: demo('Buglasan Festival historicalYear (synthetic demo fixture): Opening Oct 17, Street Dancing Oct 19, Showdown Oct 20, Closing Oct 22. Return-to-full-scale synthetic note.'),
    normalizedText: demo('Buglasan Festival historicalYear Schedule (synthetic demo fixture): Opening October 17, Street Dancing October 19, Showdown October 20, Closing October 22.'),
    status: 'archived',
    ingestedAt: new Date(`${historicalYear}-09-01T10:00:00+08:00`),
    updatedAt: new Date(`${historicalYear}-10-22T20:00:00+08:00`),
  },
]

// ----------------------------------------------------------------------------
// Demo Events
//
// IMPORTANT: The fields on Event are still populated for UI convenience (so the
// existing `getCurrentEventsForYear()` etc. helpers and the SourcesCard UI work),
// but every factual claim (venue, organizer, dates) is also covered by a backing
// Source record linked via `demoEventSources` below. The chat service should
// derive response content from those sources — not from the event fields
// directly — to demonstrate evidence grounding.
// ----------------------------------------------------------------------------
// EventStatus: 'scheduled' | 'confirmed' | 'cancelled' | 'postponed' | 'completed'
export const demoEvents: Event[] = [
  // ============================================================
  // Current Year Events
  // ============================================================
  {
    id: 'evt-current-001',
    eventName: 'Opening Ceremony',
    aliases: ['Opening', 'Kickoff', 'Pagsugod'],
    description: 'Grand opening ceremony with cultural performances, dignitaries, and festival declaration (synthetic demo fixture).',
    category: 'ceremony',
    startDatetime: new Date(`${currentYear}-10-15T18:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-15T21:00:00+08:00`),
    venue: 'Dumaguete City Freedom Park',
    organizer: 'Provincial Government of Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free',
    contactInfo: 'demo-tourism@example.test',
    status: 'confirmed',
    festivalYear: currentYear,
    createdAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
  },
  {
    id: 'evt-current-002',
    eventName: 'Street Dancing Competition',
    aliases: ['Street Dancing', 'Sayaw sa Kalsada', 'Parade'],
    description: 'Colorful street dancing parade along Rizal Boulevard with contingents from municipalities (synthetic demo fixture).',
    category: 'parade',
    startDatetime: new Date(`${currentYear}-10-19T08:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-19T12:00:00+08:00`),
    venue: 'Rizal Boulevard, Dumaguete City',
    organizer: 'Provincial Tourism Office',
    deadline: new Date(`${currentYear}-09-30T23:59:00+08:00`),
    eligibility: 'Open to all LGUs, schools, and organizations in Negros Oriental (synthetic demo fixture)',
    fees: 'Free registration',
    contactInfo: 'demo-buglasan@example.test',
    status: 'confirmed',
    festivalYear: currentYear,
    createdAt: new Date(`${currentYear}-08-01T11:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-08-01T11:00:00+08:00`),
  },
  {
    id: 'evt-current-003',
    eventName: 'Showdown Competition',
    aliases: ['Showdown', 'Ritual Showdown', 'Main Competition'],
    description: 'Main festival competition showcasing ritual dances and cultural presentations (synthetic demo fixture).',
    category: 'competition',
    startDatetime: new Date(`${currentYear}-10-20T13:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-20T18:00:00+08:00`),
    venue: 'Lamberto Macias Sports Complex', // Updated venue (supersedes Dumaguete Gymnasium)
    organizer: 'Provincial Government of Negros Oriental',
    deadline: new Date(`${currentYear}-09-30T23:59:00+08:00`),
    eligibility: 'Qualified contingents from Street Dancing (synthetic demo fixture)',
    fees: 'Free',
    contactInfo: 'demo-buglasan@example.test',
    status: 'confirmed',
    festivalYear: currentYear,
    createdAt: new Date(`${currentYear}-07-01T09:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-08-15T14:30:00+08:00`),
  },
  {
    id: 'evt-current-004',
    eventName: 'Closing Ceremony & Fireworks',
    aliases: ['Closing', 'Fireworks', 'Pagpangulo'],
    description: 'Grand closing ceremony with awarding, fireworks display, and thanksgiving (synthetic demo fixture).',
    category: 'ceremony',
    startDatetime: new Date(`${currentYear}-10-22T19:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-22T22:00:00+08:00`),
    venue: 'Dumaguete City Freedom Park',
    organizer: 'Provincial Government of Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free',
    contactInfo: 'demo-tourism@example.test',
    status: 'scheduled',
    festivalYear: currentYear,
    createdAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-09-01T10:00:00+08:00`),
  },
  {
    id: 'evt-current-005',
    eventName: 'Buglasan Food Fair',
    aliases: ['Food Fair', 'Food Festival', 'Pagkaon'],
    description: 'Showcase of synthetic demo delicacies and local food products.',
    category: 'food',
    startDatetime: new Date(`${currentYear}-10-15T10:00:00+08:00`),
    endDatetime: new Date(`${currentYear}-10-22T22:00:00+08:00`),
    venue: 'Quezon Park, Dumaguete City',
    organizer: 'DTI Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free admission',
    contactInfo: 'demo-dti@example.test',
    status: 'confirmed',
    festivalYear: currentYear,
    createdAt: new Date(`${currentYear}-09-10T16:00:00+08:00`),
    updatedAt: new Date(`${currentYear}-09-10T16:00:00+08:00`),
  },

  // ============================================================
  // Previous Year Events (for historical reference)
  // ============================================================
  {
    id: 'evt-previous-001',
    eventName: 'Opening Ceremony',
    aliases: ['Opening', 'Kickoff'],
    description: 'Grand opening ceremony for Buglasan previousYear (synthetic demo fixture).',
    category: 'ceremony',
    startDatetime: new Date(`${previousYear}-10-16T18:00:00+08:00`),
    endDatetime: new Date(`${previousYear}-10-16T21:00:00+08:00`),
    venue: 'Dumaguete City Freedom Park',
    organizer: 'Provincial Government of Negros Oriental',
    deadline: undefined,
    eligibility: undefined,
    fees: 'Free',
    contactInfo: 'demo-tourism@example.test',
    status: 'completed',
    festivalYear: previousYear,
    createdAt: new Date(`${previousYear}-09-01T10:00:00+08:00`),
    updatedAt: new Date(`${previousYear}-10-16T21:00:00+08:00`),
  },
  {
    id: 'evt-previous-003',
    eventName: 'Showdown Competition',
    aliases: ['Showdown', 'Ritual Showdown'],
    description: 'Main competition at Dumaguete Gymnasium (old venue, superseded by current venue change).',
    category: 'competition',
    startDatetime: new Date(`${previousYear}-10-19T13:00:00+08:00`),
    endDatetime: new Date(`${previousYear}-10-19T18:00:00+08:00`),
    venue: 'Dumaguete Gymnasium', // Old venue (previous-year fixture)
    organizer: 'Provincial Government of Negros Oriental',
    deadline: new Date(`${previousYear}-09-30T23:59:00+08:00`),
    eligibility: 'Qualified contingents (synthetic demo fixture)',
    fees: 'Free',
    contactInfo: 'demo-buglasan-prev@example.test',
    status: 'completed',
    festivalYear: previousYear,
    createdAt: new Date(`${previousYear}-07-01T09:00:00+08:00`),
    updatedAt: new Date(`${previousYear}-10-19T18:00:00+08:00`),
  },
]

// ----------------------------------------------------------------------------
// Demo Event-Source mappings
//
// This is the *single source of truth* for "which sources back which event".
// The chat service uses this to derive its factual claims — never the event's
// own hard-coded venue/organizer/description fields — so the demo demonstrates
// the same evidence-grounding principles as production.
//
// Each event is backed by:
//   - at least one schedule/description source
//   - the venue source that backs its `venue` field
//   - the organizer source that backs its `organizer` field
// ----------------------------------------------------------------------------
export const demoEventSources: EventSource[] = [
  // currentYear Opening Ceremony
  { eventId: 'evt-current-001', sourceId: 'src-current-001', relevanceScore: 0.95 },
  { eventId: 'evt-current-001', sourceId: 'src-current-venue-freedom-park', relevanceScore: 0.9 },
  { eventId: 'evt-current-001', sourceId: 'src-current-organizer-pgov', relevanceScore: 0.9 },

  // currentYear Street Dancing
  { eventId: 'evt-current-002', sourceId: 'src-current-001', relevanceScore: 0.9 },
  { eventId: 'evt-current-002', sourceId: 'src-current-003', relevanceScore: 0.95 },
  { eventId: 'evt-current-002', sourceId: 'src-current-venue-rizal-blvd', relevanceScore: 0.9 },
  { eventId: 'evt-current-002', sourceId: 'src-current-organizer-ptourism', relevanceScore: 0.9 },

  // currentYear Showdown — venue-change supersession chain
  { eventId: 'evt-current-003', sourceId: 'src-current-001', relevanceScore: 0.85 },
  { eventId: 'evt-current-003', sourceId: 'src-current-002', relevanceScore: 0.98 }, // Supersession link (current)
  { eventId: 'evt-current-003', sourceId: 'src-current-002-old', relevanceScore: 0.5 }, // Old superseded venue
  { eventId: 'evt-current-003', sourceId: 'src-current-venue-lamberto', relevanceScore: 0.9 },
  { eventId: 'evt-current-003', sourceId: 'src-current-organizer-pgov', relevanceScore: 0.9 },

  // currentYear Closing
  { eventId: 'evt-current-004', sourceId: 'src-current-001', relevanceScore: 0.9 },
  { eventId: 'evt-current-004', sourceId: 'src-current-venue-freedom-park', relevanceScore: 0.9 },
  { eventId: 'evt-current-004', sourceId: 'src-current-organizer-pgov', relevanceScore: 0.9 },

  // currentYear Food Fair
  { eventId: 'evt-current-005', sourceId: 'src-current-004', relevanceScore: 0.95 },
  { eventId: 'evt-current-005', sourceId: 'src-current-venue-quezon-park', relevanceScore: 0.9 },
  { eventId: 'evt-current-005', sourceId: 'src-current-organizer-dti', relevanceScore: 0.9 },

  // previousYear Opening
  { eventId: 'evt-previous-001', sourceId: 'src-previous-001', relevanceScore: 0.95 },

  // previousYear Showdown (old venue)
  { eventId: 'evt-previous-003', sourceId: 'src-previous-001', relevanceScore: 0.9 },
]

// ----------------------------------------------------------------------------
// Demo Messages for initial chat state
// ----------------------------------------------------------------------------
export const demoMessages: Message[] = [
  {
    id: 'msg-welcome',
    role: 'assistant',
    content: `🎉 **Welcome to Buglasan AI!** Your multilingual, year-aware companion for the Buglasan Festival of Negros Oriental.\n\n⚠️ **Demo mode** uses synthetic fixtures clearly marked as [DEMO FIXTURE]. Not real festival information.\n\nI can help you with:\n• 📅 **Festival schedules** for any year\n• 📍 **Venue information** (including updates!)\n• 🎫 **Registration & participation** details\n• 🍽️ **Food fair & cultural exhibits**\n• 📜 **History & significance** of Buglasan\n\n**Current Festival Year: ${currentYear}** (tap the year badge to change)\n\nTry asking: *"What's the schedule for ${currentYear}?"* or *"Where is the Showdown held?"*`,
    timestamp: new Date(),
    festivalYear: currentYear,
  },
]

// ----------------------------------------------------------------------------
// Quick question suggestions
// ----------------------------------------------------------------------------
export const demoQuickQuestions = [
  `What's the schedule for ${currentYear}?`,
  'Where is the Street Dancing held?',
  'Showdown venue for this year?',
  'How to join Street Dancing?',
  'What food at the Food Fair?',
  'What does Buglasan mean?',
  `Schedule for ${previousYear}?`,
  'Venue changes this year?',
  'What events are upcoming?',
  'Tell me about a non-existent topic please',
]

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Detect the `[DEMO FIXTURE]` marker in a source's text. */
export function isDemoFixture(text: string | undefined | null): boolean {
  return !!text && text.includes(DEMO_PREFIX)
}

/** Get sources for a specific year (any status). */
export function getSourcesForYear(year: FestivalYear): Source[] {
  return demoSources.filter(s => s.festivalYear === year)
}

/** Get events for a specific year (any status). */
export function getEventsForYear(year: FestivalYear): Event[] {
  return demoEvents.filter(e => e.festivalYear === year)
}

/** Get current/active sources for a year (derived from status). Excludes superseded, cancelled, archived. */
export function getCurrentSourcesForYear(year: FestivalYear): Source[] {
  return demoSources.filter(s => s.festivalYear === year && ['active', 'updated', 'postponed'].includes(s.status))
}

/** Get current/active events for a year (derived from status). */
export function getCurrentEventsForYear(year: FestivalYear): Event[] {
  return demoEvents.filter(e => e.festivalYear === year && ['scheduled', 'confirmed'].includes(e.status))
}

/** Get all sources that back a specific event via the demoEventSources map. */
export function getSourcesForEvent(eventId: string): Source[] {
  const sourceIds = demoEventSources
    .filter(es => es.eventId === eventId)
    .map(es => es.sourceId)
  return demoSources.filter(s => sourceIds.includes(s.id))
}

/**
 * Get the highest-relevance, non-superseded source(s) for an event.
 * This is what the demo response should treat as "primary evidence".
 */
export function getPrimarySourcesForEvent(eventId: string): Source[] {
  const links = demoEventSources.filter(es => es.eventId === eventId)
  const idToRelevance = new Map(links.map(l => [l.sourceId, l.relevanceScore]))
  return demoSources
    .filter(s => idToRelevance.has(s.id) && s.status !== 'superseded')
    .sort((a, b) => (idToRelevance.get(b.id) ?? 0) - (idToRelevance.get(a.id) ?? 0))
}

/**
 * Get only the venue-backing source for an event (the source whose
 * normalizedText identifies the venue). Falls back to scanning all backing
 * sources for one that mentions "venue".
 */
export function getVenueSourceForEvent(eventId: string): Source | undefined {
  const allBacking = getSourcesForEvent(eventId)
  return allBacking.find(s => s.id.includes('venue-'))
    ?? allBacking.find(s => s.normalizedText.toLowerCase().includes('venue:'))
}

/**
 * Get only the organizer-backing source for an event.
 */
export function getOrganizerSourceForEvent(eventId: string): Source | undefined {
  const allBacking = getSourcesForEvent(eventId)
  return allBacking.find(s => s.id.includes('organizer-'))
    ?? allBacking.find(s => s.normalizedText.toLowerCase().includes('organizer'))
}
