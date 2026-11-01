import test from 'node:test'
import assert from 'node:assert/strict'
import {dayKey,dailyRevenue,itemCount} from '../app/utils/dashboard.mjs'
test('dashboard groups orders by Taipei day and fills days with zero',()=>{
 const orders=[{date:'2026-10-01T16:30:00Z',total:100,items:[{qty:2}]},{date:'2026-10-02T10:00:00Z',total:200,items:[]}]
 assert.equal(dayKey(orders[0].date),'2026-10-02')
 const days=dailyRevenue(orders,'2026-10');assert.equal(days.length,31);assert.equal(days[0].total,0);assert.equal(days[1].total,300);assert.equal(days[1].count,2);assert.equal(itemCount(orders[0]),2)
 assert.equal(dailyRevenue([],'2024-02').length,29)
})
