import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

test('menu sheet stores readable keys, independent sorting and no active column', () => {
  const sheets = new Map()
  const book = {getSheetByName: name => sheets.get(name), insertSheet(name) {
    const rows = []
    const sheet = {getLastRow: () => rows.length, setFrozenRows() {}, getRange(row, col, height, width) {
      return {getValues: () => Array.from({length: height}, (_, i) => Array.from({length: width}, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? '')), setValues(values) {
        values.forEach((valuesRow, i) => { rows[row - 1 + i] ??= []; valuesRow.forEach((value, j) => { rows[row - 1 + i][col - 1 + j] = value }) })
      }, clearContent() { for (let i = row - 1; i < row - 1 + height; i++) for (let j = col - 1; j < col - 1 + width; j++) rows[i][j] = '' }}
    }}
    sheets.set(name, sheet)
    return sheet
  }}
  const ctx = {SpreadsheetApp: {openById: () => book, flush() {}}, LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})}}
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), ctx)
  const props = {getProperty: () => 'sheet'}
  const entries = [
    {type:'分類',key:'茶',group:'茶',name:'茶',price:0,nextItemNo:2},
    {type:'分類',key:'咖啡',group:'咖啡',name:'咖啡',price:0,nextItemNo:1},
    {type:'設定',key:'熟客券優惠',group:'系統設定',name:'熟客券優惠',price:130},
    {type:'品項',key:'茶-001',group:'茶',name:'紅茶',price:100},
    {type:'品項',key:'茶-002',group:'茶',name:'綠茶',price:100},
    {type:'品項',key:'咖啡-001',group:'咖啡',name:'拿鐵',price:120},
  ]
  assert.equal(ctx.menu_({action:'menuSave',data:entries}, props).count, 6)
  const header = sheets.get('菜單').getRange(1,1,1,9).getValues()[0]
  assert.deepEqual(header, ['資料類型','資料鍵','分類','名稱','價格','排序','更新時間','冷熱選項','下個品項號碼'])
  const loaded = ctx.menu_({action:'menuGet'}, props).data
  assert.deepEqual(Array.from(loaded.map(row => row.sort)), [1,2,1,1,2,1])
  assert.equal(loaded[0].key, '茶')
  assert.equal(loaded[2].key, '熟客券優惠')
  assert.equal(loaded[3].key, '茶-001')
})
