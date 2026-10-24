import type { HomeAssistantState } from '@/lib/integrations/home-assistant/client';
import { dateInTimezone } from '@/lib/nutrition/dates';
import { validMetricValue, type MetricKind } from './schema';

export function inspectMetric(metric: MetricKind, state: HomeAssistantState, timezone: string) {
  if (!state.state.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(state.state.trim())) {
    return {
      normalized: null,
      issue: ['unknown', 'unavailable'].includes(state.state.trim().toLowerCase())
        ? `Home Assistant reports this sensor as ${state.state.trim()}. Check the source app and sensor availability.`
        : 'The sensor state is not a numeric reading. Select a numeric measurement or duration sensor.',
    };
  }
  let value = Number(state.state);
  const unit = String(state.attributes.unit_of_measurement ?? '')
    .toLowerCase()
    .trim();
  const unsupportedUnit = {
    normalized: null,
    issue: `Unsupported unit ${unit ? JSON.stringify(unit) : '(missing)'}. Expected ${{ WEIGHT: 'g, kg, lb or lbs', LEAN_MASS: 'g, kg, lb or lbs', BODY_FAT: '%', SLEEP: 'min, minutes, s, seconds, h, hr or hours', TOTAL_CALORIES: 'kcal or kJ', ACTIVE_CALORIES: 'kcal or kJ' }[metric]}.`,
  };
  if (metric === 'WEIGHT' || metric === 'LEAN_MASS') {
    if (unit === 'g') {
      value /= 1000;
    } else if (unit === 'lb' || unit === 'lbs') {
      value *= 0.45359237;
    } else if (unit !== 'kg') {
      return unsupportedUnit;
    }
  } else if (metric === 'BODY_FAT') {
    if (unit !== '%') {
      return unsupportedUnit;
    }
  } else if (metric === 'SLEEP') {
    if (['min', 'minutes'].includes(unit)) {
      value /= 60;
    } else if (['s', 'seconds'].includes(unit)) {
      value /= 3600;
    } else if (!['h', 'hr', 'hours'].includes(unit)) {
      return unsupportedUnit;
    }
  } else {
    if (unit === 'kj') {
      value /= 4.184;
    } else if (unit !== 'kcal') {
      return unsupportedUnit;
    }
  }
  if (!validMetricValue(metric, value)) {
    return {
      normalized: null,
      issue:
        'The converted value is outside the accepted range for this metric. Check the sensor and its unit.',
    };
  }
  // HA timestamps describe sensor state, not necessarily the underlying measurement.
  const observedAt = new Date(
    ['TOTAL_CALORIES', 'ACTIVE_CALORIES'].includes(metric) ? state.last_updated : state.last_changed
  );
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300000) {
    return {
      normalized: null,
      issue:
        'The sensor timestamp is invalid or more than five minutes in the future. Check the Home Assistant clock.',
    };
  }
  const date = dateInTimezone(timezone, observedAt);
  return {
    issue: null,
    normalized: {
      metric,
      value: value.toFixed(6),
      date,
      observedAt,
      entityId: state.entity_id,
      source: 'home_assistant',
      timestampBasis: 'sensor_state',
      sourceKey: `ha:${state.entity_id}:${metric}:${['TOTAL_CALORIES', 'ACTIVE_CALORIES'].includes(metric) ? date : observedAt.toISOString()}`,
    },
  };
}

export function normalizeMetric(metric: MetricKind, state: HomeAssistantState, timezone: string) {
  return inspectMetric(metric, state, timezone).normalized;
}

export function calorieBalance(intake: number | null, burned: number | null, goal: number | null) {
  const balance =
    intake === null || burned === null ? null : Math.round((intake - burned) * 100) / 100;
  return {
    balance,
    differenceFromGoal:
      balance === null || goal === null ? null : Math.round((balance - goal) * 100) / 100,
  };
}
