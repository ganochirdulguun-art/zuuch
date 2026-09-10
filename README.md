# «Зууч» — Үл хөдлөх хөрөнгийн ухаалаг платформ

Монголын үл хөдлөх хөрөнгийн зуучлалын компаниудад зориулсан **multi-tenant SaaS**: CRM + зах зээлийн AI мониторинг + байршлын шинжилгээ. Домэйн: **zuuch.mn** (төлөвлөгдсөн).

**🌐 Амьд:** https://zuuch-production.up.railway.app — `main` салбарт push хийхэд Railway автоматаар deploy хийнэ.

## Ажиллуулах (локал)

```bash
npm install
npm start
```

- Нүүр хуудас (landing): http://localhost:3300/
- Систем (апп): http://localhost:3300/app

**Туршилтын эрх** (Демо агентлаг ХХК, нууц үг `zuuch2026`): `zahiral` (захирал) · `agent1`, `agent2` (агент).
Эсвэл нүүр хуудсаас **өөрийн компаниа бүртгүүлээд** шууд эхэлж болно.

## Боломжууд

- **Нүүр хуудас** — эргэлдэх AI сүлжээний бөмбөрцөг + LIVE статистиктай хөдөлгөөнт background, бүртгэл/нэвтрэлт.
- **Multi-tenant** — компани бүрийн өгөгдөл `company_id`-ээр **бүрэн тусгаарлагдсан**; зах зээлийн мэдээлэл (индекс, зар) нийтлэг.
- **CRM** — объект, харилцагч, хүсэлт, хэлцэл; ролийн систем (захирал/агент); багийн удирдлага.
- **Алгоритмууд** — А2 үнийн индекс, А3 үнэлгээ, А4 тохирол, А5 боломж, А6 сануулга, А8 байршлын оноо.
- **Цуглуулах хөдөлгүүр** — 10 worker, итгэлцүүрийн шүүлт, ажиглах горимын хамгаалалтууд (tier, retention, takedown, нөхцөлт татах). Демо (симуляц эх сурвалж); бодит хувилбарт Python адаптер.
- **Аюулгүй байдал** — scrypt нууц үг, сессийн хугацаа, нэвтрэлтийн rate-limit, CSP толгойнууд.

## Railway-д байрлуулах (түр хаяг)

1. GitHub repo үүсгэж push хийх (`.gitignore` бэлэн — `node_modules`, `zuuch.db` орохгүй).
2. Railway → New Project → Deploy from GitHub repo.
3. **Persistent Volume** нэмж `/data`-д mount хийх (өгөгдөл restart-д алдагдахгүй).
4. Орчны хувьсагчид (`.env.example`-ийг хар):
   - `ZUUCH_DB=/data/zuuch.db`
   - `ZUUCH_SALT=<урт random мөр>`
   - (`PORT`-ыг Railway өөрөө өгнө)
5. Deploy → `https://<project>.up.railway.app` хаягтай болно.
6. **Домэйн** (zuuch.mn) авсны дараа: Railway → Settings → Custom Domain дээр `zuuch.mn` нэмж, Datacom/mmnic дээрх DNS-д Railway-ийн CNAME-ийг зааж холбоно.

## Технологи

Node.js 22+ · Express 5 · `node:sqlite` (native dep-гүй) · vanilla JS фронтенд. Гадны хамаарал: зөвхөн `express`.

## Файл бүтэц

```
server.js        — API, нэвтрэлт, multi-tenant, аюулгүй байдал
db.js            — схем + миграци + демо өгөгдөл (companies, users, CRM, зах зээл)
algorithms.js    — А3/А4/А5/А8
collector.js     — цуглуулах хөдөлгүүр + ажиглах горимын хамгаалалтууд
public/landing.html — нүүр хуудас (хөдөлгөөнт background)
public/index.html + app.js — систем (SPA)
```

## Анхаар

Зах зээлийн зар, индекс, байршлын оноо нь одоогоор **жишиг (демо) өгөгдөл**. Бодит болгохын тулд `collector.js`-ийн `generateRaw`-г unegui.mn HTML адаптераар (Python) солино — «Ажиглах горим» цувралын (№5) хамгаалалтуудыг мөрдөнө.
