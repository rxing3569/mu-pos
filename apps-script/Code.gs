const HEADER=['訂單 UUID','流水訂單號','用餐方式','桌號','訂單金額','品項資料','整單備註','建立時間','更新時間'];
const MENU_HEADER=['資料類型','資料鍵','分類','名稱','價格','排序','更新時間','冷熱選項','下個品項號碼'];
function checkHeader_(sheet,header){if(sheet.getLastRow()<1)return;const actual=sheet.getRange(1,1,1,header.length).getValues()[0];if(header.some((value,index)=>actual[index]!==value))throw Error('SCHEMA_MISMATCH');}
function setup(){
const p=PropertiesService.getScriptProperties();if((p.getProperty('POS_ACCESS_KEY')||'').length<32)throw Error('請設定至少32字元密碼');
const book=SpreadsheetApp.openById(p.getProperty('SPREADSHEET_ID'));book.setSpreadsheetTimeZone('Asia/Taipei');
const lock=LockService.getScriptLock();lock.waitLock(10000);
try{for(const sheet of book.getSheets().filter(s=>/^\d{4}-\d{2}$/.test(s.getName()))){
checkHeader_(sheet,HEADER);
if(sheet.getLastRow()<2)continue;
const rows=sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues();
const entries=rows.map((row,i)=>({row,index:i+2})).sort((a,b)=>new Date(a.row[7])-new Date(b.row[7]));
for(const entry of entries){if(entry.row[1]){const day=Utilities.formatDate(new Date(entry.row[7]),'Asia/Taipei','yyyyMMdd');const key='DAILY_SEQ_'+day;const n=Number(String(entry.row[1]).split('-').pop());if(n>Number(p.getProperty(key)||0))p.setProperty(key,String(n));}}
for(const entry of entries){if(!entry.row[1]){const value=nextNumber_(p,entry.row[7]);sheet.getRange(entry.index,2,1,1).setValues([[value]]);}}
}SpreadsheetApp.flush();}finally{lock.releaseLock();}
}
function nextNumber_(props,date){const day=Utilities.formatDate(new Date(date),'Asia/Taipei','yyyyMMdd');const key='DAILY_SEQ_'+day;const n=Number(props.getProperty(key)||0)+1;props.setProperty(key,String(n));return day+'-'+String(n).padStart(3,'0');}
function doGet(){return json_({ok:true,service:'mu-pos',version:10});}
function json_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function month_(date){return Utilities.formatDate(new Date(date),'Asia/Taipei','yyyy-MM');}
function decode_(r){return {id:r[0],orderNo:String(r[1]||''),kind:r[2],table:r[3],total:Number(r[4]),items:JSON.parse(r[5]),note:r[6],date:r[7],updatedAt:r[8],month:month_(r[7])};}
function validate_(o){
if(!['內用','外帶'].includes(o.kind))throw Error('INVALID_DATA');
if(o.kind==='內用'&&!['A1','A2','B1','B2','B3','B4',...Array.from({length:10},(_,i)=>String(i+1))].includes(o.table))throw Error('INVALID_TABLE_NUMBER');
if(!Array.isArray(o.items)||o.items.length>200)throw Error('INVALID_DATA');
const ids=new Set();o.total=0;
o.items.forEach(i=>{if(typeof i.lineId!=='string'||ids.has(i.lineId)||typeof i.name!=='string'||i.name.length>200||!Number.isSafeInteger(i.qty)||i.qty<1||i.qty>999||!Number.isSafeInteger(i.price)||i.price< -10000000||i.price>10000000||(i.price<0&&i.group!=='減項'))throw Error('INVALID_ITEMS');ids.add(i.lineId);i.variant=i.variant||'';if(!['','冰杯','熱杯','熱壺'].includes(i.variant))throw Error('INVALID_ITEMS');const levels=['正常','半','少','微','無'];i.sweetness=i.sweetness||'正常';if(!levels.includes(i.sweetness))throw Error('INVALID_ITEMS');i.ice=i.variant.startsWith('冰')?(i.ice||'正常'):'';i.heat=i.variant.startsWith('熱')?(i.heat||'熱'):'';if(i.ice&&!levels.includes(i.ice)||i.heat&&!['熱','溫'].includes(i.heat))throw Error('INVALID_ITEMS');o.total+=i.qty*i.price;});
if(!Number.isSafeInteger(o.total)||o.total<0||JSON.stringify(o.items).length>40000)throw Error('INVALID_ITEMS');
o.note=String(o.note||'').slice(0,2000);if(o.kind==='外帶')o.table='';
}
function doPost(e){
let lock;
try{
if(!e.postData||e.postData.contents.length>110000)throw Error('INVALID_REQUEST');
const req=JSON.parse(e.postData.contents),p=PropertiesService.getScriptProperties(),key=p.getProperty('POS_ACCESS_KEY');
if(!key||key.length<32||req.key!==key)throw Error('UNAUTHORIZED');
if(typeof CacheService!=='undefined'){const cache=CacheService.getScriptCache(),slot='requests_'+Math.floor(Date.now()/60000),n=Number(cache.get(slot)||0);if(n>=120)throw Error('RATE_LIMITED');cache.put(slot,String(n+1),60);}
if(req.action==='menuGet'||req.action==='menuSave')return json_(menu_(req,p));
if(req.action==='sync')return json_(sync_(req,p));
if(!['list','changes','get'].includes(req.action))throw Error('INVALID_ACTION');
const book=SpreadsheetApp.openById(p.getProperty('SPREADSHEET_ID'));
lock=LockService.getScriptLock();if(!lock.tryLock(10000))throw Error('BUSY_RETRY');
const sheets=book.getSheets().filter(s=>/^\d{4}-(0[1-9]|1[0-2])$/.test(s.getName()));
if(req.action==='list'||req.action==='changes'){
if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.month))throw Error('INVALID_MONTH');
const sheet=sheets.find(s=>s.getName()===req.month),log=book.getSheetByName('_SyncLog');
if(sheet)checkHeader_(sheet,HEADER);
const syncCursor=log?log.getLastRow():0,revision=String(syncCursor)+'-'+(sheet?sheet.getLastRow():0);
if(req.action==='changes'){
if(!Number.isSafeInteger(req.since)||req.since<0||req.since>syncCursor)throw Error('STALE_CURSOR');
const end=Math.min(syncCursor,Math.max(1,req.since)+200);
const logs=log&&end>Math.max(1,req.since)?log.getRange(Math.max(1,req.since)+1,1,end-Math.max(1,req.since),4).getValues():[];
const ids=[...new Set(logs.filter(r=>r[3]===req.month).map(r=>r[1]))];
const rows=sheet&&sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues():[];
const data=rows.filter(r=>ids.includes(r[0])).map(decode_);
return json_({ok:true,data,deleted:ids.filter(id=>!data.some(o=>o.id===id)),nextCursor:end,syncCursor});
}

if(req.revision&&req.revision!==revision)throw Error('STALE_CURSOR');
const offset=req.offset||0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('INVALID_REQUEST');
const size=sheet?Math.max(0,sheet.getLastRow()-1):0,count=Math.min(200,Math.max(0,size-offset));
const data=count?sheet.getRange(offset+2,1,count,9).getValues().map(decode_):[];
return json_({ok:true,data,nextOffset:offset+count<size?offset+count:null,revision,syncCursor});
}
if(typeof req.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.id))throw Error('INVALID_ID');
let found;
for(const sheet of sheets){checkHeader_(sheet,HEADER);if(sheet.getLastRow()<2)continue;const rows=sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues();const index=rows.findIndex(r=>r[0]===req.id);if(index>=0){found={sheet,row:index+2,order:decode_(rows[index])};break;}}
if(req.action==='get'){if(!found)throw Error('NOT_FOUND');return json_({ok:true,data:found.order});}

}catch(error){return json_({ok:false,error:['UNAUTHORIZED','STALE_CURSOR','INVALID_REQUEST','RATE_LIMITED','INVALID_ACTION','INVALID_MONTH','INVALID_ID','NOT_FOUND','VERSION_CONFLICT','INVALID_ITEMS','INVALID_DATA','INVALID_REFUND','EMPTY_ORDER','ID_ALREADY_EXISTS','INVALID_TABLE_NUMBER','SCHEMA_MISMATCH'].includes(error.message)?error.message:'SERVER_ERROR'});}finally{if(lock&&lock.hasLock())lock.releaseLock();}
}

