export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbybzXHv5k-zYbTVjJtSlE4JZll9GQ6PK6kXUfkTeWDhR0u2Xo6AozEOexfXEgjs2OI3wQ/exec'
const messages = {UNAUTHORIZED:'存取密碼不正確，請重新連線',VERSION_CONFLICT:'資料已變更，請重新整理後再操作',NOT_FOUND:'找不到資料，請重新整理',RUN_SETUP_FIRST:'請先在 Apps Script 執行 setup',BUSY_RETRY:'服務忙碌，請稍後重試',ID_ALREADY_EXISTS:'此筆資料已存在，請回查確認'}
export async function requestAppsScript(key, request, fetcher = fetch) {
  if (!key) throw new Error('請先連線並輸入存取密碼')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetcher(APPS_SCRIPT_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},credentials:'omit',redirect:'follow',signal:controller.signal,body:JSON.stringify({...request,key})})
    if (!response.ok) throw new Error('服務連線失敗，請稍後重試')
    let result
    try { result = await response.json() } catch { throw new Error('服務未回傳 JSON，請檢查部署權限與 /exec 網址') }
    if (!result.ok) {const error=new Error(messages[result.error] || '資料操作失敗：'+result.error);error.code=result.error;throw error}
    return result
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('連線逾時；結單資料會保留，請使用原單重試')
    throw error
  } finally { clearTimeout(timer) }
}
export async function listAppsScript(key, table, fetcher = fetch) {
  const records=[]
  let offset=0
  do {
    const result=await requestAppsScript(key,{table,action:'list',offset},fetcher)
    if (!Array.isArray(result.data)) throw new Error('資料格式不符')
    records.push(...result.data)
    const next=result.nextOffset
    if (next==null) break
    if (!Number.isSafeInteger(next)||next<=offset) throw new Error('分頁資料格式不符')
    offset=next
  } while (true)
  return records
}
