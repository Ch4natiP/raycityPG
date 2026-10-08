// RayCity car spec file (<car>.xml, UTF-16): physics, engine, gears, boost, paints, camera.
// The template is the escarabajo.xml shipped with the game; values are swapped in by tag name so
// comments and every tag we don't expose stay exactly as in the original.

export const SPEC_TEMPLATE = "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\t\n<car>\t\n\t<!--슈퍼-->\n\t<BD_Mass>1300</BD_Mass>\n\t<BD_Offset>0 -0.2 0.5</BD_Offset>\n\t<EG_Drag>0.4</EG_Drag>\n\t<EG_TankSize>2500</EG_TankSize>\n\t<EG_Fuel>8</EG_Fuel>\n<!-- All Car Common -->\n\t<EG_RedRPM>4000</EG_RedRPM>\n\t<EG_MaxRPM>6000</EG_MaxRPM>\n\t<EG_Torque>100</EG_Torque>\n\t<EG_Sound>car_1000gas</EG_Sound>\n\t<MS_MinLevel>-1</MS_MinLevel>\n\t<MS_MaxLevel>3</MS_MaxLevel>\n\t<MS_DriveRatio>3</MS_DriveRatio>\n\t<MS_BaseRPM>700</MS_BaseRPM>\n\t<ST_Power>0.0</ST_Power>\n\t<TI_Mu>0.6</TI_Mu>\n\t<BK_Mu>0.8</BK_Mu>\n\t<BT_Duration>3</BT_Duration>\n\t<BT_Power>150</BT_Power>\n\t<BT_OverRPM>50</BT_OverRPM>\n\t<BT_NeedSP>50</BT_NeedSP>\n\t<BT_SpentSP>35</BT_SpentSP>\n\n\t<!--car default-->\n\t<MS_UpRpmRate>90</MS_UpRpmRate>\n\t<MS_DownRpmRate>30</MS_DownRpmRate>\n\t<MS_LagTime>0.2</MS_LagTime>\n\t<MS_Ratio>2.7 1.4 1.04 0.86 0.77 0.725 0.7025 0.69125 0.685625 0.682813</MS_Ratio>\n\t<MS_TractionRadius>0.27</MS_TractionRadius>\n<!-- All Car Common -->\n\t<TI_Overact>0.0</TI_Overact>\n\t<ST_MaxAngle>25.0</ST_MaxAngle>\n\t<ST_Stiff>31</ST_Stiff>\t\t\t\t\n\t<SU_Stable>0</SU_Stable>\t\t\t\t\n\t<SU_Height>0.12</SU_Height>\t\t\t\t\n\n\t<!--option-->\n  <opEG_Fuel>8</opEG_Fuel>\n\t<opEG_RedRPM>\t130\t</opEG_RedRPM>\n\t<opEG_MaxRPM>\t160\t</opEG_MaxRPM>\n\t<opEG_Torque>\t90\t</opEG_Torque>\n\t<opST_Power>\t0\t</opST_Power>\n\t<opTI_Mu>\t0\t</opTI_Mu>\n\t<opBK_Mu>\t0\t</opBK_Mu>\n\t<opBT_Duration>\t0.6\t</opBT_Duration>\n\t<opBT_Power>\t52\t</opBT_Power>\n\t<opBT_OverRPM>\t12\t</opBT_OverRPM>\n\n\n\n    <defaultPaint>\n        <paint>61</paint>\n        <paint>73</paint>\n        <paint>3</paint>\n        <paint>7</paint>\n        <paint>38</paint>\n        <paint>54</paint>\n    </defaultPaint>\n    <emblem>Leonados</emblem>\n    <firstTrunkSize>3</firstTrunkSize>\n    <maxTrunkSize>9</maxTrunkSize>\n\n<cameraOffset>\n  <bumper>\n    <dist>-1.84</dist>\n    <height>0.32</height>\n  </bumper>\n  <bonnet>\n    <dist>-0.88</dist>\n    <height>1.12</height>\n  </bonnet>\n</cameraOffset>\n</car>";

// Tags shown in the UI. Names follow the game's prefixes: BD body, EG engine, MS gearbox,
// TI tire, BK brake, ST steering, SU suspension, BT boost (SP = boost points).
export const SPEC_FIELDS = [
  { tag: 'BD_Mass', label: 'น้ำหนักรถ (kg)' },
  { tag: 'BD_Offset', label: 'จุดศูนย์ถ่วง x y z' },
  { tag: 'EG_Torque', label: 'แรงบิดเครื่อง' },
  { tag: 'EG_RedRPM', label: 'รอบเรดไลน์' },
  { tag: 'EG_MaxRPM', label: 'รอบสูงสุด' },
  { tag: 'EG_Drag', label: 'แรงต้านอากาศ' },
  { tag: 'EG_TankSize', label: 'ขนาดถังน้ำมัน' },
  { tag: 'EG_Fuel', label: 'อัตรากินน้ำมัน' },
  { tag: 'EG_Sound', label: 'เสียงเครื่อง' },
  { tag: 'MS_Ratio', label: 'อัตราทดเกียร์ 1–10' },
  { tag: 'MS_TractionRadius', label: 'รัศมีล้อขับ (m)' },
  { tag: 'TI_Mu', label: 'การเกาะถนนของยาง' },
  { tag: 'BK_Mu', label: 'แรงเบรก' },
  { tag: 'ST_MaxAngle', label: 'มุมเลี้ยวสูงสุด (องศา)' },
  { tag: 'SU_Height', label: 'ความสูงช่วงล่าง (m)' },
  { tag: 'BT_Power', label: 'พลังบูสต์' },
  { tag: 'BT_Duration', label: 'เวลาบูสต์ (วินาที)' },
  { tag: 'emblem', label: 'โลโก้ (emblem)' },
  { tag: 'firstTrunkSize', label: 'ช่องเก็บของเริ่มต้น' },
  { tag: 'maxTrunkSize', label: 'ช่องเก็บของสูงสุด' },
];

const re = (tag) => new RegExp(`(<${tag}>)([^<]*)(</${tag}>)`);

export function readSpec(text) {
  const values = {};
  for (const f of SPEC_FIELDS) {
    const m = text.match(re(f.tag));
    if (m) values[f.tag] = m[2].trim();
  }
  return values;
}

export function writeSpec(text, values) {
  let out = text;
  for (const [tag, v] of Object.entries(values)) {
    if (re(tag).test(out)) out = out.replace(re(tag), (_, a, _old, c) => `${a}${v}${c}`);
  }
  return out;
}

// UTF-16 LE with BOM and CRLF line endings, like the game's files.
export function encodeSpec(text) {
  const s = text.replace(/\r?\n/g, '\r\n');
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
}

export function decodeSpec(buf) {
  const b = new Uint8Array(buf);
  const utf16 = (b[0] === 0xff && b[1] === 0xfe) || b[1] === 0;
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(b).replace(/^\uFEFF/, '');
}

// Rough starting values from the generated car's size (mass ~ volume, traction radius = wheel).
export function suggestSpec(params) {
  const vol = params.length * params.width * (params.roofHeight - params.clearance);
  return {
    BD_Mass: String(Math.round((vol * 105) / 10) * 10),
    MS_TractionRadius: params.wheelRadius.toFixed(2),
    SU_Height: Math.max(0.05, params.clearance - 0.04).toFixed(2),
  };
}
