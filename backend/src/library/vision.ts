import { postJson, FetchLike } from '../blue/providers';

/**
 * Calls a vision-capable model to "understand" one Library item, and the embeddings API for
 * search by meaning. Plain HTTPS like Blue's adapters (shapes are unit-tested).
 */
const defaultFetch: FetchLike = (url, init) => (globalThis as any).fetch(url, init);

export interface VisionRequest {
  provider: 'anthropic' | 'openai' | 'grok';
  apiKey: string;
  model: string;
  prompt: string;
  image?: { mediaType: string; base64: string };
  /** Anthropic only: a PDF document to read. */
  pdfBase64?: string;
  fetchImpl?: FetchLike;
}

export function buildVisionBody(req: VisionRequest): { url: string; headers: Record<string, string>; body: any } {
  if (req.provider === 'anthropic') {
    const content: any[] = [];
    if (req.image) content.push({ type: 'image', source: { type: 'base64', media_type: req.image.mediaType, data: req.image.base64 } });
    if (req.pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.pdfBase64 } });
    content.push({ type: 'text', text: req.prompt });
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': req.apiKey, 'anthropic-version': '2023-06-01' },
      body: { model: req.model, max_tokens: 1500, messages: [{ role: 'user', content }] }
    };
  }
  const content: any[] = [{ type: 'text', text: req.prompt }];
  if (req.image) content.push({ type: 'image_url', image_url: { url: `data:${req.image.mediaType};base64,${req.image.base64}` } });
  return {
    url: req.provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${req.apiKey}` },
    body: { model: req.model, messages: [{ role: 'user', content }] }
  };
}

export async function runVision(req: VisionRequest): Promise<{ text: string; usage: { input: number; output: number } }> {
  const { url, headers, body } = buildVisionBody(req);
  const label = req.provider === 'anthropic' ? 'Anthropic' : req.provider === 'grok' ? 'Grok' : 'OpenAI';
  const json = await postJson(req.fetchImpl || defaultFetch, url, headers, body, label);
  if (req.provider === 'anthropic') {
    const text = (Array.isArray(json?.content) ? json.content : []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    const u = json?.usage || {};
    return { text, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0 } };
  }
  const text = json?.choices?.[0]?.message?.content || '';
  const u = json?.usage || {};
  return { text: typeof text === 'string' ? text : '', usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 } };
}

export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** OpenAI embeddings for search by meaning (one vector per input). */
export async function embedTexts(apiKey: string, texts: string[], fetchImpl?: FetchLike): Promise<number[][]> {
  if (!texts.length) return [];
  const json = await postJson(
    fetchImpl || defaultFetch,
    'https://api.openai.com/v1/embeddings',
    { Authorization: `Bearer ${apiKey}` },
    { model: EMBEDDING_MODEL, input: texts.map((t) => t.slice(0, 8000) || ' ') },
    'OpenAI embeddings'
  );
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  return data.sort((a, b) => a.index - b.index).map((d) => (Array.isArray(d.embedding) ? d.embedding : []));
}
