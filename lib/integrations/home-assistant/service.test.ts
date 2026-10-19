/** @jest-environment node */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/prisma', () => ({
  prisma: { homeAssistantConnection: { findUnique: jest.fn() }, $transaction: jest.fn() },
}));
import { prisma } from '@/lib/prisma';
import { homeAssistantService, ownerClient } from './service';
import { decryptToken } from './security';
const db = {
  homeAssistantConnection: {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  healthEntityMapping: { deleteMany: jest.fn() },
};
beforeEach(() => {
  jest.clearAllMocks();
  process.env.HOME_ASSISTANT_ALLOWED_ORIGINS = 'https://ha.example.com,https://other.example.com';
  process.env.INTEGRATION_ENCRYPTION_KEY = 'ab'.repeat(32);
  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(db));
  db.homeAssistantConnection.findUnique.mockResolvedValue(null);
  db.homeAssistantConnection.findUniqueOrThrow.mockResolvedValue({
    baseUrl: 'https://ha.example.com',
    revision: 1,
  });
  db.homeAssistantConnection.updateMany.mockResolvedValue({ count: 1 });
});
afterAll(() => {
  delete process.env.HOME_ASSISTANT_ALLOWED_ORIGINS;
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
});
it('saves encrypted owner-bound tokens and only selects public connection fields', async () => {
  await homeAssistantService.save('alice', {
    baseUrl: 'https://ha.example.com',
    token: 'private',
    enabled: true,
    revision: 0,
  });
  const saved = db.homeAssistantConnection.create.mock.calls[0][0].data;
  expect(saved.userId).toBe('alice');
  expect(saved.encryptedToken).not.toContain('private');
  expect(decryptToken(saved.encryptedToken, 'alice')).toBe('private');
  const fields = db.homeAssistantConnection.findUniqueOrThrow.mock.calls[0][0].select;
  expect(fields).not.toHaveProperty('encryptedToken');
  await homeAssistantService.get('alice');
  expect(prisma.homeAssistantConnection.findUnique).toHaveBeenCalledWith({
    where: { userId: 'alice' },
    select: fields,
  });
});
it('never resolves a different owner connection and rejects missing connections', async () => {
  (prisma.homeAssistantConnection.findUnique as jest.Mock).mockResolvedValue(null);
  await expect(ownerClient('bob')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(prisma.homeAssistantConnection.findUnique).toHaveBeenCalledWith({
    where: { userId: 'bob' },
  });
});
it('requires a new token on origin changes and clears old sensor mappings', async () => {
  db.homeAssistantConnection.findUnique.mockResolvedValue({
    baseUrl: 'https://ha.example.com',
    revision: 2,
  });
  await expect(
    homeAssistantService.save('alice', {
      baseUrl: 'https://other.example.com',
      enabled: true,
      revision: 2,
    })
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await homeAssistantService.save('alice', {
    baseUrl: 'https://other.example.com',
    token: 'new-token',
    enabled: true,
    revision: 2,
  });
  expect(db.healthEntityMapping.deleteMany).toHaveBeenCalledWith({ where: { userId: 'alice' } });
  expect(db.homeAssistantConnection.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'alice', revision: 2 } })
  );
});
it('reports competing first-time saves as a conflict', async () => {
  db.homeAssistantConnection.create.mockRejectedValueOnce({ code: 'P2002' });
  await expect(
    homeAssistantService.save('alice', {
      baseUrl: 'https://ha.example.com',
      token: 'private',
      enabled: true,
      revision: 0,
    })
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});