function menu_(req,props){
const book=SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
const lock=LockService.getScriptLock();lock.waitLock(10000);
try{
let sheet=book.getSheetByName('菜單');
if(!sheet){sheet=book.insertSheet('菜單');sheet.getRange(1,1,1,9).setValues([MENU_HEADER]);sheet.setFrozenRows(1);}
else checkHeader_(sheet,MENU_HEADER);
if(req.action==='menuGet'){
 const count=sheet.getLastRow()-1;
 const data=count?sheet.getRange(2,1,count,9).getValues().map(r=>({type:String(r[0]),key:String(r[1]),group:String(r[2]),name:String(r[3]),price:Number(r[4]),sort:Number(r[5]),updatedAt:String(r[6]),options:r[7]?JSON.parse(r[7]):[],nextItemNo:Number(r[8])||0})):[];
 return {ok:true,data};
}
if(!Array.isArray(req.data)||req.data.length>500)throw Error('INVALID_DATA');
const seen=new Set(),sorts=new Map();
const rows=req.data.map(item=>{
 if(!['分類','品項','設定'].includes(item.type)||typeof item.key!=='string'||!item.key||seen.has(item.key)||typeof item.group!=='string'||!item.group.trim()||item.group.length>100||typeof item.name!=='string'||!item.name.trim()||item.name.length>200||!Number.isSafeInteger(item.price)||item.price<0||item.price>10000000)throw Error('INVALID_DATA');
 if(item.type==='分類'&&(item.key!==item.group||item.name!==item.key||!Number.isSafeInteger(item.nextItemNo)||item.nextItemNo<0))throw Error('INVALID_DATA');
 if(item.type==='設定'&&item.key!=='熟客券優惠')throw Error('INVALID_DATA');
 if(item.type==='品項'&&!item.key.startsWith(item.group+'-'))throw Error('INVALID_DATA');
 if(item.type==='品項'&&!/^\d{3,}$/.test(item.key.slice(item.group.length+1)))throw Error('INVALID_DATA');
 if(item.options!=null&&(!Array.isArray(item.options)||item.options.length>2||item.options.some(option=>!['冰杯','熱杯','熱壺'].includes(option.value)||!Number.isSafeInteger(option.price)||option.price<0||option.price>10000000)))throw Error('INVALID_DATA');
 seen.add(item.key);const bucket=item.type==='分類'?'__categories__':item.type==='設定'?'__settings__':item.group;const sort=(sorts.get(bucket)||0)+1;sorts.set(bucket,sort);
 return [item.type,text_(item.key),text_(item.group),text_(item.name),item.price,sort,new Date().toISOString(),JSON.stringify(item.options||[]),item.type==='分類'?item.nextItemNo:''];
});
const old=sheet.getLastRow()-1;if(old)sheet.getRange(2,1,old,9).clearContent();if(rows.length)sheet.getRange(2,1,rows.length,9).setValues(rows);SpreadsheetApp.flush();return {ok:true,count:rows.length};
}finally{lock.releaseLock();}
}

