# CCL CRM — Auth Deployment Flow (Dev → Staging → Production)

เพื่อไม่ให้การเพิ่มระบบ login กระทบไซต์ live ที่ทีมใช้งานอยู่ ให้ทำตาม flow นี้ทีละขั้น
**ห้ามข้ามขั้นไป production โดยตรง**

```
Dev (โลคอล)  →  Staging (URL ทดสอบแยก + สเปรดชีต copy)  →  Production (ของจริง)
```

## ขั้น 0 — เตรียมโค้ด

ไฟล์ `analysis/apps_script_with_auth.gs` ในโปรเจกต์นี้คือ backend ตัวใหม่
เปิด **Raw** จาก GitHub เพื่อ copy:
https://github.com/Spyzealer/ccl-crm/blob/feature/login-auth/analysis/apps_script_with_auth.gs

ก่อน deploy ที่ไหนก็ตาม **ต้องเปลี่ยนค่า `SETUP_KEY`** ที่ต้นไฟล์ให้เป็นค่าสุ่มของตัวเอง
(ห้ามใช้ค่าใน repo ตรงๆ เพราะทุกคนที่เห็น repo จะรู้ค่านี้ด้วย) — จะสุ่มเองยังไงก็ได้
เช่น เปิด https://www.uuidgenerator.net/ หรือพิมพ์อะไรยาวๆ 20+ ตัวก็พอ

## ขั้น 1 — Staging (ทดสอบก่อนของจริง เสมอ)

**สร้าง Google Sheet ใหม่แยกจากของจริง** (สำคัญที่สุด — ป้องกันข้อมูลจริงเสียหาย):

1. เปิด Google Sheet ของจริง (ที่มี Customers/Services/Followups/Churned) → **File → Make a copy**
   → ตั้งชื่อว่า `CCL CRM (STAGING - อย่าใช้จริง)`
2. เปิดสเปรดชีตที่ copy มาใหม่ → **Extensions → Apps Script**
3. ลบโค้ดเดิมในไฟล์ (ที่ copy มาด้วยกันตอน Make a copy) → paste โค้ดจาก `apps_script_with_auth.gs` แทนทั้งหมด
4. แก้ค่า `SETUP_KEY` เป็นค่าสุ่มของตัวเอง (ดูขั้น 0) → Ctrl+S save
5. **Deploy → New deployment** → เลือก type: **Web app** → Execute as: **Me** → Who has access: **Anyone** → Deploy
   → กด **Authorize access** ครั้งแรก (Allow ทุกสิทธิ์ที่ขอ — เป็นสคริปต์ของคุณเอง ปลอดภัย)
   → copy **Web app URL** ที่ได้ → นี่คือ **STAGING URL**
6. เปิด **STAGING URL** ในเบราว์เซอร์ แล้วต่อท้ายด้วย:
   `?action=setup&key=<SETUP_KEY ที่ตั้งไว้ขั้น 4>`
   ตัวอย่าง: `https://script.google.com/macros/s/AKfyxxx/exec?action=setup&key=tjFelQ...`
7. จะเห็น JSON ตอบกลับพร้อม **รหัสผ่านชั่วคราวของ Nic และ faii.w** — copy เก็บไว้ (จะไม่โชว์ซ้ำ)
   ตรวจว่า Google Sheet มี tab ใหม่ **Users** และ **Sessions** โผล่มาแล้ว

**ทดสอบ frontend กับ staging URL:**

8. รันโลคอล: `cd ~/ccl-crm-site && python3 -m http.server 8091`
9. เปิด `http://localhost:8091/index.html` ในเบราว์เซอร์ → ควรเจอหน้า login gate
10. Login ด้วย `Nic` + รหัสชั่วคราวจากขั้น 7 → ควรถูกบังคับเปลี่ยนรหัสผ่านก่อนเข้าใช้งาน
11. ⚙️ Sync Settings → เปลี่ยน URL เป็น **STAGING URL** (ค่า default ในโค้ดยังชี้ไป production เดิม
    จนกว่าเรา merge) → กดทดสอบ, ลองแก้ข้อมูลลูกค้าดู 1 ตัว → เช็คว่า sheet staging เปลี่ยนตาม
    (ของจริงไม่กระทบ เพราะเป็นคนละสเปรดชีต)
12. ลองใส่รหัสผ่านผิด 5 ครั้งติด → ควรเจอ "ล็อก 15 นาที"
13. ลอง logout แล้ว login ใหม่ → ควรทำงานปกติ

**ผ่านทุกข้อ 8-13 ถึงไปขั้น 2 ได้**

## ขั้น 2 — Production (ของจริง)

เมื่อ staging ผ่านหมดแล้ว:

1. เปิด Apps Script editor ของสเปรดชีต **ของจริง** (ไม่ใช่ staging)
2. ลบโค้ดเดิม → paste โค้ดเดียวกับที่ผ่าน staging มา
3. แก้ `SETUP_KEY` เป็นค่าใหม่อีกอัน (ห้ามใช้ค่าเดียวกับ staging)
4. **Deploy → Manage deployments** → แก้ deployment เดิมที่ index.html ใช้อยู่
   (ไอคอนดินสอ ✏️) → Version: **New version** → Deploy
   (ใช้ URL เดิม — ต้อง "New version" ไม่ใช่ "New deployment" ตรงนี้ เพื่อไม่ให้ URL เปลี่ยน)
5. เปิด production URL เดิม ต่อท้ายด้วย `?action=setup&key=<key ใหม่ของขั้น 3>`
6. Copy รหัสผ่านชั่วคราวของ Nic/faii.w (คนละอันกับ staging) ส่งให้เจ้าของบัญชีจริง
7. บอกผม (agent) ว่าเสร็จแล้ว → ผมจะ merge branch `feature/login-auth` เข้า `main`
   → Netlify deploy หน้า login ให้ไซต์ live โดยอัตโนมัติ

## Rollback ถ้าเกิดปัญหาที่ production

- **Apps Script**: Deploy → Manage deployments → เลือก version เก่าก่อนแก้ → Deploy
  (ย้อนกลับไปโค้ดเดิมที่ไม่มี auth ได้ทันที)
- **Netlify/index.html**: `git revert` commit ที่ merge เข้า main แล้ว push
  → Netlify auto-deploy เวอร์ชันก่อน login กลับมา
