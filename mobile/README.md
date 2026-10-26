# RayCity PG บนมือถือ (Android)

แอปนี้คือหน้า RayCity Drive (`car-generator/RayCity-Drive.html`) กับเมืองจริงของเกม (`car-generator/city/`) ใส่ไว้ในแอป Android (Capacitor)
หน้าเว็บใช้ทดสอบ/สำหรับแอดมิน ส่วนผู้เล่นใช้แอป

## เอาไฟล์ APK
ทุกครั้งที่ push การแก้หน้า Drive หรือโฟลเดอร์นี้ GitHub จะสร้าง APK ให้เอง:
GitHub → แท็บ **Actions** → **Android APK** → รอบล่าสุด → **Artifacts** → `RayCity-PG-apk` (ไฟล์ zip ข้างในมี `app-debug.apk`)
ส่งไฟล์ .apk ลงโทรศัพท์ แล้วเปิดติดตั้ง (ต้องอนุญาต "ติดตั้งแอปจากแหล่งที่ไม่รู้จัก")

## สร้างเองในเครื่อง (ถ้ามี Android Studio / Android SDK)
```
cd car-generator && node build.mjs      # สร้าง RayCity-Drive.html
cd ../mobile && npm ci && npm run apk     # → android/app/build/outputs/apk/debug/app-debug.apk
```

## หมายเหตุ
- เป็น APK แบบ debug (เซ็นด้วยกุญแจทดสอบ) ใช้ติดตั้งเองได้ แต่ขึ้น Play Store ไม่ได้
- จอแนวนอน เต็มจอ จอไม่ดับระหว่างเล่น · คุณภาพเริ่มที่ "ต่ำ" บนมือถือ เปลี่ยนได้ที่ ⚙
