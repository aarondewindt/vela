'use client';

import { create } from 'zustand';

type PlannerStore = {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
};

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export const usePlannerStore = create<PlannerStore>((set) => ({
  selectedDate: getLocalDate(),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
}));
