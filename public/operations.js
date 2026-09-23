export function applyAction(input,action){
 const next=structuredClone(input);const validText=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;const now=new Date().toISOString();let audit='',target='';
 if(!action||typeof action!=='object')throw Error('ข้อมูลการดำเนินการไม่ถูกต้อง');
 if(action.type==='report.update'){
  const r=next.reports.find(r=>r.id===action.id);if(!r)throw Error('ไม่พบรายงาน');
  if(!['รอตรวจสอบ','กำลังตรวจสอบ','ดำเนินการแล้ว','ปิดเรื่อง'].includes(action.status))throw Error('สถานะ Report ไม่ถูกต้อง');
  if(!validText(action.note,5,2000))throw Error('กรุณาระบุผลการตรวจสอบอย่างน้อย 5 ตัวอักษร');
  r.status=action.status;r.note=action.note.trim();r.updatedAt=now;
  if(action.notify===true)next.notifications.unshift({id:crypto.randomUUID(),title:'เตรียมแจ้งผล Report #'+r.id,body:r.note,time:now,priority:r.priority||'ปกติ',read:false,recipient:r.person,delivery:'รอเชื่อมต่อ Mobile App'});
  audit='อัปเดต Report เป็น '+r.status;target=r.id;
 }else if(action.type==='user.status'){
  const u=next.users.find(u=>u.id===action.id);if(!u)throw Error('ไม่พบบัญชี');
  if(!['ระงับบัญชี','ใช้งานปกติ'].includes(action.status)||!validText(action.reason,5,1000))throw Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
  u.status=action.status;u.reason=action.reason.trim();u.suspensionHistory??=[];u.suspensionHistory.unshift({status:action.status,reason:u.reason,admin:action.admin||'Admin',at:now});audit=action.status+': '+u.reason;target=u.id;
 // Payment / refund operations are intentionally disabled until a separate scope is approved.
 }else if(action.type==='refund.note'||String(action.type||'').startsWith('payment')){
  throw Error('ฟังก์ชันการชำระเงินและคืนเงินถูกปิดไว้ชั่วคราว');
 }else if(action.type==='notification.read'){if(action.id){next.notifications.forEach(n=>{if(String(n.id)===String(action.id))n.read=true})}else next.notifications.forEach(n=>{n.read=true});return next;
 }else throw Error('ไม่รองรับการดำเนินการนี้');
 next.history.unshift({id:crypto.randomUUID(),action:audit,target,time:now});return next;
}
