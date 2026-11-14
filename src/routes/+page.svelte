<script lang="ts">
  import { tick } from 'svelte';
  import {
    ArrowUp,
    SquarePen,
    Copy,
    Check,
    RotateCw,
    GraduationCap,
    MapPin,
    FileText,
    Building2
  } from '@lucide/svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import BrandMark from '#lib/components/BrandMark.svelte';
  import ThemeToggle from '#lib/components/ThemeToggle.svelte';

  interface Message {
    role: 'bot' | 'user';
    content: string;
    isError?: boolean;
  }

  const CHARACTER_LIMIT = 400;
  const HISTORY_LIMIT = 10; // max previous messages sent to the bot

  const SUGGESTIONS = [
    { icon: GraduationCap, title: 'Programmes', text: 'What programmes does UNITEN offer?' },
    { icon: MapPin, title: 'Campus', text: 'Where is the UNITEN campus?' },
    { icon: FileText, title: 'Admission', text: 'How do I apply for admission?' },
    { icon: Building2, title: 'About', text: 'Who owns UNITEN?' }
  ];

  let messages = $state<Message[]>([]);
  let input = $state('');
  let isLoading = $state(false); // waiting for the first chunk
  let isStreaming = $state(false); // reply is arriving
  let copiedIndex = $state<number | null>(null);
  let scrollEl: HTMLDivElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  const busy = $derived(isLoading || isStreaming);

  async function scrollToBottom(smooth = true) {
    await tick();
    scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function renderMarkdown(src: string): string {
    // Only called for bot messages, which exist only in the browser
    return DOMPurify.sanitize(marked.parse(src, { async: false, gfm: true }));
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    // Last few real turns (no error notices) so the bot remembers the chat
    const history = messages
      .filter((m) => !m.isError && m.content)
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

    messages.push({ role: 'user', content });
    input = '';
    isLoading = true;
    scrollToBottom();

    const fail = (reply: string) => messages.push({ role: 'bot', content: reply, isError: true });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, history }),
        signal: AbortSignal.timeout(45_000)
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        fail(data?.reply ?? 'Something went wrong. Please try again.');
      } else {
        // Stream the reply into a new bot message as it arrives
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let idx = -1;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (idx === -1) {
            messages.push({ role: 'bot', content: '' });
            idx = messages.length - 1;
            isLoading = false;
            isStreaming = true;
          }
          messages[idx].content += chunk;
          scrollToBottom(false);
        }
        if (idx === -1) fail("I couldn't generate a reply. Please try again.");
      }
    } catch {
      fail("Couldn't get a reply in time. Please try again.");
    } finally {
      isLoading = false;
      isStreaming = false;
      scrollToBottom();
      inputEl?.focus();
    }
  }

  function newChat() {
    if (busy) return;
    messages = [];
    input = '';
    inputEl?.focus();
  }

  function regenerate() {
    if (busy) return;
    while (messages.length && messages[messages.length - 1].role === 'bot') messages.pop();
    const last = messages.pop();
    if (last) send(last.content);
  }

  async function copy(i: number) {
    await navigator.clipboard.writeText(messages[i].content);
    copiedIndex = i;
    setTimeout(() => (copiedIndex = null), 1500);
  }
</script>

