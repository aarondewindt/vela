import { resolveModelSetting, updateModelSettingSchema } from './schema';

const base = { provider: 'ollama' as const, modelId: 'base:latest' };
const fast = { provider: 'ollama' as const, modelId: 'fast:latest' };
const other = { provider: 'ollama' as const, modelId: 'other:latest' };

it('resolves chat override, feature model, feature profile, profile default and default LLM in order', () => {
  const settings = { default: base, balanced: fast, 'aiDev.chat': other };
  expect(resolveModelSetting(settings, 'aiDev.chat', base).selection).toEqual(base);
  expect(resolveModelSetting(settings, 'aiDev.chat').selection).toEqual(other);
  expect(
    resolveModelSetting({ default: base, fast, 'aiDev.chat': { profile: 'fast' } }, 'aiDev.chat')
      .selection
  ).toEqual(fast);
  expect(resolveModelSetting({ default: base, balanced: fast }, 'aiDev.chat').selection).toEqual(
    fast
  );
  expect(resolveModelSetting({ default: base }, 'nutrition.mealDraft').selection).toEqual(base);
});
it('allows explicit use of the default LLM even when Balanced is configured', () => {
  expect(
    resolveModelSetting(
      { default: base, balanced: fast, 'aiDev.chat': { profile: 'default' } },
      'aiDev.chat'
    ).selection
  ).toEqual(base);
});
it('does not substitute an LLM for embeddings or an unset vision-language model', () => {
  expect(resolveModelSetting({ default: base }, 'aiDev.embeddings').selection).toBeNull();
  expect(
    resolveModelSetting(
      { default: base, 'aiDev.chat': { profile: 'visionLanguage' } },
      'aiDev.chat'
    ).selection
  ).toBeNull();
});
it('keeps an explicit selection authoritative even if its model might be unavailable', () => {
  expect(resolveModelSetting({ default: base, balanced: other }, 'aiDev.chat').selection).toEqual(
    other
  );
});
it.each([
  { key: 'default', value: { profile: 'balanced' } },
  { key: 'fast', value: { profile: 'fast' } },
  { key: 'aiDev.embeddings', value: { profile: 'balanced' } },
  { key: 'aiDev.chat', value: { profile: 'embeddings' } },
  { key: 'unknown.feature', value: base },
  { key: 'default', value: { provider: 'other', modelId: 'model' } },
])('rejects incompatible or cyclic settings: %j', (value) => {
  expect(updateModelSettingSchema.safeParse(value).success).toBe(false);
});