function text_(v){const s=String(v||'');return /^[=+@\-\t\r\n]/.test(s)?"'"+s:s;}
function sync_(req,props){
if(!Array.isArray(req.operations)||req.operations.length>10)throw Error('INVALID_REQUEST');
const book=SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID')),lock=LockService.getScriptLock();lock.waitLock(10000);
try{
let log=book.getSheetByName('_SyncLog');if(!log){log=book.insertSheet('_SyncLog');log.appendRow(['operationId','orderId','time','month']);log.hideSheet();}
const receipts=log.getLastRow()>1?new Set(log.getRange(2,1,log.getLastRow()-1,1).getValues().flat()):new Set();
const results=[],start=Date.now();
for(const op of req.operations){
if(Date.now()-start>15000)break;
try{
if(typeof op.operationId!=='string'||!/^[0-9a-f-]{36}$/i.test(op.operationId))throw Error('INVALID_ID');
if(receipts.has(op.operationId)){results.push({ok:true,operationId:op.operationId});continue;}
const o=op.order;if(!o||!/^[0-9a-f-]{36}$/i.test(o.id)||!Number.isFinite(Date.parse(o.date)))throw Error('INVALID_DATA');
validate_(o);o.month=month_(o.date);
let sheet=book.getSheetByName(o.month);
if(!sheet){sheet=book.insertSheet(o.month);sheet.getRange(1,1,1,9).setValues([HEADER]);sheet.setFrozenRows(1);}else checkHeader_(sheet,HEADER);
const rows=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,9).getValues():[];
const index=rows.findIndex(r=>r[0]===o.id),old=index>=0?decode_(rows[index]):null;
if(old&&new Date(old.date).getTime()!==new Date(o.date).getTime())throw Error('INVALID_DATA');
if(op.remove){if(index>=0)sheet.deleteRow(index+2);}
else{
if(!/^\d{8}-\d{3,}$/.test(o.orderNo||''))throw Error('INVALID_ORDER_NUMBER');
if(rows.some(r=>r[0]!==o.id&&r[1]===o.orderNo))throw Error('ORDER_NUMBER_CONFLICT');
const row=[o.id,o.orderNo,o.kind,o.table,o.total,JSON.stringify(o.items),text_(o.note),o.date,new Date().toISOString()];
sheet.getRange(index>=0?index+2:sheet.getLastRow()+1,1,1,9).setValues([row]);
}
SpreadsheetApp.flush();log.appendRow([op.operationId,o.id,new Date().toISOString(),o.month]);SpreadsheetApp.flush();receipts.add(op.operationId);results.push({ok:true,operationId:op.operationId});
}catch(e){results.push({ok:false,operationId:op.operationId,error:['ORDER_NUMBER_CONFLICT','INVALID_ORDER_NUMBER','INVALID_DATA','INVALID_ITEMS','INVALID_ID','SCHEMA_MISMATCH'].includes(e.message)?e.message:'SYNC_FAILED'});break;}
}
return {ok:true,data:results};
}finally{lock.releaseLock();}
}
