const MAX_INCREMENTAL_LOG_GAP = 1000

export async function fetchCloudMonth(key, month, local, request) {
  if (local.cachedMonth === month && Number.isInteger(local.syncCursor)) {
    let cursor = local.syncCursor
    const map = new Map(local.orders.filter(order => order.month === month).map(order => [order.id, order]))
    while (true) {
      let result
      try {
        result = await request(key, {action:'changes', month, since:cursor})
      } catch (error) {
        if (error.code === 'STALE_CURSOR') break
        throw error
      }
      if (!Number.isInteger(result.syncCursor) || !Number.isInteger(result.nextCursor) ||
          !Array.isArray(result.data) || !Array.isArray(result.deleted))
        throw Error('雲端增量資料格式不符')
      if (result.syncCursor - cursor > MAX_INCREMENTAL_LOG_GAP) break
      if (result.nextCursor < cursor || (result.nextCursor === cursor && cursor < result.syncCursor))
        throw Error('雲端同步游標沒有前進')
      result.deleted.forEach(id => map.delete(id))
      result.data.forEach(order => map.set(order.id, order))
      cursor = result.nextCursor
      if (cursor >= result.syncCursor) return {orders:[...map.values()], cursor, month}
    }
  }
  const orders = []
  let offset = 0
  let revision
  let cursor
  while (true) {
    const result = await request(key, {action:'list', month, offset, revision})
    if (!Array.isArray(result.data) || !Number.isInteger(result.syncCursor))
      throw Error('雲端月份資料格式不符')
    orders.push(...result.data)
    revision = result.revision
    cursor = result.syncCursor
    if (result.nextOffset == null) return {orders, cursor, month}
    if (!Number.isInteger(result.nextOffset) || result.nextOffset <= offset)
      throw Error('雲端月份分頁沒有前進')
    offset = result.nextOffset
  }
}