<div class="flex h-dvh bg-canvas text-ink">
  <main class="flex-1 flex flex-col min-w-0 min-h-0 relative">
    <div class="doodle absolute inset-0 pointer-events-none" aria-hidden="true"></div>

    <header
      class="relative h-16 px-4 md:px-6 flex items-center gap-3 shrink-0 text-white bg-gradient-to-r from-[#c4141b] to-[#8f0f15] shadow-md shadow-red-950/20"
    >
      <BrandMark size={36} />
      <div class="leading-tight min-w-0">
        <h1 class="text-sm font-semibold tracking-tight truncate">UNITEN Chatbot</h1>
        <p class="text-[11px] text-white/75 truncate">Universiti Tenaga Nasional</p>
      </div>
      <div class="ml-auto flex items-center gap-3 sm:gap-4">
        <button
          onclick={newChat}
          disabled={messages.length === 0 || busy}
          aria-label="New chat"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-[#a30f15] text-sm font-semibold shadow-sm hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-0 disabled:pointer-events-none"
        >
          <SquarePen size={16} strokeWidth={2.25} />
          <span class="hidden sm:inline">New chat</span>
        </button>
        <ThemeToggle />
      </div>
    </header>

    <div bind:this={scrollEl} class="relative flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-4 md:px-6 py-8">
        {#if messages.length === 0 && !isLoading}
          <div class="min-h-[55vh] flex flex-col items-center justify-center text-center animate-rise">
            <div class="relative mb-6">
              <div class="absolute inset-0 bg-accent/30 blur-2xl rounded-full" aria-hidden="true"></div>
              <BrandMark size={64} class="relative" />
            </div>
            <h2 class="text-3xl font-bold tracking-tight mb-2">
              Hi, I'm the <span class="text-accent">UNITEN</span> Chatbot
            </h2>
            <p class="text-sm text-muted mb-10 max-w-md">
              Ask me about programmes, admission, campus life and more. If I don't know the answer, I'll say so.
            </p>
            <div class="grid sm:grid-cols-2 gap-3 w-full max-w-xl text-left">
              {#each SUGGESTIONS as { icon: Icon, title, text } (text)}
                <button
                  onclick={() => send(text)}
                  class="group flex items-start gap-3 p-4 rounded-2xl border border-line bg-panel/90 backdrop-blur-sm hover:border-accent hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-900/10 transition"
                >
                  <span
                    class="w-9 h-9 rounded-lg bg-accent/10 text-accent grid place-items-center shrink-0 group-hover:bg-accent group-hover:text-accent-ink transition-colors"
                  >
                    <Icon size={18} />
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">{title}</span>
                    <span class="block text-sm text-muted">{text}</span>
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="space-y-6">
            {#each messages as msg, i}
              {#if msg.role === 'user'}
                <div class="flex justify-end animate-rise">
                  <div
                    class="max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-gradient-to-br from-[#d71920] to-[#a30f15] text-bubble-ink text-[15px] leading-relaxed whitespace-pre-wrap break-words shadow-md shadow-red-900/20"
                  >
                    {msg.content}
                  </div>
                </div>
              {:else}
                <div class="flex gap-3 animate-rise">
                  <BrandMark size={32} class="mt-0.5" />
                  <div class="min-w-0 max-w-[85%] md:max-w-[75%]">
                    <div
                      class="px-4 py-2.5 rounded-2xl rounded-tl-md border bg-panel text-[15px] leading-relaxed break-words {msg.isError
                        ? 'border-accent/50 text-accent'
                        : 'border-line'}"
                    >
                      <div class="md {isStreaming && i === messages.length - 1 ? 'caret' : ''}">
                        {@html renderMarkdown(msg.content)}
                      </div>
                    </div>
                    {#if !msg.isError && !(isStreaming && i === messages.length - 1)}
                      <div class="mt-1.5 ml-1 flex items-center gap-1 text-muted">
                        <button
                          onclick={() => copy(i)}
                          aria-label="Copy reply"
                          class="p-1.5 rounded-md hover:text-accent hover:bg-accent/10 transition"
                        >
                          {#if copiedIndex === i}<Check size={14} />{:else}<Copy size={14} />{/if}
                        </button>
                        {#if i === messages.length - 1}
                          <button
                            onclick={regenerate}
                            aria-label="Regenerate reply"
                            class="p-1.5 rounded-md hover:text-accent hover:bg-accent/10 transition"
                          >
                            <RotateCw size={14} />
                          </button>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            {/each}

            {#if isLoading}
              <div class="flex gap-3" aria-label="Bot is typing">
                <BrandMark size={32} />
                <div class="flex items-center gap-1 px-4 h-10 rounded-2xl rounded-tl-md border border-line bg-panel">
                  {#each [0, 1, 2] as d}
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-accent"
                      style="animation: typing 1.2s infinite; animation-delay: {d * 0.15}s"
                    ></span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="relative px-4 md:px-6 pb-4 md:pb-6 pt-2 shrink-0">
      <form
        onsubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        class="max-w-3xl mx-auto flex items-center gap-2 pl-5 pr-2 py-2 rounded-full border border-line bg-panel shadow-lg shadow-red-900/5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15 transition"
      >
        <input
          bind:this={inputEl}
          type="text"
          bind:value={input}
          maxlength={CHARACTER_LIMIT}
          placeholder="Ask about UNITEN…"
          aria-label="Message"
          class="flex-1 min-w-0 bg-transparent py-2 text-[15px] outline-none placeholder:text-muted"
        />
        {#if input.length >= CHARACTER_LIMIT - 50}
          <span class="text-xs tabular-nums text-muted">{input.length}/{CHARACTER_LIMIT}</span>
        {/if}
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send message"
          class="w-10 h-10 rounded-full bg-gradient-to-br from-[#d71920] to-[#a30f15] text-accent-ink grid place-items-center shrink-0 hover:brightness-110 active:scale-95 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowUp size={18} strokeWidth={2.5} />
        </button>
      </form>
      <p class="max-w-3xl mx-auto mt-2 text-center text-[11px] text-muted">
        AI-generated answers may be inaccurate. Verify important details with UNITEN. Messages are processed by
        Google Gemini.
      </p>
    </div>
  </main>
</div>
