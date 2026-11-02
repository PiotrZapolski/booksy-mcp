import { describe, expect, it } from 'vitest';
import { BooksyError } from '../src/errors.js';
import { SequentialLimiter } from '../src/gateway/limiter.js';

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

describe('SequentialLimiter', () => {
  it('never runs two tasks at once and keeps order', async () => {
    const clock = fakeClock();
    const limiter = new SequentialLimiter({ minIntervalMs: 2000, maxPerHour: 100, ...clock });
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
    await Promise.all([1, 2, 3, 4].map((id) => limiter.schedule(task(id))));
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('waits at least the minimum gap, with jitter on top', async () => {
    const clock = fakeClock();
    const limiter = new SequentialLimiter({
      minIntervalMs: 2000,
      maxPerHour: 100,
      random: () => 0.5,
      ...clock,
    });
    await limiter.schedule(async () => undefined);
    await limiter.schedule(async () => undefined);
    expect(clock.waits).toEqual([2500]);
  });

  it('a failing task does not stop the queue', async () => {
    const clock = fakeClock();
    const limiter = new SequentialLimiter({ minIntervalMs: 1000, maxPerHour: 100, ...clock });
    await expect(limiter.schedule(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limiter.schedule(async () => 'next')).resolves.toBe('next');
  });

  it('refuses over the hourly budget and frees up after an hour', async () => {
    const clock = fakeClock();
    const limiter = new SequentialLimiter({ minIntervalMs: 1, maxPerHour: 2, ...clock });
    await limiter.schedule(async () => undefined);
    await limiter.schedule(async () => undefined);
    await expect(limiter.schedule(async () => undefined)).rejects.toMatchObject({
      code: 'budget_exhausted',
    } satisfies Partial<BooksyError>);
    clock.advance(3_600_001);
    await expect(limiter.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});
