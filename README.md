# SOS Hospital Finder

โปรเจคเว็บค้นหาโรงพยาบาลใกล้ตัวแบบ SOS ใช้ Vite + Leaflet

## วิธีรัน

```bash
npm install
npm run dev
```

เปิดเว็บที่:

```text
http://localhost:5500
```

## หมายเหตุ

- กดปุ่ม SOS แล้วระบบจะขอ GPS ทันที
- ถ้า browser ถามสิทธิ์ตำแหน่ง ให้กด Allow
- ใช้ข้อมูลโรงพยาบาลใน `src/data/hospitals.js`
- แก้หน้าตาใน `src/styles.css`
- แก้ logic หลักใน `src/main.js`
