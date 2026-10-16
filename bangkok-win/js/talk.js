// Talking to people on foot (E): win colleagues at the stand, street vendors, people on the
// pavement and passengers waiting for a ride. A conversation is a few lines and 2-4 choices;
// some choices do something (buy a drink, haggle a fare, find a customer, hear about a rival).

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const baht = (n) => `฿${Math.round(n).toLocaleString('th-TH')}`;
const RANGE = 2.8;

const WIN_HELLO = ['ไง ไอ้น้อง วันนี้วิ่งได้กี่เที่ยวแล้ว', 'เหนื่อยไหม มานั่งพักก่อน', 'มาๆ วันนี้ร้อนชิบเป๋ง', 'ว่าไงเบอร์ {me} รถยังไหวอยู่ไหม'];
const WIN_TIPS = [
  'ช่วงเช้า 7 โมงถึง 9 โมงครึ่ง กับเย็น 5 โมงถึงทุ่มครึ่ง คนเยอะ ค่ารถขึ้นด้วย',
  'ฝนตกคนเรียกวินกันทั้งเมือง แต่ถนนลื่น ยางหัวโล้นนี่ล้มง่ายนะ',
  'อย่าฝ่าไฟแดง แถวนี้ตำรวจตั้งด่านบ่อย ปรับทีเหนื่อยฟรีทั้งวัน',
  'น้ำมันเครื่องเปลี่ยนบ่อยๆ หมดเมื่อไหร่เครื่องพังไวมาก',
  'ลูกค้าประจำนี่สำคัญ ส่งดีๆ เขาจะโทรเรียกเราเอง',
  'อย่าขึ้นฟุตบาทบ่อย ลูกค้าเขาไม่ชอบ ดาวหายหมด',
  'ดึกๆ ค่ารถแพงขึ้นหน่อย แต่ระวังคนเมาข้ามถนนนะ',
  'ลูกค้ารีบน่ะทิปดี ถ้าไปถึงทันเวลา',
  'แต่งรถได้ที่อู่ตรงวินนี่แหละ กด G เลย',
];
const WIN_BYE = ['ไปเถอะ ขับดีๆ ล่ะ', 'โชคดี วันนี้ได้เยอะๆ นะ', 'เดี๋ยวคิวหน้าข้าวิ่งเอง ไปๆ'];
const VENDORS = [
  { name: 'ป้าขายหมูปิ้ง', hello: 'หมูปิ้งร้อนๆ ข้าวเหนียวนุ่มๆ จ้า', items: [['ข้าวเหนียวหมูปิ้ง', 30, 'อิ่มท้อง'], ['น้ำเปล่าเย็นๆ', 10, 'ชื่นใจ']] },
  { name: 'ลุงชาเย็น', hello: 'ชาเย็น ชาดำเย็น โอเลี้ยง หวานน้อยหวานมากบอกลุง', items: [['ชาเย็นแก้วใหญ่', 25, 'สดชื่น'], ['โอเลี้ยง', 20, 'ตาสว่าง']] },
  { name: 'เจ๊ส้มตำ', hello: 'ตำไทยตำปูปลาร้า เผ็ดกี่เม็ดจ๊ะ', items: [['ส้มตำไทย', 40, 'อิ่มเผ็ด'], ['ไก่ย่างไม้นึง', 25, 'มีแรง']] },
  { name: 'พี่ร้านกาแฟรถเข็น', hello: 'กาแฟสดครับ เอสเย็นเข้มๆ ขายดีสุด', items: [['เอสเย็น', 45, 'ตื่นตัว'], ['โกโก้เย็น', 35, 'สดชื่น']] },
];
const LOCAL_HELLO = ['คะ? มีอะไรเหรอ', 'ครับพี่', 'ร้อนเนอะวันนี้', 'รถติดมากเลยแถวนี้', 'เมื่อกี้ฝนเกือบตกแน่ะ', 'เสื้อวินพี่เท่ดีนะ'];
const LOCAL_YES = ['เอาสิ กำลังจะเรียกวินพอดี', 'ไปค่ะ เดินไม่ไหวแล้ว ร้อน', 'ดีเลย รีบอยู่พอดี'];
const LOCAL_NO = ['ไม่เป็นไรครับ เดินไปใกล้ๆ', 'ขอบคุณค่ะ รอเพื่อนอยู่', 'เดี๋ยวนั่งรถเมล์ครับ'];
const DIRS = ['ทางทิศเหนือ', 'ทางทิศตะวันออก', 'ทางทิศใต้', 'ทางทิศตะวันตก'];

