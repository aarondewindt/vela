'use client';

import { usePlanQuery } from './query';
import { usePlannerStore } from './store';

export function usePlannerView() {
  const selectedDate = usePlannerStore((state) => state.selectedDate);
  const setSelectedDate = usePlannerStore((state) => state.setSelectedDate);
  const planQuery = usePlanQuery(selectedDate);

  return { selectedDate, setSelectedDate, planQuery };
}
