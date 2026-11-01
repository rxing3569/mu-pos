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
 const id='11111111-1111-4111-8111-111111111111'
 const data={kind:'內用',table:'A1',note:'測試',items:[{lineId:'line1',name:'拿鐵',price:120,qty:2}]}
 const call=r=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({key,...r})}}))
 let r=call({action:'create',id,data});assert.equal(r.ok,true);assert.equal(r.data.total,240);const month=r.data.month,date=r.data.date;assert.match(r.data.orderNo,/^[0-9]{8}-001$/)
 assert.equal(call({action:'create',id,data}).data.version,1);assert.equal(Object.values(properties)[0],'1')
 assert.equal(call({action:'list',month}).data.length,1)
 assert.equal(call({action:'update',id,version:0,data}).error,'VERSION_CONFLICT')
 r=call({action:'refund',id,version:1,lineId:'line1',qty:1,reason:'點錯'});assert.equal(r.data.total,120);assert.equal(r.data.items[0].qty,1)
 r=call({action:'update',id,version:2,data:{...data,items:[{...data.items[0],price:100}]}});assert.equal(r.data.total,200);assert.equal(r.data.date,date);assert.equal(r.data.month,month);assert.match(r.data.orderNo,/-001$/)
 assert.equal(call({action:'refund',id,version:3,lineId:'line1',qty:3,reason:'錯誤'}).error,'INVALID_REFUND')
 r=call({action:'refund',id,version:3,lineId:'line1',qty:2,reason:'全退'});assert.equal(r.data.total,0);assert.equal(r.data.items.length,0)
 assert.equal(call({action:'delete',id,version:4}).ok,true);assert.equal(call({action:'list',month}).data.length,0);const newId='22222222-2222-4222-8222-222222222222';assert.match(call({action:'create',id:newId,data}).data.orderNo,/-002$/)
 const offlineId='33333333-3333-4333-8333-333333333333'
 const offline={id:offlineId,date:'2020-01-01T12:00:00Z',orderNo:'20200101-001',...data}
 const operation={operationId:'44444444-4444-4444-8444-444444444444',order:offline,remove:false}
 let batch=call({action:'sync',operations:[operation]});assert.equal(batch.data[0].ok,true)
 assert.equal(call({action:'list',month:'2020-01'}).data[0].total,240)
 assert.equal(call({action:'sync',operations:[operation]}).data[0].ok,true)
 assert.equal(call({action:'list',month:'2020-01'}).data[0].version,1);const initial=call({action:'list',month:'2020-01'});assert.equal(initial.data.length,1);assert.equal(initial.nextOffset,null);assert.equal(call({action:'list',month:'2020-01',revision:'stale'}).error,'STALE_CURSOR')
 const refundOp={operationId:'55555555-5555-4555-8555-555555555555',order:{...offline,items:[{...offline.items[0],qty:1}]},remove:false}
 assert.equal(call({action:'sync',operations:[refundOp]}).data[0].ok,true)
 call({action:'sync',operations:[refundOp]});assert.equal(call({action:'list',month:'2020-01'}).data[0].total,120)
 const deletion={operationId:'66666666-6666-4666-8666-666666666666',order:offline,remove:true}
 assert.equal(call({action:'sync',operations:[deletion]}).data[0].ok,true);call({action:'sync',operations:[deletion]});assert.equal(call({action:'list',month:'2020-01'}).data.length,0);const delta=call({action:'changes',month:'2020-01',since:0});assert.deepEqual(delta.deleted,[offlineId]);assert.equal(delta.data.length,0)
 assert.equal(call({action:'sync',operations:[operation],key:'bad'}).error,'UNAUTHORIZED')
 const props=ctx.PropertiesService.getScriptProperties();assert.equal(ctx.nextNumber_(props,'1999-01-01T15:59:00Z'),'19990101-001');assert.equal(ctx.nextNumber_(props,'1999-01-01T16:00:00Z'),'19990102-001');assert.equal(ctx.nextNumber_(props,'1999-01-01T16:01:00Z'),'19990102-002')
})