export class Talk {
  constructor({ hud, save, sfx, jobs, city, battles, walker }) {
    Object.assign(this, { hud, save, sfx, jobs, city, battles, walker });
    this.el = document.createElement('div');
    this.el.id = 'talk';
    this.el.innerHTML = '<div class="talk-box"><div class="talk-who"></div><div class="talk-text"></div><div class="talk-opts"></div></div>';
    document.body.appendChild(this.el);
    this.npc = null;
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const n = +e.key;
      if (n >= 1 && n <= this.options.length) { e.preventDefault(); this.choose(n - 1); }
      if (e.code === 'Escape') { e.preventDefault(); this.close(); }
    });
  }

  get isOpen() { return this.el.classList.contains('show'); }

  // the closest person you can talk to, or null
  nearest(x, z) {
    let best = null; let bd = RANGE;
    const consider = (npc, px, pz) => { const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = npc; } };
    for (const w of this.jobs.waiting) consider({ kind: 'passenger', w }, w.person.position.x, w.person.position.z);
    for (const n of this.city.npcs || []) consider(n, n.x, n.z);
    return best;
  }

  label(npc) {
    if (npc.kind === 'passenger') return npc.w.customer ? `${npc.w.customer.emoji} ${npc.w.name}` : npc.w.name;
    if (npc.kind === 'win') return `พี่วินเบอร์ ${npc.number}`;
    if (npc.kind === 'vendor') return VENDORS[npc.v % VENDORS.length].name;
    return npc.name || 'คนเดินถนน';
  }

  open(npc) {
    this.npc = npc;
    this.el.classList.add('show');
    this.walker.busy = true;
    const at = npc.kind === 'passenger' ? npc.w.person.position : npc;
    this.walker.face(at.x, at.z);
    if (npc.kind === 'passenger') npc.w.person.rotation.y = Math.atan2(this.walker.x - at.x, this.walker.z - at.z);
    if (npc.person) npc.person.rotation.y = Math.atan2(this.walker.x - npc.x, this.walker.z - npc.z);
    this[`start_${npc.kind}`](npc);
  }

  // where the other person stands (for the camera)
  where() {
    const n = this.npc;
    if (!n) return null;
    return n.kind === 'passenger' ? n.w.person.position : n;
  }

  close() {
    this.el.classList.remove('show');
    this.walker.busy = false;
    this.npc = null;
  }

  // show a line and the choices: [[label, fn]]
  say(text, options) {
    const who = this.label(this.npc);
    this.el.querySelector('.talk-who').textContent = who;
    this.el.querySelector('.talk-text').textContent = text.replace('{me}', this.save.look?.vestNumber ?? 99);
    this.options = options;
    const box = this.el.querySelector('.talk-opts');
    box.innerHTML = options.map(([l], k) => `<button data-k="${k}"><b>${k + 1}</b> ${l}</button>`).join('');
    box.querySelectorAll('button').forEach((b) => { b.onclick = () => this.choose(+b.dataset.k); });
    this.sfx?.blip?.();
  }

  choose(k) { const o = this.options?.[k]; if (o) o[1](); }

  // ---- the win stand ----
  start_win(npc) { this.say(pick(WIN_HELLO), this.winMenu(npc)); }
  winMenu(npc) {
    return [
      ['มีทิปอะไรบ้างพี่', () => this.say(pick(WIN_TIPS), this.winMenu(npc))],
      ['ช่วงนี้ใครซิ่งบ้าง', () => this.say(this.rivalGossip(), this.winMenu(npc))],
      ['งานแถวไหนดี', () => this.say(this.hotZone(), this.winMenu(npc))],
      ['ไปละพี่', () => { this.say(pick(WIN_BYE), [['👋 ไปละ', () => this.close()]]); }],
    ];
  }
  rivalGossip() {
    const b = this.battles;
    const won = this.save.battle?.rivals || {};
    const open = b.rivals.filter((r) => !won[r.id]?.wins);
    if (!open.length) return 'เดี๋ยวนี้ไม่มีใครกล้าท้าเอ็งแล้ว ราชาถนนตัวจริง';
    const r = open.reduce((a, c) => (c.level < a.level ? c : a));
    const where = this.city.districtOf(r.x, r.z);
    return `ระวัง${r.name} Lv.${r.level} นะ ล่าสุดเห็นวนแถว${where} ${this.save.level < r.level ? 'ยังไม่ถึงชั้นหรอก ไปเก็บเลเวลก่อน' : 'ถ้าเจอก็กด B ท้ามันเลย'}`;
  }
  hotZone() {
    const count = new Map();
    for (const w of this.jobs.waiting) { const d = this.city.districtOf(w.poi.x, w.poi.z); count.set(d, (count.get(d) || 0) + 1); }
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    return top ? `ได้ข่าวว่าแถว${top[0]}คนรอวินอยู่ ${top[1]} คน รีบไปก่อนเจ้าอื่นเอาไป` : 'เงียบๆ ช่วงนี้ รอสักพักเดี๋ยวก็มา';
  }

  // ---- street food ----
  start_vendor(npc) { const V = VENDORS[npc.v % VENDORS.length]; this.say(V.hello, this.vendorMenu(npc, V)); }
  vendorMenu(npc, V) {
    return [
      ...V.items.map(([name, price, feel]) => [`${name} (${baht(price)})`, () => this.buy(npc, V, name, price, feel)]),
      ['แถวนี้มีอะไรน่าไปบ้าง', () => this.say(this.directions(npc, true), this.vendorMenu(npc, V))],
      ['ไว้ก่อนนะ', () => this.close()],
    ];
  }
  buy(npc, V, name, price, feel) {
    if (this.save.money < price) return this.say('เงินไม่พอนี่หว่า ไว้วิ่งได้แล้วค่อยมาอุดหนุนนะ', this.vendorMenu(npc, V));
    this.save.money -= price;
    // a full stomach and a cold drink: a good mood for the next three rides (+10% fares)
    this.save.buff = { name: feel, mul: 0.1, trips: 3 };
    this.save.write();
    this.hud.stats(this.save);
    this.sfx?.cash?.();
    this.hud.toast(`${feel}! ค่าโดยสาร +10% อีก 3 เที่ยว`, `🍽 ${name}`);
    this.say(pick(['ขอบใจจ้า ขับดีๆ นะ', 'ได้เลย ร้อนๆ เลยจ้า', 'อุดหนุนบ่อยๆ นะจ๊ะ']), [['ขอบคุณครับ', () => this.close()]]);
  }

  // ---- people on the street ----
  start_local(npc) {
    this.say(pick(LOCAL_HELLO), [
      ['ไปไหนครับ ให้ไปส่งไหม', () => this.offerRide(npc)],
      ['ถามทางหน่อยครับ', () => this.say(this.directions(npc), [['ขอบคุณครับ', () => this.close()]])],
      ['ไม่มีอะไรครับ', () => this.close()],
    ]);
  }
  offerRide(npc) {
    if (npc.asked) return this.say('บอกแล้วไงว่าไม่เป็นไร', [['ครับๆ', () => this.close()]]);
    npc.asked = true;
    if (this.jobs.active || Math.random() > 0.45) return this.say(pick(LOCAL_NO), [['ไม่เป็นไรครับ', () => this.close()]]);
    // they become a passenger right here
    this.jobs.spawnWaiting(this.walker, null, { name: this.city.placeName ? this.city.placeName(npc.x, npc.z) : 'ริมถนน', x: npc.x, z: npc.z });
    this.say(`${pick(LOCAL_YES)} เดี๋ยวรอตรงนี้นะ ไปเอารถมาเลย`, [['ได้เลย (ขึ้นรถแล้วขี่มารับ)', () => this.close()]]);
  }
  directions(npc, near = false) {
    const pois = this.city.pois.filter((p) => p.landmark && p.name && !/^วิน/.test(p.name));
    if (!pois.length) return 'แถวนี้ก็มีแต่ตึกแหละ';
    const by = pois.map((p) => [p, Math.hypot(p.x - npc.x, p.z - npc.z)]).filter(([, d]) => d > 60).sort((a, b) => a[1] - b[1]);
    const [p, d] = near ? by[0] : by[Math.min(by.length - 1, Math.floor(Math.random() * 4))];
    const a = Math.atan2(p.x - npc.x, -(p.z - npc.z)); // 0 = north
    const dir = DIRS[((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4];
    return `${p.name} อยู่${dir} ประมาณ ${d > 1000 ? (d / 1000).toFixed(1) + ' กิโล' : Math.round(d / 50) * 50 + ' เมตร'}`;
  }

  // ---- a passenger waiting for a ride: agree the price, or haggle ----
  start_passenger(npc) {
    const w = npc.w;
    if (this.jobs.active) return this.say('มีคนนั่งอยู่แล้วนี่ ไว้คราวหน้านะ', [['ครับ', () => this.close()]]);
    w.quote ??= this.jobs.quote(w, this.walker);
    const q = w.quote;
    const hello = w.customer ? `${w.customer.call} (${w.customer.job})` : pick(['พี่ๆ ว่างไหม', 'ไปไหมคะ', 'วินๆ ไปหน่อยครับ']);
    this.say(`${hello} ไป${q.dest.name} ${baht(q.fare)} ได้ไหม`, [
      ['ได้เลย เดี๋ยวพี่ไปเอารถ', () => { w.agreed = true; this.say('โอเค รอตรงนี้นะ', [['👍', () => this.close()]]); }],
      ['ขอเพิ่มอีกหน่อยนะ (ต่อราคา)', () => this.haggle(w)],
      ['ไม่ว่างครับ', () => this.close()],
    ]);
  }
  haggle(w) {
    const q = w.quote;
    if (w.haggled) return this.say('ต่อไปแล้วนะพี่ ราคานี้แหละ', [['ก็ได้ ไปครับ', () => { w.agreed = true; this.close(); }], ['งั้นไม่ไปครับ', () => this.close()]]);
    w.haggled = true;
    // tourists say yes more often, aunties bargain hard, regulars trust you
    const yes = { tourist: 0.75, rush: 0.6, normal: 0.45, auntie: 0.25 }[w.type] ?? 0.45;
    if (Math.random() < yes + (w.customer ? 0.15 : 0)) {
      q.fare = Math.round((q.fare * 1.2) / 5) * 5;
      w.fareMul = 1.2;
      w.agreed = true;
      this.say(`เฮ้อ... ก็ได้ ${baht(q.fare)} แต่ไปเร็วๆ นะ`, [['ขอบคุณครับ ไปเอารถก่อน', () => this.close()]]);
    } else if (Math.random() < 0.5) {
      this.say('แพงไปพี่ ราคาเดิมนั่นแหละ ไม่ไหวหนูเรียกวินอื่น', [['ก็ได้ ราคาเดิม', () => { w.agreed = true; this.close(); }], ['งั้นไม่ไปครับ', () => this.close()]]);
    } else {
      this.say('ไม่เอาละ แพงขนาดนั้นเดินเอาก็ได้', [['...', () => { this.jobs.dismiss(w); this.close(); }]]);
    }
  }
}
