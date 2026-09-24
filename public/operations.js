const suspensionMarkers=Object.freeze({fakeSlip:'[ยืนยันสลิปปลอม]',merchantNotRefunded:'[ยืนยันไม่คืนเงิน]',merchantRefunded:'[ยืนยันคืนเงินแล้ว]'});
const completedReportStatuses=new Set(['ดำเนินการแล้ว','ปิดเรื่อง']);
const externalUserId=userId=>{const value=String(userId??'').trim();const separator=value.indexOf(':');return separator>=0?value.slice(separator+1):value};
const reportEvidence=r=>Number(r?.evidenceCount||0)>0||(Array.isArray(r?.evidenceUrls)&&r.evidenceUrls.length>0);
const reportHasOnlyMarker=(note,marker)=>{const markers=Object.values(suspensionMarkers).filter(value=>String(note??'').includes(value));return markers.length===1&&markers[0]===marker};
function findSuspensionEvidence(input,user){
 const isShop=user.role==='Shop';const marker=isShop?suspensionMarkers.merchantNotRefunded:suspensionMarkers.fakeSlip;const targetId=externalUserId(user.id);
 const reports=(input.reports||[]).filter(r=>completedReportStatuses.has(r.status)&&r.orderId&&reportEvidence(r)&&reportHasOnlyMarker(r.note,marker));
 const evidence=reports.find(r=>{
  const linkedIds=[r.targetUserId,r.targetId,isShop?r.merchantId:r.customerId,r.orderCustomerId,r.orderMerchantId].filter(value=>value!=null).map(externalUserId);
  return r.reporterType===(isShop?'Customer':'Shop')&&linkedIds.includes(targetId);
 });
 if(evidence)return evidence;
 throw Error(isShop?'ยังระงับร้านค้าไม่ได้ ต้องมีรายงานลูกค้าที่ตรวจสอบแล้ว ระบุ [ยืนยันไม่คืนเงิน] พร้อมเลขออเดอร์และหลักฐาน':'ยังระงับลูกค้าไม่ได้ ต้องมีรายงานจากร้านค้าที่ตรวจสอบแล้ว ระบุ [ยืนยันสลิปปลอม] พร้อมเลขออเดอร์และหลักฐาน');
}
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
  if(action.status==='ระงับบัญชี')findSuspensionEvidence(next,u);
  u.status=action.status;u.reason=action.reason.trim();u.suspensionHistory??=[];u.suspensionHistory.unshift({status:action.status,reason:u.reason,admin:action.admin||'Admin',at:now});audit=action.status+': '+u.reason;target=u.id;
 // Payment / refund operations are intentionally disabled until a separate scope is approved.
 }else if(action.type==='refund.note'||String(action.type||'').startsWith('payment')){
  throw Error('ฟังก์ชันการชำระเงินและคืนเงินถูกปิดไว้ชั่วคราว');
 }else if(action.type==='notification.read'){if(action.id){next.notifications.forEach(n=>{if(String(n.id)===String(action.id))n.read=true})}else next.notifications.forEach(n=>{n.read=true});return next;
 }else throw Error('ไม่รองรับการดำเนินการนี้');
 next.history.unshift({id:crypto.randomUUID(),action:audit,target,time:now});return next;
}
