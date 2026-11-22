import {
  isRecord,
  type RawBooking,
  staffIds,
  statusOf,
  subbookings,
  text,
} from './bookings.js';

/**
 * One appointment as the agenda job hands it to Agents Hub OS for SMS reminders. A visit with
 * several services is one entry, from its earliest start to its latest end, like toVisits.
 * Times are the salon's local time from the panel, without a zone.
 */
export interface AgendaVisit {
  visit_id: number;
  start: string;
  end: string | null;
  status: string | null;
  updated_epoch: number | null;
  service: string | null;
  staff: string[];
  customer_id: number | null;
  customer_name: string | null;
  phone: string | null;
}

export interface RawCalendar {
  bookings: RawBooking[];
  resourceNames: Record<string, string>;
}

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/** "2026-11-23 10:00:00" or "2026-11-23T10:00" to "2026-11-23T10:00". */
export function localMinute(value: string | null): string | null {
  const match = value ? LOCAL_TIME.exec(value) : null;
  return match ? `${match[1]}T${match[2]}` : null;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value);
  return null;
}

/** A phone as text, trimmed, or null when blank. */
function phoneText(value: unknown): string | null {
  return text(value)?.trim() || null;
}

function serviceName(part: RawBooking): string | null {
  const service = part.service;
  if (isRecord(service)) return text(service.name);
  return text(part.service_name);
}

/** Calendar bookings as agenda visits. Bookings without a numeric id or a start are left out. */
export function toAgendaVisits(raw: RawCalendar): { visits: AgendaVisit[]; skipped: number } {
  const visits = new Map<number, AgendaVisit & { services: string[] }>();
  let skipped = 0;
  for (const booking of raw.bookings) {
    const id = wholeNumber(booking.appointment_uid) ?? wholeNumber(booking.id);
    if (id === null) {
      skipped += 1;
      continue;
    }
    const customer = isRecord(booking.customer) ? booking.customer : {};
    for (const part of subbookings(booking)) {
      const start = localMinute(text(part.booked_from) ?? text(booking.booked_from));
      if (!start) continue;
      const end = localMinute(text(part.booked_till) ?? text(booking.booked_till));
      const names = staffIds(part)
        .map((staffId) => raw.resourceNames[staffId])
        .filter((name): name is string => typeof name === 'string');
      const service = serviceName(part) ?? serviceName(booking);
      let visit = visits.get(id);
      if (!visit) {
        visit = {
          visit_id: id,
          start,
          end,
          status: statusOf(booking),
          updated_epoch: wholeNumber(booking.updated_epoch),
          service: null,
          staff: [],
          customer_id: wholeNumber(customer.id),
          customer_name: text(customer.name),
          phone: phoneText(customer.phone),
          services: [],
        };
        visits.set(id, visit);
      } else {
        visit.customer_id ??= wholeNumber(customer.id);
        visit.customer_name ??= text(customer.name);
        visit.phone ??= phoneText(customer.phone);
        if (start < visit.start) visit.start = start;
        if (end && (!visit.end || end > visit.end)) visit.end = end;
        const epoch = wholeNumber(booking.updated_epoch);
        if (epoch !== null && (visit.updated_epoch === null || epoch > visit.updated_epoch)) {
          visit.updated_epoch = epoch;
        }
      }
      for (const name of names) if (!visit.staff.includes(name)) visit.staff.push(name);
      if (service && !visit.services.includes(service)) visit.services.push(service);
    }
    if (!visits.has(id)) skipped += 1;
  }
  const list = [...visits.values()].map(({ services, ...visit }) => ({
    ...visit,
    service: services.length > 0 ? services.join(', ') : null,
  }));
  list.sort((a, b) => (a.start === b.start ? a.visit_id - b.visit_id : a.start < b.start ? -1 : 1));
  return { visits: list, skipped };
}

/**
 * The customer's phone from `{B}/appointments/:appointmentUid/`: the merged data first, then the
 * Booksy profile, then the salon's own card (the one the calendar shows, often empty).
 */
export function phoneFromDetails(data: unknown): string | null {
  if (!isRecord(data)) return null;
  // The live panel answers { appointment: { customer: { id, mode } }, customer: { merged_data, ... } }:
  // the contact data sits in the top-level customer, so look there first.
  const candidates = [data.customer, isRecord(data.appointment) ? data.appointment.customer : null];
  for (const customer of candidates) {
    if (!isRecord(customer)) continue;
    for (const key of ['merged_data', 'customer_profile', 'business_customer']) {
      const part = customer[key];
      const phone = isRecord(part) ? phoneText(part.cell_phone) : null;
      if (phone) return phone;
    }
  }
  return null;
}

/** "2026-11-23T07:31:12+01:00": the moment in the salon's zone, with its offset. */
export function isoWithOffset(date: Date, timeZone: string | null): string {
  if (!timeZone) return date.toISOString();
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'longOffset',
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    const offset = String(parts.timeZoneName ?? '').replace('GMT', '') || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
  } catch {
    return date.toISOString();
  }
}
