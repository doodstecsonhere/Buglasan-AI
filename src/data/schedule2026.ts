// src/data/schedule2026.ts
// SOURCE: official Buglasan 2026 schedule graphics (11 days, 45 events).
// Transcribed manually. Times are 24h, Asia/Manila (UTC+8).
// NOTE: source graphics print a '2025' logo, but weekdays only match the 2026 calendar.
// timeInferred=true means the graphic printed no clock time; it was inferred from the enclosing block.

export interface FestivalEvent {
  id: string;
  festivalYear: number;
  date: string;            // YYYY-MM-DD
  time: string;            // HH:mm, 24h, Asia/Manila
  title: string;
  venue: string;
  note?: string;
  timeInferred?: boolean;
  legalHoliday?: boolean;
}

export const FESTIVAL_YEAR = 2026;
export const FESTIVAL_TIMEZONE = 'Asia/Manila';

export const SCHEDULE_2026: FestivalEvent[] = [
  { id: 'e2026-01', festivalYear: 2026, date: '2026-10-15', time: '17:00', title: "Ribbon Cutting and Opening", venue: "Freedom Park" },
  { id: 'e2026-02', festivalYear: 2026, date: '2026-10-15', time: '18:00', title: "LGU Booths Fair Competition (First Judging)", venue: "Freedom Park" },
  { id: 'e2026-03', festivalYear: 2026, date: '2026-10-15', time: '18:00', title: "Battle of Dance Supreme", venue: "Freedom Park Stage", timeInferred: true },
  { id: 'e2026-04', festivalYear: 2026, date: '2026-10-15', time: '20:00', title: "Hara sa Negros Oriental (Pre-Competition)", venue: "Freedom Park Stage" },
  { id: 'e2026-05', festivalYear: 2026, date: '2026-10-15', time: '21:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-06', festivalYear: 2026, date: '2026-10-16', time: '06:00', title: "Buglasan Painitan (Salu-Salo)", venue: "Dumaguete Boulevard", legalHoliday: true },
  { id: 'e2026-07', festivalYear: 2026, date: '2026-10-16', time: '07:00', title: "Ecumenical Service", venue: "Dumaguete Boulevard", legalHoliday: true },
  { id: 'e2026-08', festivalYear: 2026, date: '2026-10-16', time: '08:00', title: "Civic Military Parade with Decorated Umbrellas Competition", venue: "Dumaguete City Streets", legalHoliday: true },
  { id: 'e2026-09', festivalYear: 2026, date: '2026-10-16', time: '12:00', title: "Buglasan Lechon Festival Competition", venue: "Freedom Park", legalHoliday: true },
  { id: 'e2026-10', festivalYear: 2026, date: '2026-10-16', time: '14:00', title: "Buglasan Trade Fair Opening", venue: "Robinsons Place Dumaguete", legalHoliday: true },
  { id: 'e2026-11', festivalYear: 2026, date: '2026-10-16', time: '15:00', title: "Buglasan Festival of Festivals Streetdancing Competition", venue: "Dumaguete City Streets", legalHoliday: true },
  { id: 'e2026-12', festivalYear: 2026, date: '2026-10-16', time: '18:00', title: "Field Presentation and Showdown Competition", venue: "Gov. Mariano F. Perdices Memorial Coliseum", legalHoliday: true },
  { id: 'e2026-13', festivalYear: 2026, date: '2026-10-16', time: '20:00', title: "Viva One Variety Show", venue: "Freedom Park", legalHoliday: true },
  { id: 'e2026-14', festivalYear: 2026, date: '2026-10-16', time: '21:00', title: "SMB Night", venue: "SMB Stage", legalHoliday: true },
  { id: 'e2026-15', festivalYear: 2026, date: '2026-10-17', time: '14:00', title: "Marching Band Competition", venue: "Lamberto Macias Sports and Cultural Center" },
  { id: 'e2026-16', festivalYear: 2026, date: '2026-10-17', time: '17:00', title: "Buglasan Parada sa Kahayag Float Competition", venue: "Provincial Capitol, ending at Dumaguete Boulevard" },
  { id: 'e2026-17', festivalYear: 2026, date: '2026-10-17', time: '19:00', title: "Buglasan Pyromusical Competition", venue: "Dumaguete Boulevard" },
  { id: 'e2026-18', festivalYear: 2026, date: '2026-10-17', time: '20:00', title: "Ginebra Night", venue: "Freedom Park Stage" },
  { id: 'e2026-19', festivalYear: 2026, date: '2026-10-18', time: '19:00', title: "Battle of the Bands", venue: "Freedom Park" },
  { id: 'e2026-20', festivalYear: 2026, date: '2026-10-18', time: '20:00', title: "Gandang Negorense Queensize Edition - Grand Competition", venue: "Lamberto L. Macias Sports and Cultural Center" },
  { id: 'e2026-21', festivalYear: 2026, date: '2026-10-18', time: '21:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-22', festivalYear: 2026, date: '2026-10-19', time: '18:00', title: "Singing Idol Competition", venue: "Freedom Park Stage" },
  { id: 'e2026-23', festivalYear: 2026, date: '2026-10-19', time: '21:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-24', festivalYear: 2026, date: '2026-10-20', time: '18:00', title: "Vocal Duet Competition", venue: "Freedom Park Stage" },
  { id: 'e2026-25', festivalYear: 2026, date: '2026-10-20', time: '18:00', title: "Balitaw Competition", venue: "Freedom Park Stage", timeInferred: true },
  { id: 'e2026-26', festivalYear: 2026, date: '2026-10-20', time: '20:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-27', festivalYear: 2026, date: '2026-10-21', time: '08:00', title: "Inter-School Tourism and Hospitality Skills Competition", venue: "Negros Oriental Convention Center, Plenary Hall", note: "Tourism: flight demo, tour guiding (national/international), tour package making, brochure making, tourism vlog. Hospitality: flair tending (M/F), fruit & vegetable carving, floral arrangement, table setting, cake decorating, cooking." },
  { id: 'e2026-28', festivalYear: 2026, date: '2026-10-21', time: '18:00', title: "Folk Dance Competition", venue: "Freedom Park Stage" },
  { id: 'e2026-29', festivalYear: 2026, date: '2026-10-21', time: '18:00', title: "Balak Competition", venue: "Freedom Park Stage", timeInferred: true },
  { id: 'e2026-30', festivalYear: 2026, date: '2026-10-21', time: '20:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-31', festivalYear: 2026, date: '2026-10-22', time: '09:00', title: "Buglasan Farm Family Congress Opening", venue: "Quezon Park, Dumaguete City" },
  { id: 'e2026-32', festivalYear: 2026, date: '2026-10-22', time: '18:00', title: "Dancesport Competition", venue: "Freedom Park Stage" },
  { id: 'e2026-33', festivalYear: 2026, date: '2026-10-22', time: '21:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-34', festivalYear: 2026, date: '2026-10-23', time: '16:00', title: "Lutong Ato Competition: The NegOrense Flavors", venue: "Quezon Park, Dumaguete City", note: "Same block: Buglasan Farm Family Congress Awarding and Closing Ceremonies" },
  { id: 'e2026-35', festivalYear: 2026, date: '2026-10-23', time: '18:00', title: "Bahandi sa Negros Oriental: School of Living Traditions on Tour (Kahayag Dance Company)", venue: "Freedom Park Stage" },
  { id: 'e2026-36', festivalYear: 2026, date: '2026-10-23', time: '20:00', title: "Hara sa Negros Oriental 2026 Grand Competition", venue: "Lamberto L. Macias Sports and Cultural Center" },
  { id: 'e2026-37', festivalYear: 2026, date: '2026-10-24', time: '14:00', title: "Bodybuilding Athletic Competition", venue: "Lamberto L. Macias Sports and Cultural Center" },
  { id: 'e2026-38', festivalYear: 2026, date: '2026-10-24', time: '16:00', title: "Push Bike Competition", venue: "Dumaguete Boulevard" },
  { id: 'e2026-39', festivalYear: 2026, date: '2026-10-24', time: '18:00', title: "LGU Booths Fair Competition (Final Judging)", venue: "Freedom Park Stage" },
  { id: 'e2026-40', festivalYear: 2026, date: '2026-10-24', time: '20:00', title: "Buglasan Music Fest", venue: "Dumaguete Boulevard" },
  { id: 'e2026-41', festivalYear: 2026, date: '2026-10-24', time: '21:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-42', festivalYear: 2026, date: '2026-10-25', time: '11:00', title: "Closing Ceremonies, Awarding", venue: "Plenary Hall, Negros Oriental Convention Center" },
  { id: 'e2026-43', festivalYear: 2026, date: '2026-10-25', time: '20:00', title: "ABS-CBN Kapamilya Caravan", venue: "Freedom Park Stage" },
  { id: 'e2026-44', festivalYear: 2026, date: '2026-10-25', time: '21:00', title: "SMB Night", venue: "SMB Stage" },
  { id: 'e2026-45', festivalYear: 2026, date: '2026-10-25', time: '22:00', title: "Fireworks Display", venue: "Provincial Capitol Grounds" },
];

export const ABOUT = {
  name: 'Buglasan Festival',
  region: 'Negros Oriental, Philippines',
  host_city: 'Dumaguete City',
  typical_month: 'October',
  official_source: 'https://www.facebook.com/Buglasan',
  meaning_note: 'Buglasan is derived from Bisaya and is commonly explained as relating to celebration and abundance. Treat this as approximate and say so.',
};
