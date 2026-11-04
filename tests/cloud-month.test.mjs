import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchCloudMonth } from '../app/utils/cloud-month.mjs'

test('large global sync log uses monthly pages instead of hundreds of changes requests', async () => {
  const calls = []
  const local = {cachedMonth:'2026-10',syncCursor:0,orders:[]}
  const request = async (_key, input) => {
    calls.push(input)
    if (input.action === 'changes') return {data:[],deleted:[],nextCursor:201,syncCursor:67000}
    if (input.offset === 0) return {data:[{id:'a'}],nextOffset:1,revision:'r1',syncCursor:67000}
    return {data:[{id:'b'}],nextOffset:null,revision:'r1',syncCursor:67000}
  }
  const result = await fetchCloudMonth('key','2026-10',local,request)
  assert.deepEqual(calls.map(call => call.action), ['changes','list','list'])
  assert.deepEqual(result.orders.map(order => order.id), ['a','b'])
})

test('incremental changes finish for a small log gap', async () => {
  const local = {cachedMonth:'2026-10',syncCursor:10,orders:[{id:'old',month:'2026-10'}]}
  const result = await fetchCloudMonth('key','2026-10',local,async (_key,input) => {
    assert.equal(input.action,'changes')
    return {data:[{id:'new',month:'2026-10'}],deleted:['old'],nextCursor:12,syncCursor:12}
  })
  assert.deepEqual(result.orders.map(order => order.id), ['new'])
})

test('stalled cloud pagination stops instead of repeating requests', async () => {
  await assert.rejects(fetchCloudMonth('key','2026-10',{orders:[]},async () => ({data:[],nextOffset:0,syncCursor:0})),/沒有前進/)
})
