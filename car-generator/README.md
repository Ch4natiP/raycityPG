# RayCity Car Generator

เครื่องมือสร้างโมเดลรถ 3 มิติแบบ procedural สำหรับเกม RayCity: ปรับรูปทรงด้วยสไลเดอร์ แล้วส่งออกเป็นไฟล์ `.glb` / `.obj` ไปใช้ใน Unity, Unreal, Godot หรือ Blender

## วิธีเปิดใช้งาน

**Windows:** ดับเบิลคลิก `start.bat` ในโฟลเดอร์ `car-generator` (ต้องมี Python) โปรแกรมจะเปิดในเบราว์เซอร์ให้เอง

**วิธีพิมพ์คำสั่งเอง:** ต้อง `cd` เข้าโฟลเดอร์ `car-generator` ก่อน ไม่อย่างนั้นจะเห็นแค่รายชื่อไฟล์ (Directory listing)

```bash
cd path/to/raycityPG/car-generator
python -m http.server 8000 --bind 127.0.0.1
# แล้วเปิด http://localhost:8000
```

(เปิดไฟล์ `index.html` ตรงๆ ด้วยการดับเบิลคลิกไม่ได้ เพราะเบราว์เซอร์ไม่โหลด ES modules จาก `file://`)

หรือ `npx serve car-generator` ก็ได้ (ต้องต่ออินเทอร์เน็ต เพราะโหลด three.js จาก CDN)

## ความสามารถ

- **แบบรถสำเร็จรูป 8 แบบ**: ซีดาน, สปอร์ต, แฮทช์แบ็ก, SUV, กระบะ, มัสเซิล, รถเล็ก, ซูเปอร์คาร์
- **สุ่มรถ** พร้อม Seed (ใส่เลข seed เดิมจะได้รถคันเดิมทุกครั้ง)
- ปรับได้ทุกส่วน: ความยาว/กว้าง/สูง, ฝากระโปรง, ห้องโดยสาร, ตำแหน่งกระจก, ล้อ, ลายแม็ก, ไฟหน้า/ท้าย,
  สปอยเลอร์, ลิ้นหน้า, ดิฟฟิวเซอร์, สเกิร์ต, สกู๊ป, แร็คหลังคา, แถบคาด, ไฟใต้ท้อง (neon) และสี/วัสดุ
- ระดับความละเอียด Low / Medium / High + โหมด Flat shading สไตล์ low-poly
- **ทดลองขับ** ในหน้าเว็บ (W A S D / ลูกศร, Space เบรก, R รีเซ็ต) เพื่อเช็คว่าล้อหมุนและเลี้ยวถูกต้อง
- ส่งออก `.glb` (แนะนำ), `.obj`, ภาพ `.png` และบันทึก/โหลดค่าเป็น `.json`
- ค่าล่าสุดถูกจำไว้ในเบราว์เซอร์อัตโนมัติ

## โครงสร้างโมเดลที่ส่งออก

- หน่วยเป็น **เมตร**, แกน **Y ขึ้น**, หน้ารถหันไปทาง **+Z**, จุด origin อยู่ที่พื้นกึ่งกลางตัวรถ
- ฝั่งซ้ายของรถคือ +X, ฝั่งขวาคือ −X

```
<ชื่อรถ>
├── Body          (วัสดุ: Paint, Stripe, Trim)
├── Cabin         (วัสดุ: Paint, Stripe, Trim, Glass)
├── Details
│   ├── Lights    (Headlight_L/R, Taillight_*)
│   └── Grille, Mirror_L/R, Spoiler_*, Exhaust, ...
├── Wheel_FL      ← pivot อยู่กลางล้อ (ใช้หมุนเลี้ยว)
│   ├── Wheel_FL_Spin   ← หมุนแกน X เพื่อให้ล้อหมุน
│   │   └── Tire, Rim, RimInner, BrakeDisc
│   └── Caliper   (ไม่หมุนตามล้อ)
├── Wheel_FR
├── Wheel_RL
└── Wheel_RR
```

ชื่อวัสดุ (Paint, Glass, Tire, Rim, Headlight, Taillight ฯลฯ) คงที่ทุกคัน จึงเปลี่ยนสีรถในเกมได้ด้วยการแก้วัสดุ `Paint` อย่างเดียว

## นำเข้าเกมเอนจิน

- **Unity**: ติดตั้ง [glTFast](https://docs.unity3d.com/Packages/com.unity.cloud.gltfast@latest) (หรือ UnityGLTF) แล้วลากไฟล์ `.glb` เข้า Assets
  ผูก `WheelCollider` กับ `Wheel_XX` และให้สคริปต์หมุน `Wheel_XX_Spin` ตามความเร็ว
- **Unreal**: Import `.glb` ได้โดยตรง (UE5) หรือแปลงเป็น `.fbx` ผ่าน Blender สำหรับ Chaos Vehicle (ต้องตั้ง skeleton ล้อ)
- **Godot 4**: ลาก `.glb` เข้าโปรเจกต์ได้เลย ใช้ `VehicleBody3D` + `VehicleWheel3D` ที่ตำแหน่ง `Wheel_XX`
- **Blender**: File → Import → glTF 2.0 แล้ว export เป็น `.fbx` ได้ถ้าเอนจินต้องการ

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html`, `style.css` | หน้าจอโปรแกรม |
| `js/carBuilder.js` | สร้าง geometry ของรถจากพารามิเตอร์ (ตัวถัง loft, ห้องโดยสาร, ล้อ, ชุดแต่ง) |
| `js/params.js` | รายการพารามิเตอร์ (สร้าง UI อัตโนมัติ), ค่าเริ่มต้น, presets และระบบสุ่ม |
| `js/main.js` | ฉาก 3D, UI, การส่งออก และโหมดทดลองขับ |

อยากเพิ่ม preset ใหม่: เพิ่ม entry ใน `PRESETS` ใน `js/params.js` (ใส่เฉพาะค่าที่ต่างจาก `DEFAULTS`)
อยากเพิ่มสไลเดอร์: เพิ่ม item ใน `SCHEMA` แล้วใช้ค่า `p.<key>` ใน `carBuilder.js`
