// Azure Function (Node, programming model v4): POST /api/narrate – rewords one match-intelligence insight with a model
// deployed in Microsoft Foundry. STATUS: prepared, NOT deployed and NOT run yet (PROJECT_REPORT.md §12): the Azure
// side (Foundry project, model deployment, Function App with a managed identity) does not exist yet.
//
// No key anywhere: the Function App authenticates to the Foundry project with its managed identity
// (DefaultAzureCredential). The browser only knows this function's public URL.
import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { AIProjectClient } from '@azure/ai-projects';
import { DefaultAzureCredential } from '@azure/identity';
import { buildMessages, checkAnswer, MODEL_SETTINGS, parseRequest, RateLimiter } from '../../../src/intel/foundry/narrate-core';

const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
const deployment = process.env.FOUNDRY_MODEL_DEPLOYMENT;
const apiVersion = process.env.FOUNDRY_API_VERSION ?? '2024-12-01-preview';
const allowedOrigin = process.env.ALLOWED_ORIGIN ?? '';
const limiter = new RateLimiter();
let openai: Awaited<ReturnType<AIProjectClient['getAzureOpenAIClient']>> | null = null;

function cors(origin: string | null): Record<string, string> {
  return origin && origin === allowedOrigin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } : {};
}

async function narrate(req: HttpRequest): Promise<HttpResponseInit> {
  const headers = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return { status: 204, headers };
  if (!endpoint || !deployment) return { status: 503, headers, jsonBody: { error: 'narration not configured (FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_MODEL_DEPLOYMENT)' } };
  const client = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const allowed = limiter.allow(client, Date.now());
  if (!allowed.ok) return { status: allowed.status, headers, jsonBody: { error: allowed.error } };
  const verdict = parseRequest(await req.text());
  if (!verdict.ok) return { status: verdict.status, headers, jsonBody: { error: verdict.error } };
  openai ??= await new AIProjectClient(endpoint, new DefaultAzureCredential()).getAzureOpenAIClient({ apiVersion });
  const completion = await openai.chat.completions.create({
    model: deployment, messages: buildMessages(verdict.request), max_tokens: MODEL_SETTINGS.maxTokens, temperature: MODEL_SETTINGS.temperature,
  });
  const checked = checkAnswer(completion.choices[0]?.message?.content ?? '', verdict.request);
  if (!checked.ok) return { status: 422, headers, jsonBody: { error: checked.error } };
  return { status: 200, headers, jsonBody: { text: checked.text, model: deployment } };
}

app.http('narrate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler: narrate });
