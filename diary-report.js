import { combinationCount, DRAW_SIZE } from "./lottery-math.js?v=13";

const MINIMUM_PRIZE_HITS = 11;
const saoPauloDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

function dateAt(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : null;
}

function requireDate(value) {
  const date = parseDateKey(value);
  if (!date) throw new RangeError("Data de referência inválida.");
  return date;
}

function addDays(date, days) {
  return dateAt(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

function bucket(start, end, label) {
  return { start: dateKey(start), end: dateKey(end), label };
}

export function reportPeriod(kind, referenceISODate) {
  const reference = requireDate(referenceISODate);
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  let buckets;

  if (kind === "week") {
    const monday = addDays(reference, -((reference.getUTCDay() + 6) % 7));
    buckets = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index);
      return bucket(day, day, weekday.format(day));
    });
  } else if (kind === "month") {
    const lastDay = dateAt(year, month + 1, 0).getUTCDate();
    buckets = [];
    for (let first = 1; first <= lastDay; first += 7) {
      const last = Math.min(first + 6, lastDay);
      const label = first === last ? String(first) : `${first}–${last}`;
      buckets.push(bucket(dateAt(year, month, first), dateAt(year, month, last), label));
    }
  } else if (kind === "year") {
    buckets = Array.from({ length: 12 }, (_, index) => {
      const first = dateAt(year, index, 1);
      return bucket(first, dateAt(year, index + 1, 0), monthName.format(first));
    });
  } else {
    throw new RangeError("Período de relatório inválido.");
  }

  return { start: buckets[0].start, end: buckets[buckets.length - 1].end, buckets };
}

export function moveReportDate(kind, referenceISODate, step) {
  const reference = requireDate(referenceISODate);
  if (!Number.isSafeInteger(step)) throw new RangeError("Deslocamento de período inválido.");
  if (kind === "week") return dateKey(addDays(reference, step * 7));
  if (kind !== "month" && kind !== "year") throw new RangeError("Período de relatório inválido.");

  const monthOffset = kind === "year" ? step * 12 : step;
  const first = dateAt(reference.getUTCFullYear(), reference.getUTCMonth() + monthOffset, 1);
  const lastDay = dateAt(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getUTCDate();
  return dateKey(addDays(first, Math.min(reference.getUTCDate(), lastDay) - 1));
}

function officialDate(value) {
  const match = typeof value === "string" && /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : value;
  return parseDateKey(iso) ? iso : null;
}

function registeredDate(value) {
  if (parseDateKey(value)) return value;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = saoPauloDate.formatToParts(timestamp);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function validCents(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function officialPrize(picks, points, rates) {
  let total = 0;
  for (let tier = MINIMUM_PRIZE_HITS; tier <= points; tier += 1) {
    const winningBets = combinationCount(points, tier) * combinationCount(picks - points, DRAW_SIZE - tier);
    if (!winningBets) continue;
    const prize = rates instanceof Map ? rates.get(tier) : rates?.[tier];
    if (!validCents(prize) || prize === 0) return null;
    total += winningBets * prize;
  }
  return validCents(total) ? total : null;
}

function reportRow(entry, date, draw, officialPayouts) {
  const drawn = Array.isArray(draw?.numbers) ? new Set(draw.numbers) : null;
  const picks = new Set(entry.numbers);
  const points = drawn ? [...picks].filter((number) => drawn.has(number)).length : null;
  const spentConfirmed = validCents(entry.spentCents);
  const estimatedCost = Number.isFinite(entry.cost) && entry.cost >= 0 ? Math.round(entry.cost * 100) : null;
  const spentCents = spentConfirmed ? entry.spentCents : validCents(estimatedCost) ? estimatedCost : null;
  const row = { entry, date, points, spentCents, spentConfirmed, prizeCents: null, prizeSource: "pending" };

  if (validCents(entry.prizeReceivedCents)) {
    row.prizeCents = entry.prizeReceivedCents;
    row.prizeSource = "confirmed";
  } else if (points !== null && points < MINIMUM_PRIZE_HITS) {
    row.prizeCents = 0;
    row.prizeSource = "none";
  } else if (points !== null) {
    row.prizeCents = officialPrize(picks.size, points, officialPayouts.get(entry.targetContest));
    row.prizeSource = row.prizeCents === null ? "unavailable" : "official";
  }
  return row;
}

export function buildDiaryReport(entries, draws, period, officialPayouts = new Map()) {
  const byContest = new Map(draws.map((draw) => [draw.contest, draw]));
  const rows = [];
  for (const entry of entries) {
    const draw = byContest.get(entry.targetContest);
    const date = officialDate(draw?.date) ?? registeredDate(entry.createdAt);
    if (date && date >= period.start && date <= period.end) rows.push(reportRow(entry, date, draw, officialPayouts));
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.entry.targetContest - a.entry.targetContest
    || Date.parse(b.entry.createdAt) - Date.parse(a.entry.createdAt));

  const totals = {
    games: rows.length,
    settledGames: 0,
    winningGames: 0,
    spentCents: 0,
    prizeCents: 0,
    confirmedPrizeCents: 0,
    officialPrizeCents: 0,
    unconfirmedSpend: 0,
    unavailableSpend: 0,
    unknownPrize: 0,
    pendingGames: 0,
  };
  const hitCounts = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  const buckets = period.buckets.map((item) => ({ ...item, spentCents: 0, prizeCents: 0 }));
  for (const row of rows) {
    if (row.points === null) totals.pendingGames += 1;
    else totals.settledGames += 1;
    if (row.points >= MINIMUM_PRIZE_HITS && row.points <= DRAW_SIZE) {
      totals.winningGames += 1;
      hitCounts[row.points] += 1;
    }

    if (row.spentCents === null) totals.unavailableSpend += 1;
    else if (!row.spentConfirmed) totals.unconfirmedSpend += 1;
    if (row.prizeSource === "unavailable") totals.unknownPrize += 1;
    if (row.prizeSource === "confirmed") totals.confirmedPrizeCents += row.prizeCents;
    if (row.prizeSource === "official") totals.officialPrizeCents += row.prizeCents;

    const spent = row.spentCents ?? 0;
    const prize = row.prizeCents ?? 0;
    totals.spentCents += spent;
    totals.prizeCents += prize;
    const destination = buckets.find(({ start, end }) => row.date >= start && row.date <= end);
    if (destination) {
      destination.spentCents += spent;
      destination.prizeCents += prize;
    }
  }

  return { rows, totals, hitCounts, buckets };
}
