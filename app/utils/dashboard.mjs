export function dayKey(value){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}
export function dailyRevenue(orders,month){
 const count=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()
 return Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0');const rows=orders.filter(o=>dayKey(o.date)===date);return {date,total:rows.reduce((n,o)=>n+o.total,0),count:rows.length}})
}
export function itemCount(order){return order.items.reduce((n,i)=>n+i.qty,0)}
