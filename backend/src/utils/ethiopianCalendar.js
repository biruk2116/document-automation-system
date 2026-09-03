/**
 * Gregorian (G.C.) -> Ethiopian (E.C.) calendar conversion.
 *
 * Used only to render the auto-injected `generation_date_ec` placeholder — the
 * Ethiopian calendar is ~7-8 years behind Gregorian and its new year (Meskerem 1)
 * falls on Sept 11 (or Sept 12 in the Gregorian year before a Gregorian leap year).
 *
 * This is a standard civil-calendar conversion (day-offset from the Ethiopian new
 * year), accurate for the modern era — it does not attempt to model the historical
 * Julian/Gregorian leap-year drift used by some ecclesiastical calculations.
 */

const ETHIOPIAN_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
];

function isGregorianLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Returns { year, month, day, monthName } for the Ethiopian calendar date matching `gDate`. */
function toEthiopian(gDate) {
  const gYear = gDate.getFullYear();
  const gMonth = gDate.getMonth() + 1;
  const gDay = gDate.getDate();

  // Ethiopian new year (Meskerem 1) falls on Sept 12 in the Gregorian year immediately
  // preceding a Gregorian leap year, Sept 11 otherwise.
  const newYearDayForYear = (y) => (isGregorianLeap(y + 1) ? 12 : 11);

  const inputDate = new Date(gYear, gMonth - 1, gDay);
  const thisYearNewYear = new Date(gYear, 8, newYearDayForYear(gYear)); // month index 8 = September

  let ethiopianYear;
  let newYearRef;
  if (inputDate >= thisYearNewYear) {
    ethiopianYear = gYear - 7;
    newYearRef = thisYearNewYear;
  } else {
    ethiopianYear = gYear - 8;
    newYearRef = new Date(gYear - 1, 8, newYearDayForYear(gYear - 1));
  }

  const diffDays = Math.round((inputDate - newYearRef) / (1000 * 60 * 60 * 24));
  const ethiopianMonth = Math.min(13, Math.floor(diffDays / 30) + 1);
  const ethiopianDay = diffDays - (ethiopianMonth - 1) * 30 + 1;

  return {
    year: ethiopianYear,
    month: ethiopianMonth,
    day: ethiopianDay,
    monthName: ETHIOPIAN_MONTHS[ethiopianMonth - 1],
  };
}

/** e.g. "Nehase 13, 2018 E.C." */
function formatEthiopianDate(gDate) {
  const { year, day, monthName } = toEthiopian(gDate);
  return `${monthName} ${day}, ${year} E.C.`;
}

/** e.g. "August 19, 2026 G.C." */
function formatGregorianDate(gDate) {
  const formatted = gDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `${formatted} G.C.`;
}

module.exports = { toEthiopian, formatEthiopianDate, formatGregorianDate };
