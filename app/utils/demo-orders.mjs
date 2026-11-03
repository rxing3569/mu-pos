import { taipeiDay } from './local-orders.mjs'

const drinks = new Set(['義式咖啡','賽風咖啡','茶','香濃奶茶','花草茶','冰沙','其他飲品'])
const tables = ['A1','A2','B1','B2','B3','B4',...Array.from({length:10},(_,i)=>String(i+1))]
const sweetness = ['正常','半','少','微','無']
const ice = ['正常','半','少','微','無']
const mealDrinks = ['紅茶','綠茶','奶茶','咖啡']

export function makeDemoOrders(state, menu, discount, now = new Date()) {
  const available = menu.filter(item => item.group !== '熟客券' && item.group !== '減項' && Number.isSafeInteger(item.price) && item.price > 0)
  if (!available.length) throw Error('菜單沒有可產生測試資料的品項')
  // Use the last three complete calendar months so every day has a full sample.
  const today = taipeiDay(now)
  const [year, month] = today.slice(0,7).split('-').map(Number)
  const queued = new Set(state.queue.map(operation => operation.order.id))
  const existing = state.orders.filter(order => !order.demoSeed || queued.has(order.id))
  const counters = {...state.counters}
  for (const order of existing) {
    const day = taipeiDay(order.date)
    const number = Number(order.orderNo?.split('-').at(-1)) || 0
    counters[day] = Math.max(counters[day] || 0, number)
  }
  let seed = 3569
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const pick = list => list[Math.floor(random()*list.length)]
  const generated = []
  for (let offset = 3; offset >= 1; offset--) {
    const first = new Date(Date.UTC(year, month - 1 - offset, 1))
    const y = first.getUTCFullYear(), m = first.getUTCMonth()
    const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    for (let day = 1; day <= count; day++) {
      const dateKey = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      const weekday = new Date(Date.UTC(y,m,day)).getUTCDay()
      const target = (weekday === 0 || weekday === 6 ? 100 : 50) + Math.floor(random()*11)-5
      for (let n = 0; n < target; n++) {
        const items = Array.from({length:1+Math.floor(random()*5)}, () => {
          const product = pick(available)
          const isDrink = drinks.has(product.group) && product.name !== '啤酒'
          const variant = isDrink ? (product.group === '冰沙' ? '冰' : random()<.57 ? '冰' : '熱') : ''
          const loyal = random() < .16
          const basePrice = product.price
          const loyaltyAmount = loyal ? (Math.round(discount) > 0 ? Math.round(discount) : 130) : 0
          const item = {id:product.id,group:product.group,name:product.name,lineId:crypto.randomUUID(),qty:1+Math.floor(random()*3),variant,basePrice,price:Math.max(0,basePrice-loyaltyAmount),loyaltyApplied:loyal,loyaltyAmount,sweetness:isDrink?pick(sweetness):'正常',ice:variant==='冰'?pick(ice):'',heat:variant==='熱'?pick(['熱','溫']):''}
          if (product.group === '主餐') item.mealDrink = {name:pick(mealDrinks),variant:pick(['冰','熱']),sweetness:pick(sweetness),ice:pick(ice),heat:'熱'}
          return item
        })
        const number = (counters[dateKey] || 0) + 1
        counters[dateKey] = number
        const hour = 9 + Math.floor(random()*12), minute = Math.floor(random()*60)
        const date = new Date(Date.UTC(y,m,day,hour-8,minute)).toISOString()
        const takeaway = random() < .22
        generated.push({id:crypto.randomUUID(),orderNo:dateKey.replaceAll('-','')+'-'+String(number).padStart(3,'0'),date,updatedAt:date,month:dateKey.slice(0,7),kind:takeaway?'外帶':'內用',table:takeaway?'':pick(tables),note:'',items,total:items.reduce((sum,item)=>sum+item.price*item.qty,0),demoSeed:'v1'})
      }
    }
  }
  state.orders = [...existing,...generated]
  state.counters = counters
  return generated.length
}
