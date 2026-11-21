export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(iso: string): Clock {
  const fixed = new Date(iso);
  if (Number.isNaN(fixed.getTime())) throw new TypeError(`invalid clock instant: ${iso}`);
  return { now: () => new Date(fixed.getTime()) };
}

/** Advanceable clock for deterministic tests. */
export function manualClock(startIso: string): Clock & { advanceMs(ms: number): void } {
  let current = new Date(startIso);
  if (Number.isNaN(current.getTime())) throw new TypeError(`invalid clock instant: ${startIso}`);
  return {
    now: () => new Date(current.getTime()),
    advanceMs(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

export function toIso(instant: Date): string {
  return instant.toISOString();
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}
