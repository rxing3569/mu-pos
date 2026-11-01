<script setup>
const props=defineProps({name:{type:String,default:'orders'}})
const paths={
menu:'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h4',
settings:'M4 5h16 M4 12h16 M4 19h16 M8 3v4 M16 10v4 M10 17v4',
orders:'M7 3h10v3h3v15H4V6h3z M7 3v5h10V3 M8 12h8 M8 16h5',
chart:'M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-9',
refresh:'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 3 M4 15l2 3a7 7 0 0 0 12-1',
chevron:'m8 10 4 4 4-4',
clock:'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
wallet:'M3 6h16v4 M3 6v14h18V9H3 M3 6l13-3v3 M16 14h5',
bag:'M4 7h16l1 14H3z M8 8V6a4 4 0 0 1 8 0v2',
download:'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',
link:'m10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'
}
</script>
<template><svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[props.name]||paths.orders"/></svg></template>
