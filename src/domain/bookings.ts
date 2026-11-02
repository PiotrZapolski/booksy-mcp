/** Field access for calendar bookings. All panel field names live in this file. */
export type RawBooking = Record<string, unknown>;

export interface Visit {
  uid: string;
  status: string | null;
  start: string;
  end: string | null;
  staffIds: string[];
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function staffIds(booking: RawBooking): string[] {
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    const id = text(value);
    if (id) ids.add(id);
  };
  add(booking.staffer_id);
  add(booking.appliance_id);
  add((booking.staffer as RawBooking | undefined)?.id);
  add((booking.appliance as RawBooking | undefined)?.id);
  if (Array.isArray(booking.resources)) {
    for (const resource of booking.resources) {
      add(typeof resource === 'object' && resource ? (resource as RawBooking).id : resource);
    }
  }
  return [...ids];
}

function subbookings(booking: RawBooking): RawBooking[] {
  return Array.isArray(booking.subbookings) && booking.subbookings.length > 0
    ? (booking.subbookings as RawBooking[])
    : [booking];
}

/** Flattens multi-part appointments into one record per appointment. */
export function toVisits(bookings: RawBooking[]): Visit[] {
  const visits = new Map<string, Visit>();
  for (const booking of bookings) {
    const uid = text(booking.appointment_uid) ?? text(booking.id);
    if (!uid) continue;
    for (const part of subbookings(booking)) {
      const start = text(part.booked_from) ?? text(booking.booked_from);
      if (!start) continue;
      const end = text(part.booked_till) ?? text(booking.booked_till);
      const known = visits.get(uid);
      if (!known) {
        visits.set(uid, {
          uid,
          status: text(booking.status) ?? text(booking.appointment_status),
          start,
          end,
          staffIds: staffIds(part),
        });
        continue;
      }
      if (start < known.start) known.start = start;
      if (end && (!known.end || end > known.end)) known.end = end;
      for (const id of staffIds(part)) {
        if (!known.staffIds.includes(id)) known.staffIds.push(id);
      }
    }
  }
  return [...visits.values()];
}

export function bookingKey(booking: RawBooking): string {
  return text(booking.id) ?? text(booking.appointment_uid) ?? JSON.stringify(booking);
}

export function mergeBookings(batches: RawBooking[][]): RawBooking[] {
  const merged = new Map<string, RawBooking>();
  for (const batch of batches) {
    for (const booking of batch) merged.set(bookingKey(booking), booking);
  }
  return [...merged.values()];
}
