/** Shared metadata usable by server services and client model pickers. */
export type AiModelSelection = { provider: 'ollama'; modelId: string };
export type AiModelCapability = 'chat' | 'embedding' | 'vision' | 'thinking';
export type AiModel = {
  provider: AiModelSelection['provider'];
  id: string;
  capabilities: AiModelCapability[];
};

/** Unknown capabilities fail closed. Vision alone does not imply a chat model. */
export function modelInputSupport(model: Pick<AiModel, 'capabilities'>) {
  const text = model.capabilities.includes('chat');
  return { text, image: text && model.capabilities.includes('vision') };
}
