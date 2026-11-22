/* Shop tools: engine/injector calculators and a Honda DTC reference. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tools = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GASOLINE = 0.745;   // g/cc at pump temperature

  /** engine displacement (cc) from bore & stroke (mm) and cylinder count */
  function displacement(boreMm, strokeMm, cyl = 1) {
    return +(Math.PI / 4 * boreMm * boreMm * strokeMm * cyl / 1000).toFixed(1);
  }

  /** injector flow (cc/min, per injector) needed for a wheel-HP target.
   *  bsfc g/(hp·h) ~ 220 naturally aspirated petrol; dutyMax 0.8 keeps headroom. */
  function injectorNeeded(hp, { cyl = 1, bsfc = 220, duty = 0.8, density = GASOLINE } = {}) {
    if (hp <= 0) return 0;
    const ccPerMin = hp * bsfc / (density * 60);        // total fuel volume per minute
    return +(ccPerMin / (cyl * duty)).toFixed(1);
  }

  /** max supported HP for an installed injector (cc/min each) */
  function injectorMaxHp(ccMin, { cyl = 1, bsfc = 220, duty = 0.8, density = GASOLINE } = {}) {
    return +(ccMin * cyl * duty * density * 60 / bsfc).toFixed(1);
  }

  /** fuel-map scale to keep the same mixture after a hardware change.
   *  Larger injectors or smaller engine → less pulse width (<1). */
  function fuelScale({ oldCc = null, newCc = null, oldDisp = null, newDisp = null } = {}) {
    let s = 1;
    if (oldCc && newCc) s *= oldCc / newCc;             // bigger injector flows more, so shorten pulse
    if (oldDisp && newDisp) s *= newDisp / oldDisp;     // bigger engine needs more fuel
    return +s.toFixed(4);
  }

  /** speed (km/h) at an rpm for a given final drive & tyre, useful to label dyno runs */
  function speedAtRpm(rpm, { primary = 1, gear = 1, finalDrive = 1, tyreDia = 0 } = {}) {
    if (!tyreDia) return null;
    const wheelRpm = rpm / (primary * gear * finalDrive);
    return +(wheelRpm * Math.PI * tyreDia / 1000 * 60 / 1000).toFixed(1);   // tyreDia mm
  }

  // Honda PGM-FI blink/DTC codes: meaning · likely cause · what to check
  const DTC = {
    '1-1': ['MAP sensor แรงดันต่ำ', 'สายหลุด/ชอร์ตลงกราวด์ หรือเซนเซอร์เสีย', 'ปลั๊ก MAP, สายไฟ, ค่าสุญญากาศ'],
    '1-2': ['MAP sensor แรงดันสูง', 'สายขาด/ไม่ต่อ', 'ปลั๊ก MAP, สายสัญญาณ'],
    '7-1': ['ECT อุณหภูมิน้ำ/เครื่อง แรงดันต่ำ', 'เซนเซอร์ชอร์ต', 'ปลั๊ก ECT, ค่าความต้านทานตามอุณหภูมิ'],
    '7-2': ['ECT อุณหภูมิน้ำ/เครื่อง แรงดันสูง', 'สายขาด/เซนเซอร์เปิดวงจร', 'ปลั๊ก ECT, สายไฟ'],
    '8-1': ['TPS ลิ้นเร่ง แรงดันต่ำ', 'เซนเซอร์/สายชอร์ต', 'ปลั๊ก TPS, รีเซ็ต TPS'],
    '8-2': ['TPS ลิ้นเร่ง แรงดันสูง', 'สายขาด', 'ปลั๊ก TPS, สายสัญญาณ'],
    '9-1': ['IAT อุณหภูมิอากาศ แรงดันต่ำ', 'เซนเซอร์ชอร์ต', 'ปลั๊ก IAT'],
    '9-2': ['IAT อุณหภูมิอากาศ แรงดันสูง', 'สายขาด', 'ปลั๊ก IAT, สายไฟ'],
    '11-1': ['VS เซนเซอร์ความเร็ว', 'สาย/เซนเซอร์ความเร็วมีปัญหา', 'ปลั๊กเซนเซอร์ความเร็ว, เฟืองขับ'],
    '12-1': ['หัวฉีด (Injector)', 'ขดลวดหัวฉีดขาด/ปลั๊กหลวม', 'ความต้านทานหัวฉีด, ปลั๊ก'],
    '21-1': ['O2 เซนเซอร์', 'สาย O2/เซนเซอร์เสื่อม', 'ปลั๊ก O2, ค่าสัญญาณขณะอุ่น'],
    '23-1': ['ฮีตเตอร์ O2', 'ขดความร้อน O2 ขาด', 'ความต้านทานฮีตเตอร์, ฟิวส์'],
    '29-1': ['IACV รอบเดินเบา', 'มอเตอร์/วาล์วรอบเดินเบาติด', 'IACV, ทำความสะอาดลิ้นเร่ง'],
    '33-2': ['ECU EEPROM', 'หน่วยความจำกล่องผิดพลาด', 'กล่อง ECU'],
    '41-1': ['Bank angle / เซนเซอร์มุมเอียง', 'เซนเซอร์ล้ม/สาย', 'เซนเซอร์มุมเอียง'],
    '52-1': ['CKP เพลาข้อเหวี่ยง', 'สัญญาณรอบเครื่องหาย', 'ปลั๊ก CKP, ล้อแม่เหล็ก'],
    '54-1': ['Bank angle แรงดันต่ำ', 'เซนเซอร์มุมเอียงชอร์ต', 'เซนเซอร์มุมเอียง, สาย'],
    '54-2': ['Bank angle แรงดันสูง', 'สายขาด', 'เซนเซอร์มุมเอียง, สาย'],
    '86-1': ['วงจรไฟ MIL', 'สายไฟโชว์มีปัญหา', 'สาย MIL, เรือนไมล์'],
    '91-1': ['Ignition coil คอยล์จุดระเบิด', 'คอยล์/สายหัวเทียนเสื่อม', 'คอยล์, หัวเทียน, สาย'],
  };
  function dtcInfo(code) { const d = DTC[code]; return d ? { code, name: d[0], cause: d[1], check: d[2] } : { code, name: 'ไม่ทราบความหมาย', cause: 'ดูคู่มือซ่อมของรุ่นนั้น', check: '' }; }
  function dtcSearch(q) {
    q = String(q || '').trim().toLowerCase();
    return Object.keys(DTC).map(dtcInfo).filter(d => !q || d.code.includes(q) || d.name.toLowerCase().includes(q) || d.cause.toLowerCase().includes(q));
  }

  return { displacement, injectorNeeded, injectorMaxHp, fuelScale, speedAtRpm, dtcInfo, dtcSearch, DTC };
});
