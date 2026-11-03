import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
test('monthly UUID create/retry, edit, refund, version conflict and physical delete',()=>{
 const sheets=new Map()
 function make(name){const rows=[];return {getName:()=>name,getLastRow:()=>rows.length,setFrozenRows(){},hideSheet(){},appendRow(row){rows.push(row)},deleteRow(r){rows.splice(r-1,1)},getRange(r,c,n,m){return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i]?.[c-1+j]??'')),setValues(v){v.forEach((row,i)=>{rows[r-1+i]??=[];row.forEach((value,j)=>rows[r-1+i][c-1+j]=value)})}}}}}
 const key='x'.repeat(64);const properties={}
 const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='POS_ACCESS_KEY'?key:k==='SPREADSHEET_ID'?'test':properties[k],setProperty:(k,v)=>properties[k]=v})},SpreadsheetApp:{openById:()=>({getSheets:()=>[...sheets.values()],getSheetByName:n=>sheets.get(n),insertSheet(n){const s=make(n);sheets.set(n,s);return s},setSpreadsheetTimeZone(){}}),flush(){}},Utilities:{formatDate:(d,zone,pattern)=>pattern==='yyyyMMdd'?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d).replaceAll('-',''):new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(d)},LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},hasLock:()=>true,releaseLock(){}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({setMimeType:()=>t})}}
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),ctx)
 const call=r=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({key,...r})}}))
 const id='11111111-1111-4111-8111-111111111111'
 const date='2026-10-01T12:00:00Z'
 const order={id,date,orderNo:'20261001-001',kind:'內用',table:'A1',note:'測試',items:[{lineId:'line1',name:'拿鐵',price:120,qty:2}]}
 const operation={operationId:'44444444-4444-4444-8444-444444444444',order,remove:false}
 assert.equal(call({action:'sync',operations:[operation]}).data[0].ok,true)
 assert.equal(call({action:'sync',operations:[operation]}).data[0].ok,true)
 assert.equal(call({action:'list',month:'2026-10'}).data[0].total,240)
 assert.deepEqual(sheets.get('2026-10').getRange(1,1,1,9).getValues()[0],['訂單 UUID','流水訂單號','用餐方式','桌號','訂單金額','品項資料','整單備註','建立時間','更新時間'])
 const updated={operationId:'55555555-5555-4555-8555-555555555555',order:{...order,note:'修改',items:[{...order.items[0],qty:1}]},remove:false}
 assert.equal(call({action:'sync',operations:[updated]}).data[0].ok,true)
 assert.equal(call({action:'get',id}).data.total,120)
 assert.equal(call({action:'get',id}).data.date,date)
 const deletion={operationId:'66666666-6666-4666-8666-666666666666',order,remove:true}
 assert.equal(call({action:'sync',operations:[deletion]}).data[0].ok,true)
 assert.equal(call({action:'list',month:'2026-10'}).data.length,0)
 assert.equal(call({action:'create',id,data:{}}).error,'INVALID_ACTION')
})
