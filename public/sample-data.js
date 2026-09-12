export function createInitialState(){
 const people=['กมลชนก ใจดี','ณัฐวุฒิ ศรีสุข','พิมพ์ชนก วงศ์ดี','ธนกร มีทรัพย์','วราภรณ์ แสงทอง','สุรชัย พูนสุข','นภัสสร จันทรา','ศุภชัย อินทร์แก้ว'];
 const shops=['ครัวป้าสุ รถกับข้าว','Coffee on Wheels','ผลไม้สด ลุงชัย','ขนมหวานบ้านอิ่ม','ผักสดจากสวน','ปังปิ้ง พี่หมี'];
 const names=['แอปพลิเคชันทำงานผิดปกติ','คำสั่งซื้อมีปัญหา','รายละเอียดเพิ่มเติมเกี่ยวกับการใช้งาน','ชำระเงินแล้วแต่คำสั่งซื้อไม่สมบูรณ์','แอปพลิเคชันแสดงข้อมูลไม่ถูกต้อง','ไม่สามารถเปิดดูร้านค้าได้','ขอความช่วยเหลือจากทีมงาน','ข้อมูลคำสั่งซื้อไม่ตรงกับที่ได้รับ','พบข้อผิดพลาดระหว่างใช้งาน','ต้องการรายงานปัญหาอื่น','การแจ้งเตือนไม่แสดงผล','ไม่สามารถส่งรายงานจากแอปได้'];
 const reports=names.map((name,i)=>({id:'RPT-'+String(248-i).padStart(5,'0'),name,person:people[i%8],shop:shops[i%6],reporterType:i%2?'Shop':'Customer',type:['Problem with application','Problem with order','Other'][i%3],orderId:i%3===1?'ORD-'+String(88428-i):'',status:['รอตรวจสอบ','กำลังตรวจสอบ','ดำเนินการแล้ว','ปิดเรื่อง'][i%4],priority:i<2||i===7||i===9?'สูง':'ปกติ',time:['10:42','10:15','09:58','09:30','09:15','09:02','08:50','08:34','08:20','08:12','08:04','07:53'][i],userId:'USR-'+String(i%6+9).padStart(3,'0'),note:'',evidenceCount:i%3+1}));
 const shopProfiles=[
  {phone:'081-234-5678',category:'อาหารปรุงสุก',lineId:'@ครัวป้าสุ',facebook:'facebook.com/kruapasuu',lat:'13.7563',lng:'100.5018'},
  {phone:'082-345-6789',category:'เครื่องดื่ม',lineId:'@coffeeonwheels',facebook:'facebook.com/coffeeonwheels',lat:'13.7463',lng:'100.5118'},
  {phone:'083-456-7890',category:'ผลไม้',lineId:'@lungchai.fruit',facebook:'facebook.com/lungchaifruit',lat:'13.7363',lng:'100.5218'},
  {phone:'084-567-8901',category:'ขนมหวาน',lineId:'@baanim-dessert',facebook:'facebook.com/baanimdessert',lat:'13.7263',lng:'100.5318'},
  {phone:'085-678-9012',category:'ผักสด',lineId:'@freshgarden',facebook:'facebook.com/freshgarden',lat:'13.7163',lng:'100.5418'},
  {phone:'086-789-0123',category:'เบเกอรี',lineId:'@pangpingbear',facebook:'facebook.com/pangpingbear',lat:'13.7063',lng:'100.5518'}
 ];
 const users=[...people,...['สุภาวดี คงดี','กิตติพงษ์ วัฒนา','สมชาย ใจเย็น','อรทัย บุญมา','ลลิตา สดใส','สมพร รุ่งเรือง']].map((name,i)=>({id:'USR-'+String(i+1).padStart(3,'0'),name:i>=8?shops[i-8]:name,email:'member'+(i+1)+'@example.com',role:i<8?'Customer':'Shop',status:i===13?'ระงับบัญชี':'ใช้งานปกติ',joined:'1 ก.ย. 2569',shop:i<8?'—':shops[i-8],...(i>=8?shopProfiles[i-8]:{phone:'',category:'',lineId:'',facebook:'',lat:'',lng:''})}));
 const amounts=[185,120,240,85,350,95,160,210,145,70,290,135,250,175,480,60,310,220];
 const transactions=Array.from({length:18},(_,i)=>({id:'TXN-'+String(10428-i),orderId:'ORD-'+String(88428-i),person:people[i%8],shop:shops[i%6],amount:amounts[i],paymentStatus:i===9?'pending':i===11?'failed':'succeeded',refundStatus:i<5?'pending':i===6?'failed':i<8?'succeeded':'none',transactionTime:'5 ก.ย. 2569, '+(10-Math.floor(i/6))+':'+String(45-i%6*7).padStart(2,'0'),providerTransactionId:'PG-TXN-20260905-'+String(128-i),refundId:i<8?'PG-REF-'+String(202+i):'',refundDateTime:i<8?'5 ก.ย. 2569, 09:12':'',reference:''}));
 const notifications=[{id:'N-1',title:'มี Report ใหม่ 4 รายการ',body:'ตรวจสอบรายการที่มีความสำคัญสูงใน Notification Center',time:'วันนี้ 10:42',priority:'สูง',read:false},{id:'N-2',title:'Refund ผิดปกติจาก Payment Gateway',body:'เปิด Transaction Detail เพื่อตรวจสอบข้อมูล Provider',time:'วันนี้ 10:15',priority:'สูงสุด',read:false}];
 return {reports,users,transactions,notifications,history:[]};
}
