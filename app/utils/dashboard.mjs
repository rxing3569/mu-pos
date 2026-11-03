const taipeiDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
})

export function dayKey(value) {
  return taipeiDateFormatter.format(new Date(value))
}

export function dailyRevenue(orders, month) {
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
  const days = Array.from({length: count}, (_, index) => ({
    date: month + '-' + String(index + 1).padStart(2, '0'), total: 0, count: 0
  }))
  for (const order of orders) {
    const date = dayKey(order.date)
    if (!date.startsWith(month)) continue
    const day = days[Number(date.slice(8)) - 1]
    if (!day) continue
    day.total += order.total
    day.count++
  }
  return days
}

export function itemCount(order) {
  return order.items.reduce((total, item) => total + item.qty, 0)
}
