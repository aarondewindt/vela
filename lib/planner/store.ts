'use client';

import { create } from 'zustand';

type PlannerStore = {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
};

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export const usePlannerStore = create<PlannerStore>((set) => ({
  selectedDate: getLocalDate(),
  setSelectedDate: (selectedDate) => {
    if (isDateKey(selectedDate)) set({ selectedDate });
  },
}));
