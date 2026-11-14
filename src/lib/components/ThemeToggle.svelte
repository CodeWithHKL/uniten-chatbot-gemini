<script lang="ts">
  import { Sun, Moon } from '@lucide/svelte';

  // Which icon shows is decided purely by CSS (app.css), so it is correct on first paint and
  // follows the system theme until a choice is saved.
  function toggle() {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // storage unavailable (private mode): the choice just applies to this visit
    }
  }
</script>

<button
  onclick={toggle}
  aria-label="Toggle light and dark theme"
  title="Toggle light / dark theme"
  class="w-9 h-9 rounded-lg grid place-items-center text-white/85 hover:text-white hover:bg-white/15 active:scale-95 transition"
>
  <Sun size={18} class="theme-sun" />
  <Moon size={18} class="theme-moon" />
</button>
