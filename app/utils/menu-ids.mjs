export function reconcileMenuIds(items, categories, counters = {}) {
  const next = {...counters};
  const used = new Set();
  const categoryNames = new Set(categories.map(group => group[0]));
  for (const item of items) {
    if (!categoryNames.has(item.group)) continue;
    const prefix = item.group + '-';
    const number = item.id?.startsWith(prefix) ? Number(item.id.slice(prefix.length)) : 0;
    if (Number.isSafeInteger(number) && number > 0 && !used.has(item.id)) {
      used.add(item.id);
      next[item.group] = Math.max(next[item.group] || 0, number);
    }
  }
  let changed = false;
  for (const item of items) {
    const prefix = item.group + '-';
    const number = item.id?.startsWith(prefix) ? Number(item.id.slice(prefix.length)) : 0;
    if (Number.isSafeInteger(number) && number > 0 && used.has(item.id)) {
      used.delete(item.id);
      continue;
    }
    next[item.group] = (next[item.group] || 0) + 1;
    item.id = prefix + String(next[item.group]).padStart(3, '0');
    changed = true;
  }
  return {counters:next, changed};
}
