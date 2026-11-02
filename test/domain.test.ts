import { describe, expect, it } from 'vitest';
import { mergeBookings, toVisits } from '../src/domain/bookings.js';
import { diffVisits, SnapshotStore, type Snapshot } from '../src/domain/feed.js';
import { openSlots } from '../src/domain/slots.js';
import { splitRange, weekStarts } from '../src/domain/windows.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers.js';

describe('splitRange', () => {
  it('keeps a short range whole', () => {
    expect(splitRange('2026-01-01', '2026-01-31')).toEqual([
      { start: '2026-01-01', end: '2026-01-31' },
    ]);
  });

  it('splits long ranges without gaps or overlaps', () => {
    const windows = splitRange('2026-01-01', '2026-12-31');
    expect(windows[0]).toEqual({ start: '2026-01-01', end: '2026-01-31' });
    expect(windows[1]?.start).toBe('2026-02-01');
    expect(windows.at(-1)?.end).toBe('2026-12-31');
    expect(windows).toHaveLength(12);
  });

  it('handles one day and rejects a reversed or impossible range', () => {
    expect(splitRange('2026-03-01', '2026-03-01')).toHaveLength(1);
    expect(() => splitRange('2026-03-02', '2026-03-01')).toThrow(/before/);
    expect(() => splitRange('2026-02-30', '2026-03-01')).toThrow(/calendar date/);
  });
});

describe('weekStarts', () => {
  it('returns the Monday of each week', () => {
    expect(weekStarts('2026-11-04', '2026-11-18')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
    expect(weekStarts('2026-11-01', '2026-11-01')).toEqual(['2026-10-26']);
  });
});

describe('bookings', () => {
  it('joins parts of an appointment and drops duplicates across windows', () => {
    const a = { id: 1, appointment_uid: 'A', status: 'A', booked_from: '2026-11-02T10:00', booked_till: '2026-11-02T10:30', staffer_id: 5 };
    const b = { id: 2, appointment_uid: 'A', status: 'A', booked_from: '2026-11-02T10:30', booked_till: '2026-11-02T11:00', staffer_id: 6 };
    const merged = mergeBookings([[a], [a, b]]);
    expect(merged).toHaveLength(2);
    expect(toVisits(merged)).toEqual([
      { uid: 'A', status: 'A', start: '2026-11-02T10:00', end: '2026-11-02T11:00', staffIds: ['5', '6'] },
    ]);
  });
});

describe('openSlots', () => {
  const resources = [
    {
      id: 5,
      name: 'Staff A',
      schedule: [
        {
          date: '2026-11-02',
          hours: [{ hour_from: '09:00', hour_till: '13:00' }],
          time_offs: [{ hour_from: '11:00', hour_till: '11:30' }],
        },
      ],
    },
    { id: 6, name: 'Staff B', schedule: [{ date: '2026-11-02', hours: [] }] },
  ];
  const bookings = [
    { appointment_uid: 'A', status: 'A', booked_from: '2026-11-02T09:30', booked_till: '2026-11-02T10:00', staffer_id: 5 },
    { appointment_uid: 'B', status: 'C', booked_from: '2026-11-02T12:00', booked_till: '2026-11-02T13:00', staffer_id: 5 },
  ];

  it('subtracts bookings and time off, ignores cancelled visits', () => {
    const slots = openSlots({
      date: '2026-11-02',
      durationMinutes: 30,
      stepMinutes: 30,
      resources,
      bookings,
    });
    expect(slots.map((slot) => [slot.from, slot.till])).toEqual([
      ['09:00', '09:30'],
      ['10:00', '11:00'],
      ['11:30', '13:00'],
    ]);
    expect(slots[1]?.starts).toEqual(['10:00', '10:30']);
  });

  it('leaves out gaps shorter than the visit and days off', () => {
    const slots = openSlots({
      date: '2026-11-02',
      durationMinutes: 60,
      stepMinutes: 15,
      resources,
      bookings,
    });
    expect(slots.every((slot) => slot.resource_id === '5')).toBe(true);
    expect(slots.map((slot) => slot.from)).toEqual(['10:00', '11:30']);
  });

  it('treats an all-day absence as no time', () => {
    const off = [{ id: 5, schedule: [{ date: '2026-11-02', hours: [{ hour_from: '09:00', hour_till: '17:00' }], time_offs: [{ all_day: true }] }] }];
    expect(openSlots({ date: '2026-11-02', durationMinutes: 30, stepMinutes: 30, resources: off, bookings: [] })).toEqual([]);
  });
});

describe('diffVisits', () => {
  const base = { status: 'A', end: '2026-11-03T10:30', staffIds: ['5'] };
  const previous: Snapshot = {
    takenAt: '2026-11-02T09:00:00Z',
    rangeStart: '2026-11-01',
    rangeEnd: '2026-12-01',
    visits: {
      same: { uid: 'same', start: '2026-11-03T10:00', ...base },
      moved: { uid: 'moved', start: '2026-11-03T10:00', ...base },
      gone: { uid: 'gone', start: '2026-11-04T10:00', ...base },
      cancel: { uid: 'cancel', start: '2026-11-03T12:00', ...base },
      confirm: { uid: 'confirm', start: '2026-11-03T13:00', ...base, status: 'W' },
      outside: { uid: 'outside', start: '2027-05-01T10:00', ...base },
    },
  };

  it('sorts changes into kinds', () => {
    const feed = diffVisits(
      previous,
      [
        { uid: 'same', start: '2026-11-03T10:00', ...base },
        { uid: 'moved', start: '2026-11-03T11:00', ...base },
        { uid: 'cancel', start: '2026-11-03T12:00', ...base, status: 'C' },
        { uid: 'confirm', start: '2026-11-03T13:00', ...base, status: 'A' },
        { uid: 'fresh', start: '2026-11-05T09:00', ...base },
      ],
      { start: '2026-11-01', end: '2026-12-01' },
    );
    expect(feed.new.map((c) => c.uid)).toEqual(['fresh']);
    expect(feed.moved.map((c) => c.uid)).toEqual(['moved']);
    expect(feed.cancelled.map((c) => c.uid)).toEqual(['cancel']);
    expect(feed.status_changed.map((c) => c.uid)).toEqual(['confirm']);
    expect(feed.disappeared.map((c) => c.uid)).toEqual(['gone']);
  });
});

describe('SnapshotStore', () => {
  it('keeps only ids, times and statuses, with private file mode', () => {
    const dir = tempDir();
    const store = new SnapshotStore(dir);
    const visits = toVisits([
      {
        appointment_uid: 'A',
        status: 'A',
        booked_from: '2026-11-02T10:00',
        booked_till: '2026-11-02T10:30',
        staffer_id: 5,
        customer: { name: 'Sample Client', cell_phone: '+48000000000' },
      },
    ]);
    store.save('1001', {
      takenAt: 'now',
      rangeStart: 'a',
      rangeEnd: 'b',
      visits: Object.fromEntries(visits.map((visit) => [visit.uid, visit])),
    });
    const file = join(dir, readdirSync(dir)[0] as string);
    expect(readFileSync(file, 'utf8')).not.toContain('Sample Client');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.load('1001')?.visits.A?.staffIds).toEqual(['5']);
  });

  it('starts over on a damaged file', () => {
    expect(new SnapshotStore(tempDir()).load('1')).toBeNull();
  });
});
