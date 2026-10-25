import { modelInputSupport } from './capabilities';

it('represents text and image inputs separately and fails closed', () => {
  expect(modelInputSupport({ capabilities: [] })).toEqual({ text: false, image: false });
  expect(modelInputSupport({ capabilities: ['chat'] })).toEqual({ text: true, image: false });
  expect(modelInputSupport({ capabilities: ['vision'] })).toEqual({ text: false, image: false });
  expect(modelInputSupport({ capabilities: ['chat', 'vision'] })).toEqual({
    text: true,
    image: true,
  });
  expect(modelInputSupport({ capabilities: ['embedding'] })).toEqual({ text: false, image: false });
});
