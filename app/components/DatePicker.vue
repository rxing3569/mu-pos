<script setup>
const props = defineProps({ modelValue: String, day: String })
const emit = defineEmits(['update:modelValue', 'update:day'])
const dialog = ref(null)
const cursor = ref(props.modelValue)
watch(() => props.modelValue, value => { if (value) cursor.value = value })
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const label = computed(() => props.day ? props.day.replaceAll('-', ' / ') : '選擇日期')
const title = computed(() => { const [year,month] = cursor.value.split('-').map(Number); return `${year} 年 ${month} 月` })
const cells = computed(() => {
  const [year,month] = cursor.value.split('-').map(Number)
  const first = new Date(Date.UTC(year,month-1,1))
  const offset = first.getUTCDay()
  return Array.from({length:42}, (_,index) => {
    const date = new Date(Date.UTC(year,month-1,index-offset+1))
    const value = date.toISOString().slice(0,10)
    return {value,day:date.getUTCDate(),outside:value.slice(0,7)!==cursor.value}
  })
})
function move(delta) {
  const [year,month] = cursor.value.split('-').map(Number)
  cursor.value = new Date(Date.UTC(year,month-1+delta,1)).toISOString().slice(0,7)
}
function choose(value) { emit('update:modelValue',value.slice(0,7)); emit('update:day',value); dialog.value.close() }
</script>
<template>
  <div class="date-control">
    <button class="date-trigger" type="button" aria-haspopup="dialog" :aria-label="'選擇日期，目前 '+label" @click="dialog.showModal()"><UiIcon name="clock"/><span>{{label}}</span><span class="date-trigger-chevron">⌄</span></button>
    <dialog ref="dialog" class="date-popover" aria-label="選擇訂單日期" @click="event=>{if(event.target===dialog)dialog.close()}">
      <div class="calendar-body">
        <header class="calendar-head"><button type="button" aria-label="上一個月" @click="move(-1)">‹</button><h2>{{title}}</h2><button type="button" aria-label="下一個月" @click="move(1)">›</button></header>
        <div class="calendar-weekdays"><span v-for="dayName in ['日','一','二','三','四','五','六']" :key="dayName">{{dayName}}</span></div>
        <div class="calendar-grid"><button v-for="cell in cells" :key="cell.value" type="button" :class="{selected:cell.value===day,outside:cell.outside,today:cell.value===today}" :aria-label="cell.value" :aria-pressed="cell.value===day" @click="choose(cell.value)">{{cell.day}}</button></div>
      </div>
    </dialog>
  </div>
</template>
