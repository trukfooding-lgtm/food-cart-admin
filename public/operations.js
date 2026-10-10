const suspensionPolicies=Object.freeze({
 inappropriate_behavior:{roles:['Customer','Shop'],temporary:true}
});
const completedReportStatuses=new Set(['ดำเนินการแล้ว','ปิดเรื่อง']);
const externalUserId=userId=>{const value=String(userId??'').trim();const separator=value.indexOf(':');return separator>=0?value.slice(separator+1):value};
function findSuspensionEvidence(input,user){
 const isShop=user.role==='Shop';const targetId=externalUserId(user.id);
 const behaviorReports=(input.reports||[]).filter(r=>completedReportStatuses.has(r.status)&&r.orderId);
 const evidence=behaviorReports.find(r=>{
  const linkedIds=[r.targetUserId,r.targetId,isShop?r.merchantId:r.customerId,r.orderCustomerId,r.orderMerchantId].filter(value=>value!=null).map(externalUserId);
  return r.reporterType===(isShop?'Customer':'Shop')&&linkedIds.includes(targetId);
 });
 if(evidence)return evidence;
 throw Error('ยังระงับบัญชีไม่ได้ ต้องมีรายงานพฤติกรรมที่ตรวจสอบแล้วและเชื่อมโยงกับคำสั่งซื้อ');
}
export function applyAction(input,action){
 const next=structuredClone(input);const validText=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;const now=new Date().toISOString();let audit='',target='';
 if(!action||typeof action!=='object')throw Error('ข้อมูลการดำเนินการไม่ถูกต้อง');
 if(action.type==='report.update'){
  const r=next.reports.find(r=>r.id===action.id);if(!r)throw Error('ไม่พบรายงาน');
  if(!['รอตรวจสอบ','กำลังตรวจสอบ','ดำเนินการแล้ว','ปิดเรื่อง'].includes(action.status))throw Error('สถานะ Report ไม่ถูกต้อง');
  const reportRanks={'รอตรวจสอบ':0,'กำลังตรวจสอบ':1,'ดำเนินการแล้ว':2,'ปิดเรื่อง':3};
  if((reportRanks[action.status]??0)<(reportRanks[r.status]??0))throw Error('ไม่สามารถย้อนกลับไปสถานะก่อนหน้าได้');
  if(r.status==='ปิดเรื่อง')throw Error('รายงานปิดเรื่องเรียบร้อยแล้ว ไม่สามารถแก้ไขได้');
  if(r.status==='ดำเนินการแล้ว'&&action.status==='ดำเนินการแล้ว')throw Error('รายงานดำเนินการแล้ว กรุณาปรับเป็นสถานะปิดเรื่องเพื่อบันทึก');
  if(!validText(action.note,5,2000))throw Error('กรุณาระบุผลการตรวจสอบอย่างน้อย 5 ตัวอักษร');
  if(!r.user_details&&r.note&&!r.admin_note)r.user_details=r.note;
  if(!r.originalDetails&&r.user_details)r.originalDetails=r.user_details;
  r.status=action.status;r.admin_note=action.note.trim();r.reviewNote=action.note.trim();r.note=action.note.trim();r.updatedAt=now;
  if(action.notify===true)next.notifications.unshift({id:crypto.randomUUID(),title:'เตรียมแจ้งผล Report #'+r.id,body:r.note,time:now,priority:r.priority||'ปกติ',read:false,recipient:r.person,delivery:'รอเชื่อมต่อ Mobile App'});
  audit='อัปเดต Report เป็น '+r.status;target=r.id;
 }else if(action.type==='user.status'){
  const u=next.users.find(u=>u.id===action.id);if(!u)throw Error('ไม่พบบัญชี');
  if(!['ระงับบัญชี','ใช้งานปกติ'].includes(action.status)||!validText(action.reason,5,1000))throw Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
  if(action.status==='ระงับบัญชี'){
   const policy=suspensionPolicies[action.reasonType];
   if(!policy||!policy.roles.includes(u.role))throw Error('ประเภทเหตุผลไม่ตรงกับประเภทบัญชี');
   if(policy.temporary&&! [7,14,21,30].includes(Number(action.durationDays)))throw Error('การระงับพฤติกรรมต้องเลือก 7, 14, 21 หรือ 30 วัน');
   if(policy.permanent&&action.durationDays!=null)throw Error('กรณีนี้ต้องเป็นการระงับโดยไม่มีกำหนด');
   findSuspensionEvidence(next,u);
   const suspensionUntil=policy.temporary?new Date(Date.now()+Number(action.durationDays)*86400000).toISOString():null;
   u.suspensionUntil=suspensionUntil;
   u.suspensionReasonType=action.reasonType;
   u.reason=(action.reason.trim()+(suspensionUntil?`\nระงับชั่วคราวถึง: ${new Date(suspensionUntil).toLocaleString('th-TH')}`:'')).trim();
  }else{
   u.suspensionUntil=null;u.suspensionReasonType='';u.reason=action.reason.trim();
  }
  u.status=action.status;u.suspensionHistory??=[];u.suspensionHistory.unshift({status:action.status,reason:u.reason,admin:action.admin||'Admin',at:now,until:u.suspensionUntil});audit=action.status+': '+u.reason;target=u.id;
 }else if(action.type==='notification.read'){if(action.id){next.notifications.forEach(n=>{if(String(n.id)===String(action.id))n.read=true})}else next.notifications.forEach(n=>{n.read=true});return next;
 }else throw Error('ไม่รองรับการดำเนินการนี้');
 next.history.unshift({id:crypto.randomUUID(),action:audit,target,time:now});return next;
}
