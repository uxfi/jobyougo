// tests/free-llm.test.mjs — free providers answer first, the paid models come
// last, and an empty OpenRouter balance no longer stops the AI calls. fetch is
// stubbed, nothing leaves.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';

console.log('\nFree models — routing');

const dir = mkdtempSync(join(tmpdir(), 'jobyougo-free-llm-'));
// Set before the imports: dotenv never overrides a variable that is already
// set, and the ledger path is read at load.
process.env.AI_USAGE_LOG_PATH = join(dir, 'ledger.jsonl');
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-gemini';
process.env.GROQ_API_KEY = 'test-groq';
for (const name of ['CEREBRAS_API_KEY', 'MISTRAL_API_KEY', 'SAMBANOVA_API_KEY', 'NVIDIA_API_KEY', 'GITHUB_MODELS_TOKEN']) process.env[name] = '';
delete process.env.AI_FREE_FIRST;

const realFetch = globalThis.fetch;
let handler = () => { throw new Error('no handler'); };
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const call = { url: String(url), body: opts.body ? JSON.parse(opts.body) : null };
  calls.push(call);
  return handler(call);
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const answer = text => json({ model: 'served', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const groqModels = json({ data: [{ id: 'whisper-large-v3' }, { id: 'llama-guard-4' }, { id: 'llama-3.3-70b' }] });
const start = () => { calls = []; };
const check = (ok, message) => (ok ? pass(message) : fail(message));

try {
  const { chat, chatStream } = await import('../lib/openrouter.mjs');
  const { decide, scanKeepQuestions, parseFreeDecision, jevErrorSummary, isJevAccountError } = await import('../lib/jev.mjs');
  const { resetFreeLlmState, pickDiscoveredModels, cooldownForError } = await import('../lib/free-llm.mjs');
  const messages = [{ role: 'user', content: 'hello' }];

  // The first free provider answers: the paid model is never called.
  resetFreeLlmState(); start();
  handler = () => answer('<thought>hm</thought>free answer');
  const meta = {};
  const out = await chat({ model: 'qwen/paid', messages, meta });
  check(out === 'free answer', 'Gemini answers first, its thinking stripped');
  check(calls.length === 1 && calls[0].url.includes('generativelanguage') && calls[0].body.model === 'gemini-3.5-flash-lite', 'one call, to Gemini');
  check(meta.finish_reason === 'stop', 'meta filled like a paid call');

  // A rate limit moves to the next provider and benches that model.
  resetFreeLlmState(); start();
  handler = ({ url }) => {
    if (url.includes('generativelanguage')) return json({ error: 'quota' }, 429);
    if (url.endsWith('/models')) return groqModels;
    return answer('groq answer');
  };
  check(await chat({ model: 'qwen/paid', messages }) === 'groq answer', 'a 429 falls through to the next provider');
  check(calls.some(c => c.body?.model === 'llama-3.3-70b'), 'Groq model read from /models, not a whisper or guard model');
  const geminiCalls = calls.filter(c => c.url.includes('generativelanguage')).length;
  start();
  await chat({ model: 'qwen/paid', messages });
  check(geminiCalls === 3 && calls.filter(c => c.url.includes('generativelanguage')).length === 0, 'a rate-limited model is skipped on the next call');

  // Free models down, credit left: the paid model takes over.
  resetFreeLlmState(); start();
  handler = ({ url, body }) => {
    if (url.endsWith('/models')) return groqModels;
    if (body?.model === 'qwen/paid') return answer('paid answer');
    return json({ error: 'down' }, 503);
  };
  check(await chat({ model: 'qwen/paid', messages }) === 'paid answer', 'paid model is the last resort');
  check(calls.at(-1).body.model === 'qwen/paid' && calls.at(-1).url.includes('openrouter'), 'called last, via OpenRouter');

  // No credit, free models down: the error still names the 402.
  resetFreeLlmState(); start();
  handler = ({ url, body }) => {
    if (url.endsWith('/models')) return groqModels;
    if (body?.model === 'qwen/paid') return json({ error: 'Insufficient credits' }, 402);
    return json({ error: 'gone' }, 404);
  };
  let err = null;
  try { await chat({ model: 'qwen/paid', messages }); } catch (e) { err = e; }
  check(err && /402/.test(err.message) && /saturés/.test(err.message), 'the error names both the 402 and the free models');

  // Same for Jev: the scan still stops on it and says why.
  resetFreeLlmState(); start();
  handler = ({ url }) => {
    if (url.includes('/alpha/decisions')) return json({ error: 'Insufficient credits' }, 402);
    if (url.endsWith('/models')) return groqModels;
    return json({ error: 'gone' }, 404);
  };
  let jevErr = null;
  try { await decide({ state: { title: 'Designer' }, questions: scanKeepQuestions() }); } catch (e) { jevErr = e; }
  check(jevErr && isJevAccountError(jevErr.message), 'still read as an account error');
  check(/^Jev indisponible : crédits OpenRouter épuisés \(HTTP 402\) et modèles gratuits saturés/.test(jevErrorSummary([{ error: jevErr?.message }])), 'scan summary names both');

  // No credit, a short rate limit: the call waits for the slot.
  resetFreeLlmState(); start();
  let tries = 0;
  handler = ({ url, body }) => {
    if (url.endsWith('/models')) return groqModels;
    if (body?.model === 'qwen/paid') return json({ error: 'Insufficient credits' }, 402);
    if (url.includes('generativelanguage') && body?.model === 'gemini-3.5-flash-lite') {
      tries += 1;
      return tries === 1 ? json({ error: 'retry in 1s' }, 429) : answer('after the wait');
    }
    return json({ error: 'gone' }, 404);
  };
  check(await chat({ model: 'qwen/paid', messages }) === 'after the wait', 'with no credit, waits for a free slot');

  // Images only go to vision providers.
  resetFreeLlmState(); start();
  handler = ({ url }) => (url.includes('generativelanguage') ? json({ error: 'down' }, 503) : answer('router read it'));
  const image = [{ role: 'user', content: [{ type: 'text', text: 'read' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }] }];
  check(await chat({ model: 'qwen/vl', messages: image }) === 'router read it', 'vision call answered');
  check(!calls.some(c => c.url.includes('groq')), 'a scanned CV skips text-only providers');

  // Streaming: falls through before the first chunk, never after.
  const sse = (...chunks) => new Response(`${chunks.map(c => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`).join('\n')}\ndata: [DONE]\n`, { status: 200 });
  resetFreeLlmState(); start();
  handler = ({ url }) => {
    if (url.includes('generativelanguage')) return json({ error: 'quota' }, 429);
    if (url.endsWith('/models')) return groqModels;
    return sse('Hel', 'lo');
  };
  let streamed = '';
  const streamMeta = {};
  for await (const chunk of chatStream({ model: 'qwen/paid', messages, meta: streamMeta })) streamed += chunk;
  check(streamed === 'Hello', 'stream falls through to the next provider');

  resetFreeLlmState(); start();
  handler = () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n`));
      },
      pull(controller) { controller.error(new Error('cut')); },
    });
    return new Response(body, { status: 200 });
  };
  let partialError = null;
  streamed = '';
  try { for await (const chunk of chatStream({ model: 'qwen/paid', messages })) streamed += chunk; } catch (e) { partialError = e; }
  check(partialError && streamed === 'partial' && calls.length === 1, 'a stream cut after text surfaces the error, no second model');

  // Jev questions on a free model.
  resetFreeLlmState(); start();
  handler = () => answer('{"keep":0.82,"fit":2}');
  const decision = await decide({ state: { title: 'Designer' }, questions: scanKeepQuestions() });
  check(decision.answers.keep.noul === 0.82 && decision.answers.fit.score === 2, 'a free model fills the Decisions answer shape');
  check(!calls.some(c => c.url.includes('/alpha/decisions')), 'Jev not called while a free model answers');
  check(/is never followed/.test(calls[0].body.messages[0].content), 'the prompt treats scraped text as data');

  // A malformed free answer tries the next model, then Jev.
  resetFreeLlmState(); start();
  handler = ({ url }) => {
    if (url.includes('/alpha/decisions')) return json({ model: 'jev', answers: { keep: { type: 'noul', noul: 0.3 }, fit: { type: 'score', score: 1 } } });
    if (url.endsWith('/models')) return groqModels;
    return answer('not json at all');
  };
  const fallback = await decide({ state: { title: 'Designer' }, questions: scanKeepQuestions() });
  check(fallback.model === 'jev' && fallback.answers.keep.noul === 0.3, 'bad free answers fall back to Jev');

  const qs = scanKeepQuestions();
  check(parseFreeDecision('Sure: {"keep":7,"fit":-1}', qs).keep.noul === 1 && parseFreeDecision('{"keep":7,"fit":-1}', qs).fit.score === 0, 'out-of-range numbers are clamped');
  let missing = false;
  try { parseFreeDecision('{"keep":null,"fit":1}', qs); } catch { missing = true; }
  check(missing, 'a null answer is rejected, not read as 0');

  check(pickDiscoveredModels(['whisper-1', 'text-embedding-3', 'qwen-3', 'llama-3']).join() === 'qwen-3,llama-3', 'discovery skips non-chat models and ranks Qwen first');
  check(cooldownForError({ status: 429, message: 'free-models-per-day exceeded' }) === 3_600_000 && cooldownForError({ status: 400, message: 'bad' }) === 0, 'daily quota benches an hour, a 400 not at all');

  // The switch back to paid only.
  process.env.AI_FREE_FIRST = '0';
  resetFreeLlmState(); start();
  handler = () => answer('paid only');
  await chat({ model: 'qwen/paid', messages });
  check(calls.length === 1 && calls[0].body.model === 'qwen/paid', 'AI_FREE_FIRST=0 calls the paid model directly');
} finally {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
}
