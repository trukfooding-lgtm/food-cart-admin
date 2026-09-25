const suspensionMarkers=Object.freeze({fakeSlip:'[ยืนยันสลิปปลอม]',merchantNotRefunded:'[ยืนยันไม่คืนเงิน]',merchantRefunded:'[ยืนยันคืนเงินแล้ว]'});
const suspensionPolicies=Object.freeze({
 fake_slip:{roles:['Customer'],permanent:true},
 merchant_no_refund:{roles:['Shop'],permanent:true},
 inappropriate_behavior:{roles:['Customer','Shop'],temporary:true}
});
const completedReportStatuses=new Set(['ดำเนินการแล้ว','ปิดเรื่อง']);
const externalUserId=userId=>{const value=String(userId??'').trim();const separator=value.indexOf(':');return separator>=0?value.slice(separator+1):value};
const reportEvidence=r=>Number(r?.evidenceCount||0)>0||(Array.isArray(r?.evidenceUrls)&&r.evidenceUrls.length>0);
const reportHasOnlyMarker=(note,marker)=>{const markers=Object.values(suspensionMarkers).filter(value=>String(note??'').includes(value));return markers.length===1&&markers[0]===marker};
function findSuspensionEvidence(input,user,reasonType){
 const isShop=user.role==='Shop';const marker=isShop?suspensionMarkers.merchantNotRefunded:suspensionMarkers.fakeSlip;const targetId=externalUserId(user.id);
 const reports=(input.reports||[]).filter(r=>completedReportStatuses.has(r.status)&&r.orderId&&reportEvidence(r)&&reportHasOnlyMarker(r.note,marker));
 if(reasonType==='inappropriate_behavior'){
  const behaviorReports=(input.reports||[]).filter(r=>completedReportStatuses.has(r.status)&&r.orderId);
  const evidence=behaviorReports.find(r=>{
   const linkedIds=[r.targetUserId,r.targetId,isShop?r.merchantId:r.customerId,r.orderCustomerId,r.orderMerchantId].filter(value=>value!=null).map(externalUserId);
   return r.reporterType===(isShop?'Customer':'Shop')&&linkedIds.includes(targetId);
  });
  if(evidence)return evidence;
  throw Error('ยังระงับบัญชีไม่ได้ ต้องมีรายงานพฤติกรรมที่ตรวจสอบแล้วและเชื่อมโยงกับคำสั่งซื้อ');
 }
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
  if(action.status==='ระงับบัญชี'){
   const policy=suspensionPolicies[action.reasonType];
   if(!policy||!policy.roles.includes(u.role))throw Error('ประเภทเหตุผลไม่ตรงกับประเภทบัญชี');
   if(policy.temporary&&! [7,30].includes(Number(action.durationDays)))throw Error('การระงับพฤติกรรมต้องเลือก 7 วันหรือ 30 วัน');
   if(policy.permanent&&action.durationDays!=null)throw Error('กรณีนี้ต้องเป็นการระงับโดยไม่มีกำหนด');
   findSuspensionEvidence(next,u,action.reasonType);
   const suspensionUntil=policy.temporary?new Date(Date.now()+Number(action.durationDays)*86400000).toISOString():null;
   u.suspensionUntil=suspensionUntil;
   u.suspensionReasonType=action.reasonType;
   u.reason=(action.reason.trim()+(suspensionUntil?`\nระงับชั่วคราวถึง: ${new Date(suspensionUntil).toLocaleString('th-TH')}`:'')).trim();
  }else{
   u.suspensionUntil=null;u.suspensionReasonType='';u.reason=action.reason.trim();
  }
  u.status=action.status;u.suspensionHistory??=[];u.suspensionHistory.unshift({status:action.status,reason:u.reason,admin:action.admin||'Admin',at:now,until:u.suspensionUntil});audit=action.status+': '+u.reason;target=u.id;
 }else if(action.type==='refund.track'){
  const r=next.reports.find(item=>item.id===action.id);if(!r)throw Error('ไม่พบรายงานลูกค้า');
  if(r.reporterType!=='Customer'||!r.orderId)throw Error('ติดตามคืนเงินได้เฉพาะรายงานจากลูกค้าที่มีเลขออเดอร์');
  const statuses=['รอติดต่อร้านค้า','แจ้งร้านค้าแล้ว','รอหลักฐานการคืนเงิน','ส่งหลักฐานแล้ว','ยืนยันคืนเงินแล้ว','เกินกำหนด'];if(!statuses.includes(action.status))throw Error('สถานะการติดตามคืนเงินไม่ถูกต้อง');
  const previous=r.refundTracking||{};const contactedAt=action.contactedAt||previous.contacted_at||'';const contactNote=(action.contactNote??previous.contact_note??'').trim();const proofReportId=action.proofReportId||previous.proof_report_id||'';const verificationNote=(action.verificationNote??previous.verification_note??'').trim();const deadlineAt=contactedAt?new Date(new Date(contactedAt).getTime()+2*86400000).toISOString():(previous.deadline_at||'');
  if(action.status==='แจ้งร้านค้าแล้ว'&&(!contactedAt||contactNote.length<5))throw Error('กรุณาบันทึกวันเวลาและรายละเอียดการโทรเตือนร้านค้า');
  if(['รอหลักฐานการคืนเงิน','ส่งหลักฐานแล้ว','ยืนยันคืนเงินแล้ว'].includes(action.status)&&!deadlineAt)throw Error('ยังไม่มีวันครบกำหนดจากการโทรเตือนร้านค้า');
  if(['ส่งหลักฐานแล้ว','ยืนยันคืนเงินแล้ว'].includes(action.status)){const proof=next.reports.find(item=>String(item.id)===String(proofReportId));if(!proof||proof.reporterType!=='Shop'||String(proof.orderId)!==String(r.orderId)||!((proof.evidenceCount||0)>0||(proof.evidenceUrls||[]).length))throw Error('กรุณาเลือกรายงานหลักฐานการคืนเงินจากร้านค้าที่มีรูปหลักฐาน')}
  if(action.status==='ยืนยันคืนเงินแล้ว'&&verificationNote.length<5)throw Error('กรุณาบันทึกผลตรวจสอบหลักฐานจากร้านค้า');
  if(action.status==='เกินกำหนด'&&(!deadlineAt||new Date(deadlineAt)>new Date()))throw Error('ยังไม่ถึงกำหนด 2 วันสำหรับการคืนเงิน');
  r.refundTracking={status:action.status,contacted_at:contactedAt,deadline_at:deadlineAt,contact_note:contactNote,proof_report_id:proofReportId,verification_note:verificationNote,verified_at:action.status==='ยืนยันคืนเงินแล้ว'?now:(previous.verified_at||''),deadline_days:2,updatedAt:now};audit='ติดตามการคืนเงิน: '+action.status;target=r.id;
 }else if(action.type==='refund.note'||String(action.type||'').startsWith('payment')){
  throw Error('ฟังก์ชันการชำระเงินและคืนเงินถูกปิดไว้ชั่วคราว');
 }else if(action.type==='notification.read'){if(action.id){next.notifications.forEach(n=>{if(String(n.id)===String(action.id))n.read=true})}else next.notifications.forEach(n=>{n.read=true});return next;
 }else throw Error('ไม่รองรับการดำเนินการนี้');
 next.history.unshift({id:crypto.randomUUID(),action:audit,target,time:now});return next;
}
