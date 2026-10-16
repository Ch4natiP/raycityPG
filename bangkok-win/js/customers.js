// Named customers you can collect. Serve them well and they become regulars who phone you for rides.
// rarity: common / rare (from Lv.3) / legend (from Lv.8). type: the passenger kind they ride as.
export const CUSTOMERS = [
  { id: 'somsri', name: 'ป้าสมศรี', emoji: '👵', job: 'แม่ค้าข้าวแกงเยาวราช', home: 'เยาวราช', type: 'auntie', rarity: 'common', likes: 'ขับนิ่มๆ ไม่ต้องรีบ', call: 'ลูกจ๋า มารับป้าหน่อย ของเยอะเลย' },
  { id: 'may', name: 'น้องเมย์', emoji: '👩‍🎓', job: 'นักศึกษาปี 2', home: 'สยาม', type: 'rush', rarity: 'common', likes: 'ไปให้ทันเข้าเรียน', call: 'พี่ๆ หนูตื่นสายอีกแล้ว ช่วยด้วย!' },
  { id: 'ton', name: 'พี่ต้น', emoji: '👨‍💼', job: 'พนักงานออฟฟิศสีลม', home: 'สีลม', type: 'rush', rarity: 'common', likes: 'ตรงเวลา', call: 'พี่วิน ประชุม 9 โมง มารับด่วน' },
  { id: 'chai', name: 'ลุงชัย', emoji: '👴', job: 'วินเกษียณ', home: 'จตุจักร', type: 'normal', rarity: 'common', likes: 'คุยเก่ง ชอบเล่าเรื่องสมัยก่อน', call: 'ไอ้หนู ว่างไหม ลุงจะไปตลาด' },
  { id: 'fah', name: 'น้องฟ้า', emoji: '💁‍♀️', job: 'พนักงานร้านกาแฟ', home: 'สุขุมวิท', type: 'normal', rarity: 'common', likes: 'ไม่ชอบขึ้นฟุตบาท', call: 'พี่คะ เข้ากะเช้า มารับหน่อยค่ะ' },
  { id: 'muay', name: 'เจ๊หมวย', emoji: '👩‍🍳', job: 'เจ้าของร้านหมูกระทะ', home: 'รัชดา', type: 'auntie', rarity: 'common', likes: 'ทิปหนักถ้าไม่ชน', call: 'มาหน่อยลูก เจ๊จะไปซื้อของเข้าร้าน' },
  { id: 'boss', name: 'น้องบอส', emoji: '🧑‍💻', job: 'โปรแกรมเมอร์', home: 'สุขุมวิท', type: 'normal', rarity: 'common', likes: 'เงียบๆ ไม่คุย', call: 'พี่ครับ รับที่คอนโดหน่อยครับ' },
  { id: 'bunmee', name: 'ยายบุญมี', emoji: '🧓', job: 'ไปวัดทุกเช้า', home: 'ข้าวสาร', type: 'auntie', rarity: 'common', likes: 'ขับช้าๆ ยายกลัว', call: 'หลานเอ๊ย พายายไปวัดที' },
  { id: 'jane', name: 'น้องเจน', emoji: '👩‍⚕️', job: 'พยาบาลจุฬาฯ', home: 'สีลม', type: 'rush', rarity: 'common', likes: 'เข้าเวรให้ทัน', call: 'พี่คะ เข้าเวรดึก มารับด่วนค่ะ' },
  { id: 'kong', name: 'พี่ก้อง', emoji: '🧔', job: 'ช่างภาพฟรีแลนซ์', home: 'คลองเตย', type: 'normal', rarity: 'common', likes: 'ชอบถนนสวยๆ', call: 'พี่วิน ไปถ่ายงานหน่อยครับ' },
  { id: 'noon', name: 'น้องนุ่น', emoji: '🙋‍♀️', job: 'แอดมินเพจขายของ', home: 'อนุสาวรีย์ชัยฯ', type: 'normal', rarity: 'common', likes: 'ชอบให้ส่งเร็ว', call: 'พี่ ไปส่งของให้ลูกค้าหน่อย' },
  { id: 'ek', name: 'พี่เอก', emoji: '👷', job: 'โฟร์แมนไซต์ก่อสร้าง', home: 'รัชดา', type: 'rush', rarity: 'common', likes: 'ใจร้อน', call: 'เฮ้ย มาเร็ว ปูนจะเซ็ตแล้ว!' },
  { id: 'john', name: 'Mr. John', emoji: '🧑‍🦰', job: 'นักท่องเที่ยวแบ็กแพ็ค', home: 'ข้าวสาร', type: 'tourist', rarity: 'rare', likes: 'Loves temples', call: 'Hello my friend! Pick me up please!' },
  { id: 'yuki', name: 'Yuki', emoji: '👩‍🦱', job: 'นักท่องเที่ยวญี่ปุ่น', home: 'สยาม', type: 'tourist', rarity: 'rare', likes: 'ชอบช้อปปิ้ง', call: 'Sumimasen~ ไปห้างหน่อยค่ะ' },
  { id: 'wichai', name: 'คุณวิชัย', emoji: '🤵', job: 'ผู้จัดการธนาคาร', home: 'สีลม', type: 'rush', rarity: 'rare', likes: 'ทิปหนัก ถ้าถึงไว', call: 'คุณวิน ผมรีบ เดี๋ยวเพิ่มให้' },
  { id: 'nok', name: 'น้องนก', emoji: '💃', job: 'นักเต้นโคโยตี้', home: 'รัชดา', type: 'rush', rarity: 'rare', likes: 'วิ่งงานกลางคืน', call: 'พี่จ๋า ไปผับหน่อย สายแล้ว~' },
  { id: 'pao', name: 'เฮียเปา', emoji: '🧑‍🍳', job: 'เถ้าแก่ร้านทองเยาวราช', home: 'เยาวราช', type: 'normal', rarity: 'rare', likes: 'ไม่ชอบรอ', call: 'ลื้อมารับอั๊วหน่อย' },
  { id: 'pim', name: 'น้องพิม', emoji: '👩‍🎤', job: 'นักร้องเปิดหมวก', home: 'สยาม', type: 'normal', rarity: 'rare', likes: 'ฮัมเพลงตลอดทาง', call: 'พี่คะ ไปเล่นดนตรีที่สยามค่ะ' },
  { id: 'hans', name: 'Hans', emoji: '👨‍🦳', job: 'ชาวเยอรมันเกษียณ', home: 'สุขุมวิท', type: 'tourist', rarity: 'rare', likes: 'Speak slowly', call: 'Guten Tag! Sukhumvit please.' },
  { id: 'ploy', name: 'พลอย', emoji: '👸', job: 'ดาราซีรีส์ดัง', home: 'สุขุมวิท', type: 'rush', rarity: 'legend', likes: 'หนีปาปารัซซี่', call: 'พี่วินคะ ช่วยพาหนีนักข่าวที!' },
  { id: 'ohm', name: 'โอม', emoji: '🎤', job: 'นักร้องลูกทุ่งร้อยล้านวิว', home: 'อนุสาวรีย์ชัยฯ', type: 'rush', rarity: 'legend', likes: 'แจกลายเซ็น', call: 'พี่ครับ คอนเสิร์ตจะเริ่มแล้ว!' },
  { id: 'gift', name: 'กิ๊ฟท์', emoji: '📱', job: 'ยูทูบเบอร์สายกิน', home: 'เยาวราช', type: 'normal', rarity: 'legend', likes: 'ถ่ายคลิปตลอดทาง', call: 'สวัสดีค่าทุกคน วันนี้นั่งวินค่ะ!' },
  { id: 'khunying', name: 'คุณนาย', emoji: '💎', job: 'เศรษฐีนีย่านสาทร', home: 'สีลม', type: 'auntie', rarity: 'legend', likes: 'ทิปเป็นพัน ถ้าประทับใจ', call: 'พ่อหนุ่ม มารับฉันที่บ้านหน่อย' },
  { id: 'sam', name: 'แซม', emoji: '🏍️', job: 'แชมป์แข่งรถทางเรียบ', home: 'คลองเตย', type: 'rush', rarity: 'legend', likes: 'ชอบความเร็ว', call: 'บิดมาเลย อยากดูฝีมือ!' },
];

