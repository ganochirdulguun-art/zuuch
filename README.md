# «Зууч» — Үл хөдлөх хөрөнгийн ухаалаг платформ

Монголын үл хөдлөх хөрөнгийн зуучлалын компаниудад зориулсан **multi-tenant SaaS**: CRM + зах зээлийн AI мониторинг + байршлын шинжилгээ + **Листингийн AI студи**. Домэйн: **zuuch.mn** (төлөвлөгдсөн).

**🌐 Амьд:** https://zuuch-production.up.railway.app — `main` салбарт push хийхэд Railway автоматаар deploy хийнэ.

## Ажиллуулах (локал)

```bash
npm install
cp .env.example .env   # DATABASE_URL заавал (PostgreSQL)
npm start
```

- Нүүр хуудас: http://localhost:3300/ · Систем: http://localhost:3300/app
- Туршилтын эрх (Демо агентлаг, нууц үг `zuuch2026`): `zahiral` · `agent1` · `agent2`

## Боломжууд

- **Multi-tenant** — компани бүрийн өгөгдөл тусгаарлагдсан; зах зээлийн мэдээлэл нийтлэг. Эзэн (super-admin) › Захирал › Агент.
- **CRM** — объект, харилцагч, хүсэлт, хэлцэл; өөрөө бүртгүүлэх; багийн удирдлага; нууц үг солих.
- **Алгоритмууд** — А2 үнийн индекс, А3 үнэлгээ, А4 тохирол, А5 боломж, А6 сануулга, А8 байршлын оноо.
- **🎨 Листингийн AI студи (Ш3а)** — объектын зургуудыг оруулахад: зураг бүрийн өрөө/чанар/wow оноо + эрэмбэ (эхний зураг = хамгийн wow) + «дахин ав» зөвлөмж; зарын текст ×3 суваг (unegui/Facebook/сайт, Монголоор); орчны давуу тал (А8); үнийн 3 стратеги (А3); 30 хоногийн борлуулалтын төлөвлөгөө. `ANTHROPIC_API_KEY` байхгүй бол загвар горим.
- **Цуглуулах хөдөлгүүр (Ш2)** — 10 worker (Postgres `FOR UPDATE SKIP LOCKED` queue), итгэлцүүрийн шүүлт, ажиглах горимын хамгаалалтууд. `ZUUCH_COLLECTOR_LIVE=1` бол **unegui.mn бодит адаптер** (`adapters/unegui.js`): зарна + түрээсийн толгой хуудсуудыг 10 мин тутам уншиж баримт (үнэ/талбай/өрөө/дүүрэг/огноо) л хадгална; robots.txt, ≥4 сек зай, 429/5xx-д хөргөлт; үнийн өөрчлөлт (`prev_price`), сайтаас хасагдсан огноо (`delisted_at` → зах зээлд байсан хоног); `/bot` — ботын ил бодлого + хасуулах хаяг. Тест: `npm test`.
- **Аюулгүй байдал** — scrypt нууц үг, сессийн хугацаа, rate-limit, CSP.

## Технологи

Node.js 22+ · Express 5 · **PostgreSQL** (`pg`) · multer (зураг) · `@anthropic-ai/sdk` (Claude) · vanilla JS фронтенд.

## Railway тохиргоо

| Хувьсагч | Утга |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres service reference) |
| `ZUUCH_UPLOADS` | `/data/uploads` (persistent volume) |
| `ZUUCH_SALT` | урт random мөр |
| `ZUUCH_OWNER_USER` / `ZUUCH_OWNER_PASS` | платформын эзэн (зөвхөн env-ээс үүснэ; `ZUUCH_OWNER_RESET=1` = нууц үг сэргээх) |
| `ANTHROPIC_API_KEY` | Claude API түлхүүр — студийн бодит AI |
| `ZUUCH_AI_MODEL` | анхдагч `claude-sonnet-5` |
| `ZUUCH_COLLECTOR_LIVE` | `1` = unegui.mn бодит ажиглах горим (автоматаар эхэлнэ); хоосон = демо |
| `ZUUCH_UNEGUI_INTERVAL` / `ZUUCH_UNEGUI_GAP_MS` | мөчлөгийн интервал (сек, анхдагч 600) / хүсэлт хоорондын зай (мс, 4000) |
| `ZUUCH_BOT_CONTACT` | ботын холбоо барих имэйл (UA + `/bot`) |

Домэйн (zuuch.mn) авсны дараа: Railway → Settings → Custom Domain → DNS CNAME.

## Файл бүтэц

```
server.js       — API, нэвтрэлт, multi-tenant, студийн API, аюулгүй байдал
db.js           — PostgreSQL pool, схем, seed, эзэн
algorithms.js   — А3/А4/А5/А8 (async)
collector.js    — цуглуулах хөдөлгүүр (async, SKIP LOCKED queue)
studio.js       — Листингийн AI студи (зургийн шинжилгээ, текст, давуу тал, үнэ, төлөвлөгөө)
public/landing.html — нүүр хуудас · public/index.html + app.js — систем (SPA)
```

## Анхаар

Зах зээлийн зар, индекс, байршлын оноо одоогоор **жишиг (демо)** — бодит болгоход `collector.js`-ийн `generateRaw`-г unegui.mn адаптераар (Python) солино («Ажиглах горим» цувралын хамгаалалтуудыг мөрдөж).
