import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { json } from '@sveltejs/kit';
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL, MAINTENANCE_MODE } from '$app/env/private';
import { pagesFor } from '#lib/server/officialPages.js';
import type { RequestHandler } from './$types';

const MAX_HISTORY = 10;

const SYSTEM_PROMPT = `You are a chatbot for Universiti Tenaga Nasional (UNITEN), Malaysia; answer only UNITEN-related questions, and if unsure or out of scope, say you don’t know and do not fabricate information. UNITEN is a private universiti owned by TNB Tenaga Nasional Berhad. Keep answers concise and complete, normally under 200 words; for lists, give at most 8 short items unless the user asks for a full list (see below), and never leave a sentence or list unfinished.

Full lists: if the user asks for all, every, or the full list of programmes or courses, give the complete list from the listed pages, with no item limit, grouped by level or college and in the exact names used on the pages. If they did not say which level (foundation, diploma, bachelor’s, postgraduate), do not dump everything: first give a one-line overview of the levels offered and ask which level to list. If they name a level or field, list every programme in it.

Clarify only when needed: if the listed official pages already answer the question, just answer it; for example, when asked for a specific programme’s entry requirements, list the requirements for each qualification shown on the page rather than asking which one the user holds. Only when a question is genuinely too vague or unclear to answer correctly (for example "what can I study?", a message with unreadable or missing grades, or an eligibility question without the qualification, results, or area of interest), do not answer or say you don’t know yet. Ask one short clarifying question (two at most) to get exactly what is missing, e.g. the qualification (SPM, UEC, STPM, matriculation, diploma), the grades or number of credits and whether they include Mathematics, Additional Mathematics, English, or science subjects, and the field they like. Use the earlier messages in the conversation, and do not ask again for things the user already told you.

Undecided students: if the user does not know what to study, do not assume a level and do not just list colleges. Start with ONE short, friendly question about their qualification (SPM, UEC, STPM, matriculation, diploma, or other), explaining in one sentence why it matters: SPM leavers usually start with a diploma or foundation programme, while STPM, matriculation, foundation or diploma holders can go for a bachelor’s degree. Once they answer, ask what subjects or fields they enjoy (one question), then suggest up to 3 matching programmes from the pages. Never ask more than one question per message in this situation. Source links are added automatically after your reply: never write a source line or URL list yourself.

Eligibility: when the user has given enough details and the listed pages are programme pages, compare their results with each page’s entry requirements and list only the programmes they appear to meet (at most 5, name them exactly as on the page). Say that final eligibility is confirmed by UNITEN admissions. Remember that degrees generally need STPM, matriculation, foundation or a diploma, so SPM leavers are usually eligible for diploma or foundation programmes.

Official pages: when the user message lists official UNITEN pages, read them and answer only from what they say. Never use any other website. If those pages do not contain the answer, say you don’t know and suggest visiting https://www.uniten.edu.my/. When no pages are listed, do not guess specifics such as programmes, entry requirements, fees, intakes, dates, contacts or facilities: say you don’t know and suggest visiting https://www.uniten.edu.my/.`;

// Markdown footer listing the official pages Gemini actually read (only www.uniten.edu.my).
function sourcesFooter(urls: string[]): string {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.hostname !== 'www.uniten.edu.my' || seen.has(url.href)) continue;
    seen.add(url.href);
    const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    const label = slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'UNITEN website';
    links.push(`[${label}](${url.href})`);
    if (links.length === 3) break;
  }
  return links.length ? `\n\n**Source:** ${links.join(' · ')}` : '';
}

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request }) => {
  // Set MAINTENANCE_MODE=true in the env vars (then redeploy) to disable the API.
  if (MAINTENANCE_MODE === 'true') {
    return json({ reply: 'The chatbot is under maintenance. Please check back soon.' }, { status: 503 });
  }

  const apiKey = GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return json({ reply: 'The chatbot is not configured correctly. Please try again later.' }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => null);
    const message = body?.message;

    if (typeof message !== 'string' || !message.trim() || message.length > 400) {
      return json({ reply: 'Please enter a message of up to 400 characters.' }, { status: 400 });
    }

    // Sanitize client-supplied history: only user/assistant turns, capped in count and length
    const rawHistory: unknown = body?.history;
    const history = (Array.isArray(rawHistory) ? rawHistory : [])
      .filter(
        (m): m is { role: 'user' | 'assistant'; content: string } =>
          !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content.slice(0, 1000) }]
      }));

    // Attach the official pages relevant to this question; Gemini's URL context tool can read only
    // the URLs present in the request, which keeps lookups limited to www.uniten.edu.my.
    const recentUserText = (Array.isArray(rawHistory) ? rawHistory : [])
      .filter((m): m is { role: 'user'; content: string } => m?.role === 'user' && typeof m.content === 'string')
      .slice(-2)
      .map((m) => m.content.slice(0, 400))
      .join('\n');
    const pages = pagesFor(message, recentUserText);
    const userText = pages.length ? `${message}\n\nOfficial UNITEN pages:\n${pages.join('\n')}` : message;

    const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 15_000 } });
    const request_ = {
      contents: [...history, { role: 'user', parts: [{ text: userText }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ urlContext: {} }],
        temperature: 0.3,
        // Headroom so replies are not cut mid-sentence; the prompt keeps answers short.
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }
      }
    };

    // Primary model first, then the fallback (e.g. when the free-tier daily limit is hit).
    // Fallback is only possible before the first chunk is sent.
    const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i);
    let stream;
    let lastError: unknown;
    outer: for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          stream = await ai.models.generateContentStream({ ...request_, model });
          break outer;
        } catch (err) {
          lastError = err;
          const status = (err as { status?: number }).status;
          console.error(`Gemini ${model} failed (${status ?? (err as Error).name}); ${attempt === 0 ? 'retrying' : 'moving on'}`);
          // Quota (429) or a missing model will not clear by retrying: go straight to the fallback.
          if (status === 429 || status === 404) break;
          // Retry once on overload/timeouts, otherwise fall through to the next model.
          const transient = status === 503 || status === 504 || (err as Error).name === 'AbortError';
          if (!transient) throw err;
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }
    if (!stream) throw lastError;

    // Stream plain text back so the reply appears as it is generated.
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const fetched: string[] = [];
          for await (const chunk of stream) {
            if (chunk.text) controller.enqueue(encoder.encode(chunk.text));
            // Gemini reports the pages it really read (usually in the last chunk).
            for (const u of chunk.candidates?.[0]?.urlContextMetadata?.urlMetadata ?? []) {
              if (u.retrievedUrl && String(u.urlRetrievalStatus).endsWith('SUCCESS')) fetched.push(u.retrievedUrl);
            }
          }
          const sources = sourcesFooter(fetched);
          if (sources) controller.enqueue(encoder.encode(sources));
        } catch (err) {
          console.error('Gemini stream error:', err);
        }
        controller.close();
      }
    });
    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Gemini API Error:', error);
    if ((error as { status?: number }).status === 429) {
      return json({ reply: 'The AI is receiving too many requests right now (rate limit). Please wait a minute and try again.' }, { status: 429 });
    }
    return json({ reply: 'Something went wrong while contacting the AI. Please try again.' }, { status: 500 });
  }
};
