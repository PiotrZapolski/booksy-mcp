import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Visit } from './bookings.js';

/** Panel status codes: C canceled, D declined, R rejected. */
const CLOSED = new Set(['C', 'D', 'R']);

export interface Snapshot {
  takenAt: string;
  rangeStart: string;
  rangeEnd: string;
  visits: Record<string, Visit>;
}

export interface FeedChange {
  uid: string;
  before?: Visit;
  after?: Visit;
}

export interface Feed {
  new: FeedChange[];
  moved: FeedChange[];
  cancelled: FeedChange[];
  status_changed: FeedChange[];
  disappeared: FeedChange[];
}

function sameSlot(left: Visit, right: Visit): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    [...left.staffIds].sort().join() === [...right.staffIds].sort().join()
  );
}

/** Compares a stored snapshot with the calendar now. Only the window that was read counts. */
export function diffVisits(
  previous: Snapshot,
  current: Visit[],
  range: { start: string; end: string },
): Feed {
  const feed: Feed = { new: [], moved: [], cancelled: [], status_changed: [], disappeared: [] };
  const seen = new Set<string>();

  for (const after of current) {
    seen.add(after.uid);
    const before = previous.visits[after.uid];
    if (!before) {
      feed.new.push({ uid: after.uid, after });
      continue;
    }
    const nowClosed = CLOSED.has(after.status ?? '');
    if (nowClosed && !CLOSED.has(before.status ?? '')) {
      feed.cancelled.push({ uid: after.uid, before, after });
    } else if (!sameSlot(before, after)) {
      feed.moved.push({ uid: after.uid, before, after });
    } else if (before.status !== after.status) {
      feed.status_changed.push({ uid: after.uid, before, after });
    }
  }

  const windowEnd = `${range.end}T99`;
  for (const before of Object.values(previous.visits)) {
    if (seen.has(before.uid)) continue;
    if (before.start >= range.start && before.start <= windowEnd) {
      feed.disappeared.push({ uid: before.uid, before });
    }
  }
  return feed;
}

/** Stores ids, times and statuses only. No names, phones or notes are written to disk. */
export class SnapshotStore {
  constructor(private readonly directory: string) {}

  load(businessId: string): Snapshot | null {
    const file = this.file(businessId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
    } catch {
      return null;
    }
  }

  save(businessId: string, snapshot: Snapshot): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(this.file(businessId), JSON.stringify(snapshot), { mode: 0o600 });
  }

  private file(businessId: string): string {
    return join(this.directory, `feed-${businessId.replace(/[^A-Za-z0-9_-]/g, '')}.json`);
  }
}
