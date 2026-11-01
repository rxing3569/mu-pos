<script setup>
const baseURL = useRuntimeConfig().app.baseURL
onMounted(() => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${baseURL}sw.js`).catch(console.error)
})
</script>
<template><NuxtPage /></template>
