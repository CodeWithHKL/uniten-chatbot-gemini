<script lang="ts">
  import '@fontsource-variable/google-sans';
  import '../app.css';

  let { children } = $props();
</script>

<svelte:head>
  <title>UNITEN Chatbot Concept</title>
  <meta
    name="description"
    content="Ask questions about Universiti Tenaga Nasional (UNITEN) with an AI chatbot powered by Gemini."
  />
</svelte:head>

{@render children()}
