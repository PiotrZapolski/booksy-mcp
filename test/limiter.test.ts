import { describe, expect, it, vi } from 'vitest';
import { BooksyError } from '../src/errors.js';
import { TrafficLedger } from '../src/gateway/ledger.js';
import { type LimiterOptions, type LimiterPolicy, SequentialLimiter } from '../src/gateway/limiter.js';

function fakeClock() {
  let time = 1_000_000;
  const waits: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
    waits,
  };
}

function limiter(
  clock: ReturnType<typeof fakeClock>,
  policy: Partial<LimiterPolicy>,
  extra: Partial<LimiterOptions> = {},
): SequentialLimiter {
  return new SequentialLimiter({
    policy: {
      minIntervalMs: 2000,
      jitterRatio: 0.5,
      writeIntervalMs: 0,
      exportIntervalMs: 0,
      maxRequestsPerHour: 100,
      maxRequestsPerDay: 1000,
      maxExportsPerDay: 10,
      ...policy,
    },
    ledger: new TrafficLedger(null, clock.now),
    now: clock.now,
    sleep: clock.sleep,
    ...extra,
  });
}

describe('SequentialLimiter', () => {
  it('never runs two tasks at once and keeps order', async () => {
    const clock = fakeClock();
    const queue = limiter(clock, {});
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (id: number) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      order.push(id);
      running -= 1;
    };
    await Promise.all([1, 2, 3, 4].map((id) => queue.schedule(task(id))));
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('waits at least the minimum gap, with jitter on top', async () => {
    const clock = fakeClock();
    const queue = limiter(clock, {}, { random: () => 0.5 });
    await queue.schedule(async () => undefined);
    await queue.schedule(async () => undefined);
    expect(clock.waits).toEqual([2500]);
  });

  it('a failing task does not stop the queue', async () => {
    const clock = fakeClock();
    const queue = limiter(clock, {});
    await expect(queue.schedule(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(queue.schedule(async () => 'next')).resolves.toBe('next');
  });

  it('refuses over the hourly budget and frees up after an hour', async () => {
    const clock = fakeClock();
    const queue = limiter(clock, { minIntervalMs: 1, maxRequestsPerHour: 2 });
    await queue.schedule(async () => undefined);
    await queue.schedule(async () => undefined);
    await expect(queue.schedule(async () => undefined)).rejects.toMatchObject({
      code: 'budget_exhausted',
    } satisfies Partial<BooksyError>);
    clock.advance(3_600_001);
    await expect(queue.schedule(async () => 'ok')).resolves.toBe('ok');
  });

  it('counts the gap from the end of a slow request', async () => {
    const clock = fakeClock();
    const queue = limiter(clock, { jitterRatio: 0 });
    await queue.schedule(async () => clock.advance(60_000));
    await queue.schedule(async () => undefined);
    expect(clock.waits).toEqual([2000]);
  });

  it('checks the gate again after waiting', async () => {
    const clock = fakeClock();
    let open = true;
    const queue = limiter(
      clock,
      {},
      {
        gate: () => {
          if (!open) throw new Error('stopped');
        },
        sleep: async () => {
          open = false;
        },
      },
    );
    await queue.schedule(async () => undefined);
    const task = vi.fn(async () => undefined);
    await expect(queue.schedule(task)).rejects.toThrow('stopped');
    expect(task).not.toHaveBeenCalled();
  });

  it('counts a heavy task by its weight', async () => {
    const clock = fakeClock();
    const queue = limiter(clock, { maxRequestsPerHour: 4 });
    await queue.schedule(async () => undefined, { weight: 3 });
    await expect(queue.schedule(async () => undefined, { weight: 3 })).rejects.toMatchObject({
      code: 'budget_exhausted',
    });
    await expect(queue.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});
