jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('@/lib/prisma', () => ({ prisma: { $transaction: jest.fn() } }));

import { prisma } from '@/lib/prisma';
import { plannerService } from './service';

const transaction = {
  dailyPlan: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  dailyBlock: {
    deleteMany: jest.fn(),
  },
  dailyPlanCategorySlot: {
    deleteMany: jest.fn(),
  },
};

describe('plannerService.clearDayPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.dailyPlan.findFirst.mockResolvedValue({ id: 'plan-id', dailyBlocks: [] });
    (prisma.$transaction as jest.Mock).mockImplementation(
      (operation: (client: typeof transaction) => unknown) => operation(transaction)
    );
  });

  it('removes planned blocks while preserving the current plan and its category slots', async () => {
    await expect(plannerService.clearDayPlan('user-id', '2026-10-11')).resolves.toEqual({
      cleared: true,
    });

    expect(transaction.dailyBlock.deleteMany).toHaveBeenCalledWith({
      where: { planId: 'plan-id' },
    });
    expect(transaction.dailyPlan.update).not.toHaveBeenCalled();
    expect(transaction.dailyPlanCategorySlot.deleteMany).not.toHaveBeenCalled();
  });
});
