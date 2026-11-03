import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { makeDemoOrders, normalizeDemoOrder } from '../app/utils/demo-orders.mjs'

test('generated and existing demo drink variants match cloud sync schema', () => {
  const state = {orders:[],queue:[],counters:{}}
  makeDemoOrders(state,[{id:'tea-001',group:'茶',name:'紅茶',price:80}],0,new Date('2026-11-03T00:00:00Z'))
  assert.ok(state.orders.length > 0)
  assert.ok(state.orders.every(order => order.items.every(item => ['冰杯','熱杯'].includes(item.variant))))
  const old = {...state.orders[0],items:[{...state.orders[0].items[0],variant:'冰'}]}
  assert.equal(normalizeDemoOrder(old).items[0].variant,'冰杯')
})

test('three months of demo orders pass Apps Script validation and request size limits', () => {
  const state = {orders:[],queue:[],counters:{}}
  const menu = [
    {id:'tea-001',group:'茶',name:'紅茶',price:80},
    {id:'meal-001',group:'主餐',name:'義大利麵',price:250},
    {id:'cake-001',group:'今日蛋糕',name:'蛋糕',price:100},
    {id:'smoothie-001',group:'冰沙',name:'咖啡冰沙',price:150},
  ]
  makeDemoOrders(state,menu,130,new Date('2026-11-03T00:00:00Z'))
  const context = {}
  vm.createContext(context)
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context)
  for (const order of state.orders) assert.doesNotThrow(() => context.validate_(structuredClone(order)))
  const operation = {operationId:crypto.randomUUID(),order:state.orders[0],remove:false}
  assert.ok(Buffer.byteLength(JSON.stringify({action:'sync',operations:Array(10).fill(operation),key:'x'.repeat(64)})) < 100000)
})
