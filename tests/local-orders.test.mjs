import test from 'node:test'
import assert from 'node:assert/strict'
import {enqueueLocal,taipeiDay} from '../app/utils/local-orders.mjs'
test('local checkout, edit/refund and delete queue snapshots keep UUID and original date',()=>{
 const state={orders:[],queue:[],counters:{}}
 const input={kind:'內用',table:'A1',items:[{lineId:crypto.randomUUID(),price:120,qty:2}]}
 const first=enqueueLocal(state,input)
 assert.equal(state.orders.length,1);assert.equal(first.total,240);assert.match(first.orderNo,/-001$/)
 enqueueLocal(state,{...first,items:[{...first.items[0],qty:1}]})
 assert.equal(state.orders[0].total,120);assert.equal(state.queue[0].order.total,240);assert.equal(state.queue[1].order.id,first.id)
 enqueueLocal(state,state.orders[0],true);assert.equal(state.orders.length,0);assert.equal(state.queue.length,3)
 assert.equal(new Set(state.queue.map(o=>o.operationId)).size,3)
 assert.throws(()=>enqueueLocal(state,{...first,items:[{lineId:'x',price:-1,qty:1}]}),/整數/)
 const discounted=enqueueLocal(state,{kind:'外帶',table:'',items:[{lineId:'coffee',group:'義式咖啡',name:'拿鐵',price:120,qty:1},{lineId:'discount',group:'減項',name:'折抵',price:-20,qty:1}]})
 assert.equal(discounted.total,100)
 assert.throws(()=>enqueueLocal(state,{kind:'外帶',table:'',items:[{lineId:'discount',group:'減項',name:'折抵',price:-200,qty:1}]}),/總金額/)
 assert.equal(state.counters[taipeiDay(discounted.date)],2)
 assert.equal(taipeiDay('2026-10-31T16:00:00Z'),'2026-11-01')
})
test('500 local orders keep unique numbers and independent snapshots',()=>{
 const state={orders:[],queue:[],counters:{}};const start=performance.now()
 for(let i=0;i<500;i++)enqueueLocal(state,{kind:'外帶',table:'',items:[{lineId:crypto.randomUUID(),name:'拿鐵',price:120,qty:1}]})
 assert.equal(new Set(state.orders.map(o=>o.orderNo)).size,500)
 assert.equal(state.queue.length,500)
 console.log('500 orders model elapsed ms:',Math.round(performance.now()-start))
})
