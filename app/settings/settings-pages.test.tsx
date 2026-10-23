jest.mock('@/components/SettingsView/DeviceSettings', () => ({
  DeviceSettings: () => <div>Private device controls</div>,
}));
jest.mock('next/headers', () => ({ headers: jest.fn(() => new Headers()) }));
jest.mock('@/lib/auth', () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock('@/components/Nutrition/NutritionGoalsView', () => ({
  NutritionGoalsView: ({ returnDate }: { returnDate?: string }) => <div>Goals {returnDate}</div>,
}));
jest.mock('@/components/Nutrition/ProductSearchSettings', () => ({
  ProductSearchSettings: () => <div>Food refresh controls</div>,
}));
jest.mock('@/components/ModelSettings/SharedIndexSettings', () => ({
  FoodIndexSettings: () => <div>Food model controls</div>,
}));
jest.mock('@/components/Health/HomeAssistantSettings', () => ({
  HomeAssistantSettings: () => <div>Private Home Assistant controls</div>,
}));
jest.mock('@/components/Health/HealthGoalSettings', () => ({
  HealthGoalSettings: () => <div>Private Health controls</div>,
}));
jest.mock('@/components/ModelSettings/AiModelSettings', () => ({
  AiModelSettings: () => <div>Private AI controls</div>,
}));
import { screen } from '@testing-library/react';
import { render } from '@/test-utils';
import { auth } from '@/lib/auth';
import NutritionPage from './nutrition/page';
import HomeAssistantPage from './home-assistant/page';
import HealthPage from './health/page';
import AiPage from './ai-models/page';
import DevicesPage from './devices/page';
const nutrition = (date?: string) => NutritionPage({ searchParams: Promise.resolve({ date }) });
beforeEach(() => jest.clearAllMocks());
it.each([nutrition, HomeAssistantPage, HealthPage, AiPage, DevicesPage])(
  'requires sign-in before mounting protected configuration (%#)',
  async (page) => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue(null);
    render(await page());
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in');
    expect(screen.queryByText(/controls/)).not.toBeInTheDocument();
  }
);
it.each(['2026-10-21', 'invalid'])(
  'combines goals and search setup in Nutrition settings (%s)',
  async (date) => {
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ user: { id: 'alice' } });
    render(await nutrition(date));
    expect(screen.getByText(date === 'invalid' ? 'Goals' : `Goals ${date}`)).toBeInTheDocument();
    expect(screen.getByText('Food refresh controls')).toBeInTheDocument();
    expect(screen.getByText('Food model controls')).toBeInTheDocument();
  }
);
