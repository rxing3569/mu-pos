<script setup>
const props = defineProps({modelValue:String})
const emit = defineEmits(['update:modelValue'])
const dialog = ref(null)
const year = ref(Number(props.modelValue?.slice(0,4)) || new Date().getFullYear())
watch(() => props.modelValue, value => { if(value) year.value=Number(value.slice(0,4)) })
function choose(month) { emit('update:modelValue',`${year.value}-${String(month).padStart(2,'0')}`); dialog.value.close() }
</script>
<template><div class="date-control"><button type="button" class="date-trigger" aria-haspopup="dialog" @click="dialog.showModal()"><UiIcon name="clock"/><span>{{modelValue?.replace('-',' 年 ')}} 月</span><UiIcon class="date-trigger-chevron" name="chevron"/></button><dialog ref="dialog" class="date-popover month-popover" aria-label="選擇月份" @click="event=>{if(event.target===dialog)dialog.close()}"><div class="calendar-body"><header class="calendar-head"><button type="button" aria-label="上一年" @click="year--"><UiIcon name="left"/></button><h2>{{year}} 年</h2><button type="button" aria-label="下一年" @click="year++"><UiIcon name="right"/></button></header><div class="month-grid"><button v-for="month in 12" :key="month" type="button" :class="{selected:modelValue===`${year}-${String(month).padStart(2,'0')}`}" @click="choose(month)">{{month}} 月</button></div></div></dialog></div></template>
