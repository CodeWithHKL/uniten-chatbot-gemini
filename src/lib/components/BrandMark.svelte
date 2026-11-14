<script lang="ts">
  let { size = 36, class: className = '' }: { size?: number; class?: string } = $props();
</script>

<span
  class="flex items-center justify-center rounded-full bg-white shadow-md shadow-red-950/25 shrink-0 {className}"
  style="width: {size}px; height: {size}px; padding: {Math.round(size * 0.1)}px"
>
  <img src="/uniten-logo.svg" alt="UNITEN" class="block max-w-full max-h-full object-contain" />
</span>
