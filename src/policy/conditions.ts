import { AgentGateError } from '../errors.js';
import type { AgentEvent } from '../events/types.js';
import {
  isConditionGroup,
  WEEKDAYS,
  type Condition,
  type ConditionLeaf,
  type ConditionValue,
  type Weekday,
} from './types.js';

export interface ConditionContext {
  event: AgentEvent;
  /** Reference instant for `time_window` / `day_of_week`. */
  now: Date;
  /** IANA time zone, e.g. `Asia/Shanghai`. */
  timezone: string;
}

export interface ConditionResult {
  matched: boolean;
  warnings: string[];
}

const WEEKDAY_ALIASES: Record<string, Weekday> = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tues: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  weds: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
};

const NUMERIC_MATCHER = /^(>=|<=|>|<|==|!=|=)\s*(-?\d+(?:\.\d+)?)$/;

/**
 * Evaluate a condition tree. Unknown numeric fields are treated as "not
 * matched" plus a warning rather than an error: a typo must not make the
 * engine intervene, and the warning keeps it visible.
 */
export function evaluateConditions(condition: Condition | undefined, context: ConditionContext): ConditionResult {
  const warnings: string[] = [];
  if (condition === undefined) return { matched: true, warnings };
  return { matched: evaluateNode(condition, context, warnings), warnings };
}

function evaluateNode(condition: Condition, context: ConditionContext, warnings: string[]): boolean {
  if (isConditionGroup(condition)) {
    if ('all' in condition) {
      return condition.all.every((child) => evaluateNode(child as Condition, context, warnings));
    }
    if ('any' in condition) {
      return condition.any.some((child) => evaluateNode(child as Condition, context, warnings));
    }
    return !evaluateNode(condition.not as Condition, context, warnings);
  }
  return evaluateLeaf(condition as ConditionLeaf, context, warnings);
}

function evaluateLeaf(leaf: ConditionLeaf, context: ConditionContext, warnings: string[]): boolean {
  return Object.entries(leaf).every(([key, expected]) => {
    switch (key) {
      case 'app':
        return matchesContextFacet(context.event.context.app, expected);
      case 'project':
        return matchesContextFacet(context.event.context.project, expected);
      case 'language':
        return matchesContextFacet(context.event.context.language, expected);
      case 'time_window':
        return typeof expected === 'string' && matchesTimeWindow(expected, context);
      case 'day_of_week':
        return matchesWeekday(expected, context);
      default:
        return matchesNumericField(key, expected, context.event, warnings);
    }
  });
}

function matchesContextFacet(actual: string | null, expected: ConditionValue): boolean {
  if (actual === null) return false;
  const wanted = Array.isArray(expected) ? expected : [String(expected)];
  return wanted.some((candidate) => candidate.toLowerCase() === actual.toLowerCase());
}

function matchesWeekday(expected: ConditionValue, context: ConditionContext): boolean {
  const values = Array.isArray(expected) ? expected : [String(expected)];
  const weekday = localWeekday(context.now, context.timezone);
  return values.some((value) => WEEKDAY_ALIASES[String(value).toLowerCase()] === weekday);
}

function matchesNumericField(key: string, expected: ConditionValue, event: AgentEvent, warnings: string[]): boolean {
  const actual = resolveNumericField(key, event);
  if (actual === undefined) {
    warnings.push(`condition field "${key}" is not present on the event`);
    return false;
  }

  if (typeof expected === 'number') return actual === expected;
  if (typeof expected === 'boolean') return false;

  if (Array.isArray(expected)) {
    return expected.some((candidate) => Number(candidate) === actual);
  }

  const matcher = NUMERIC_MATCHER.exec(expected);
  if (matcher === null) {
    warnings.push(`condition value "${expected}" for "${key}" is not a supported comparison`);
    return false;
  }
  const operator = matcher[1] ?? '=';
  const bound = Number(matcher[2]);
  if (Number.isNaN(bound)) return false;

  switch (operator) {
    case '>':
      return actual > bound;
    case '>=':
      return actual >= bound;
    case '<':
      return actual < bound;
    case '<=':
      return actual <= bound;
    case '!=':
      return actual !== bound;
    case '=':
    case '==':
      return actual === bound;
    default:
      return false;
  }
}

function resolveNumericField(key: string, event: AgentEvent): number | undefined {
  const metric = event.metrics[key];
  if (typeof metric === 'number' && Number.isFinite(metric)) return metric;
  if (key === 'duration_seconds') {
    return typeof event.duration_seconds === 'number' ? event.duration_seconds : undefined;
  }
  return undefined;
}

/** Returns the local weekday for `instant` in `timeZone` (mon..sun). */
export function localWeekday(instant: Date, timeZone: string): Weekday {
  const parts = localParts(instant, timeZone);
  const index = WEEKDAYS.indexOf(parts.weekday);
  return index === -1 ? 'mon' : (WEEKDAYS[index] as Weekday);
}

interface LocalParts {
  hour: number;
  minute: number;
  weekday: Weekday;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: Date, timeZone: string): LocalParts {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
      });
    } catch (error) {
      throw new AgentGateError('invalid_timezone', `unknown time zone "${timeZone}"`, { cause: error });
    }
    formatterCache.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(instant);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(lookup.get('hour') ?? '0');
  const minute = Number(lookup.get('minute') ?? '0');
  const weekdayLabel = (lookup.get('weekday') ?? 'Mon').toLowerCase().slice(0, 3);
  const weekday = WEEKDAY_ALIASES[weekdayLabel] ?? 'mon';
  return { hour, minute, weekday };
}

/** `HH:MM-HH:MM`, inclusive start, exclusive end, wrapping past midnight. */
export function matchesTimeWindow(window: string, context: ConditionContext): boolean {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
  if (match === null) throw new AgentGateError('invalid_time_window', `invalid time_window "${window}"`);
  const startHour = Number(match[1]);
  const startMinute = Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4]);

  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
    throw new AgentGateError('invalid_time_window', `invalid time_window "${window}"`);
  }

  const parts = localParts(context.now, context.timezone);
  const minutesNow = parts.hour * 60 + parts.minute;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  if (start === end) return true;
  if (start < end) return minutesNow >= start && minutesNow < end;
  return minutesNow >= start || minutesNow < end;
}
