import test from 'node:test'
import assert from 'node:assert/strict'
import {requestAppsScript,listAppsScript,APPS_SCRIPT_URL} from '../app/utils/apps-script.mjs'
const reply=value=>({ok:true,json:async()=>value})
test('POST uses simple request without leaking key in URL; unwraps success',async()=>{
 const result=await requestAppsScript('test-key',{action:'create',table:'Orders',id:'fixed-id',data:{total:100}},async(url,options)=>{
 assert.equal(url,APPS_SCRIPT_URL);assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'text/plain;charset=UTF-8');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'follow');assert.equal(JSON.parse(options.body).key,'test-key');return reply({ok:true,data:{id:'fixed-id'}})
 });assert.equal(result.data.id,'fixed-id')
})
test('does not report successful HTTP with application error as successful write',async()=>{
 await assert.rejects(requestAppsScript('bad',{action:'list'},async()=>reply({ok:false,error:'UNAUTHORIZED'})),/密碼不正確/)
})
test('missing key makes no network call',async()=>{await assert.rejects(requestAppsScript('',{},()=>{throw Error('must not fetch')}),/先連線/)})
test('list reads every page',async()=>{
 const offsets=[];const records=await listAppsScript('key','Orders',async(_,opts)=>{const {offset}=JSON.parse(opts.body);offsets.push(offset);return reply({ok:true,data:[{id:String(offset)}],nextOffset:offset===0?500:null})});assert.deepEqual(offsets,[0,500]);assert.equal(records.length,2)
})
test('invalid pagination stops instead of repeating requests',async()=>{await assert.rejects(listAppsScript('key','Orders',async()=>reply({ok:true,data:[],nextOffset:0})),/分頁/)})
test('HTML login page cannot be interpreted as successful write',async()=>{await assert.rejects(requestAppsScript('key',{},async()=>({ok:true,json:async()=>{throw Error('html')}})),/部署權限/)})