export const RARITY = { common: { label: 'ธรรมดา', level: 1, w: 70, color: '#8a8f98' }, rare: { label: 'หายาก', level: 3, w: 25, color: '#2e86de' }, legend: { label: 'ตำนาน', level: 8, w: 6, color: '#d4a017' } };

// Hearts 0..10 → how close you are.
export const BOND = [
  { hearts: 0, label: 'เพิ่งรู้จัก', bonus: 0 },
  { hearts: 3, label: 'ขาประจำ', bonus: 0.2 },
  { hearts: 6, label: 'เพื่อนสนิท', bonus: 0.4 },
  { hearts: 10, label: 'ลูกค้า VIP', bonus: 0.6 },
];
export const bondOf = (hearts) => BOND.filter((b) => hearts >= b.hearts).pop();

export class CustomerBook {
  constructor(save) {
    this.save = save;
    save.customers ??= {}; // id → { hearts, rides, bestTip, met }
    this.callTimer = 120 + Math.random() * 120;
  }

  entry(id) { return this.save.customers[id]; }

  // Maybe swap a random passenger for a named customer. Returns a customer or null.
  pick(level, busyIds) {
    if (Math.random() > 0.35) return null;
    const pool = CUSTOMERS.filter((c) => level >= RARITY[c.rarity].level && !busyIds.has(c.id));
    if (!pool.length) return null;
    const w = (c) => RARITY[c.rarity].w * (this.entry(c.id) ? 1.5 : 1);
    let roll = Math.random() * pool.reduce((s, c) => s + w(c), 0);
    for (const c of pool) { roll -= w(c); if (roll <= 0) return c; }
    return pool[0];
  }

  // After a trip with this customer. Returns { first, hearts, bond, levelledBond }.
  served(c, stars, tip) {
    const e = this.save.customers[c.id] ??= { hearts: 0, rides: 0, bestTip: 0 };
    const first = e.rides === 0;
    const before = bondOf(e.hearts);
    e.rides++;
    e.bestTip = Math.max(e.bestTip, tip);
    e.hearts = Math.max(0, Math.min(10, e.hearts + (stars >= 5 ? 2 : stars >= 4 ? 1 : stars <= 2 ? -1 : 0)));
    const bond = bondOf(e.hearts);
    return { first, hearts: e.hearts, bond, levelledBond: bond.hearts > before.hearts };
  }

  fareBonus(c) { const e = this.entry(c.id); return e ? bondOf(e.hearts).bonus : 0; }

  regulars() { return CUSTOMERS.filter((c) => (this.entry(c.id)?.hearts || 0) >= 3); }

  // Every few minutes a regular phones in for a ride. Returns the caller or null.
  tick(dt, busyIds) {
    this.callTimer -= dt;
    if (this.callTimer > 0) return null;
    this.callTimer = 150 + Math.random() * 150;
    const regs = this.regulars().filter((c) => !busyIds.has(c.id));
    return regs.length ? regs[Math.floor(Math.random() * regs.length)] : null;
  }
}
