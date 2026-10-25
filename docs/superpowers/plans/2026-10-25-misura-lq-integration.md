# Misura nell'admin LQ — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** proprietario e sviluppatore, con verifica in due passaggi, aprono Misura da `/admin/misura/`, misurano un capo e lo pubblicano nel negozio LQ (o lo salvano come bozza) con descrizione suggerita e foto per il negozio.

**Architecture:** due repository. **LQ** (`Desktop\LQ-Milano-Handoff\site`, Astro 7 + Node): utenti con ruolo e TOTP, sessione con versione, registro, stato bozza nascosto dal pubblico, endpoint `POST /api/admin/misura/item`, percorso protetto che serve la build di Misura con intestazioni proprie. **Misura** (`Desktop\misura-app`, Vite + React): modalità di build `lq` (base `/admin/misura/`, niente PWA), schermata "Scheda negozio" con descrizione suggerita e ritaglio foto, invio a LQ con coda.

**Tech Stack:** Astro 7, @astrojs/node, sharp (già presente), node:crypto (TOTP, niente nuove librerie), vitest (nuovo in LQ, già in Misura), React 19, Vite 8.

**Spec:** `docs/superpowers/specs/2026-10-25-misura-lq-integration-design.md` (stesso repository LQ).

## Global Constraints
- Ruoli: solo `'proprietario' | 'sviluppatore'`; `can(user, 'misura')` vero per entrambi; ogni pagina/API Misura passa da `can`.
- TOTP obbligatorio: RFC 6238, SHA-1, 6 cifre, periodo 30 s, finestra ±1, codice riusato rifiutato (`lastTotpStep`).
- Cookie temporaneo tra password e codice: 5 minuti, non apre nessuna pagina admin.
- Limite tentativi esistente: 8 per IP ogni 15 minuti, su entrambi i passi.
- File privati in `data/private/` (`users.json`, `audit.log`), **aggiunti a `.gitignore`** (il repository LQ è pubblico e `data/` è versionata).
- Registro: JSON per riga, conservazione 12 mesi, mai foto né password.
- Endpoint item: 1–8 foto, ognuna ≤ 15 MB e ≤ 60 Mpx; titolo 120, taglia 20, composizione 200, made in 40, descrizione 4000, ≤ 12 misure (etichetta ≤ 40, valore 0–300 cm), prezzo 0–100 000; campi sconosciuti → 400.
- Pubblicazione: nome, prezzo, categoria LQ, ≥ 1 foto, descrizione ≥ 20 caratteri, made in e composizione (se presenti) confermati. Mai degradare in silenzio a bozza.
- Testi fissi: "Misure indicative, capo steso in piano"; "Indicazione in etichetta: Made in …"; conferma "Il capo sarà visibile subito nel negozio".
- Intestazioni solo su `/admin/misura/*`: `Permissions-Policy: camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=(), interest-cohort=()`; CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Il resto del sito invariato.
- Testi dell'interfaccia in italiano; codice e commenti in inglese come nel resto dei due repository.
- Nessun push senza OK di Filippo; nessuna password digitata per lui.
- Non esiste una sitemap nel sito: la voce "sitemap" della specifica non richiede lavoro.

## Review Focus
1. **Foto di una bozza raggiungibile da fuori**: `/media/uploads/products/<slug>/…` oggi è pubblico e in cache "immutable" → per una bozza deve rispondere 404 senza sessione admin (test in Task 3).
2. **Modifica di una bozza dall'admin**: `saveProductFromForm` ricostruisce il prodotto e perderebbe `draft`/`source` → deve conservarli (test in Task 3).
3. **Copia statica per GitHub Pages**: `scripts/export-static.mjs` legge i file in `data/products` direttamente → deve saltare le bozze (test in Task 3).
4. **Sessione scaduta durante l'invio da Misura**: 401 → il capo resta in coda, nessuna perdita, reinvio dopo il login (test in Task 8, prova in Task 9).
5. **Doppio tocco su "Pubblica"**: due richieste con lo stesso `misuraId` → un solo prodotto (test in Task 4).

---

## Repository LQ

### Task 1: Base di test e utenti con ruolo

**Files:**
- Modify: `package.json` (devDependency `vitest`, script `"test": "vitest run"`), `.gitignore` (+ `data/private/`)
- Create: `vitest.config.ts` (env `LQ_DATA_DIR` verso una cartella temporanea per test), `src/lib/users.ts`, `src/lib/permissions.ts`
- Test: `src/lib/users.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'proprietario' | 'sviluppatore'`
  - `type AdminUser = { user: string; role: Role; passwordHash: string; totpSecret: string; lastTotpStep: number; sessionVersion: number; createdAt: string }`
  - `USERS_FILE` = `join(DATA_DIR, 'private', 'users.json')`
  - `readUsers(): AdminUser[]` (cache invalidata da `mtimeMs`), `getUser(name: string): AdminUser | undefined`, `writeUsers(users: AdminUser[]): void` (scrittura atomica tmp+rename)
  - `bumpSessionVersion(name: string): void`
  - `can(user: Pick<AdminUser,'role'> | null, perm: 'misura'): boolean`

- [ ] **Step 1: Test** `users.test.ts`: `writeUsers` + `readUsers` rilegge gli stessi dati; dopo una scrittura esterna del file `readUsers` vede il cambiamento; `bumpSessionVersion('a')` incrementa di 1; `can({role:'proprietario'},'misura') === true`, `can({role:'sviluppatore'},'misura') === true`, `can({role:'x' as Role},'misura') === false`, `can(null,'misura') === false`.
- [ ] **Step 2:** `npx vitest run src/lib/users.test.ts` → FAIL (moduli mancanti).
- [ ] **Step 3:** Implementa `users.ts` e `permissions.ts` (`can` con una mappa `Record<Role, Set<Perm>>`).
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5:** Commit `Utenti con ruolo e permessi (base di test vitest)`.

### Task 2: TOTP, accesso in due passi, sessione con versione, registro

**Files:**
- Create: `src/lib/totp.ts`, `src/lib/audit.ts`, `src/pages/admin/login/codice.astro`, `src/pages/api/admin/login-code.ts`
- Modify: `src/lib/auth.ts`, `src/middleware.ts`, `src/pages/api/admin/login.ts`, `src/pages/api/admin/logout.ts`, `src/env.d.ts`, `scripts/create-admin.mjs`; create `scripts/remove-admin.mjs`; `package.json` script `admin:remove`
- Test: `src/lib/totp.test.ts`, `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `totp.ts`: `base32Encode(buf: Buffer): string`, `base32Decode(s: string): Buffer`, `totpAt(secret: string, step: number): string`, `verifyTotp(secret: string, code: string, lastStep: number, now = Date.now()): number | null` (restituisce lo step accettato, `null` se sbagliato o già usato), `otpauthUri(user: string, secret: string): string` (issuer `LQ Milano`)
  - `auth.ts`: `MFA_COOKIE = 'lq_mfa'`; `createPending(cookies, user, secure)` (5 min, firmato), `readPending(cookies): { user: string } | null`; `createSession(cookies, user: AdminUser, secure)` con payload `{ u, role, v, mfa: true, exp }`; `readSession(cookies): { user: string; role: Role } | null` che rifiuta utente assente, `v` diversa, `mfa` mancante; `checkPassword(user, pw): AdminUser | null`
  - `audit.ts`: `audit(event: string, data: Record<string, unknown>): void` (append in `data/private/audit.log` con `t` ISO), `pruneAudit(now = Date.now()): void` (toglie righe > 365 giorni)
  - `App.Locals.admin: { user: string; role: Role } | null`

- [ ] **Step 1: Test** `totp.test.ts`: vettori RFC 6238 SHA-1 (segreto ASCII `12345678901234567890`; T=59 → `287082`, T=1111111109 → `081804`, T=1234567890 → `005924`, ultime 6 cifre); `verifyTotp` accetta step −1/0/+1, rifiuta ±2, rifiuta lo stesso step una seconda volta (`lastStep` = step accettato), rifiuta codici non numerici; `base32Decode(base32Encode(x))` uguale a `x`.
- [ ] **Step 2: Test** `auth.test.ts` (con `SESSION_SECRET` di test e un utente scritto con `writeUsers`): sessione valida → letta; utente rimosso → `null`; dopo `bumpSessionVersion` → `null`; payload senza `mfa` (firmato a mano) → `null`; firma alterata → `null`; scaduta → `null`; `readPending` scaduto dopo 5 minuti (orologio finto) → `null`; `pruneAudit` toglie righe di 366 giorni e tiene quelle di 364.
- [ ] **Step 3:** `npx vitest run src/lib` → FAIL.
- [ ] **Step 4:** Implementa `totp.ts` (HMAC-SHA1 con `node:crypto`, troncamento dinamico RFC 4226), `audit.ts`, nuova `auth.ts` (rimuove l'uso di `ADMIN_USER`/`ADMIN_PASSWORD_HASH`; tiene `hashPassword`, `verifyPassword`, il limite tentativi).
- [ ] **Step 5:** Flusso: `POST /api/admin/login` → password giusta → `createPending` + redirect `/admin/login/codice?next=…`; `POST /api/admin/login-code` → `readPending` + `verifyTotp` → salva `lastTotpStep`, `createSession`, cancella il cookie temporaneo, `audit('login', …)`; fallimenti → `noteFailure` + `audit('login_fail', { user, ip, step: 'password' | 'code' })`. `codice.astro` usa lo stile di `login.astro` (campo `inputmode="numeric" autocomplete="one-time-code"`, 6 cifre). `middleware.ts`: percorsi aperti `/admin/login`, `/admin/login/codice`, `/api/admin/login`, `/api/admin/login-code`; `ctx.locals.admin = readSession(...)`; `pruneAudit` una volta all'avvio del modulo.
- [ ] **Step 6:** `scripts/create-admin.mjs -- <nome> <ruolo>`: ruolo obbligatorio (`proprietario`|`sviluppatore`); crea o ruota (nuova password, nuovo segreto TOTP, `sessionVersion+1`); se `users.json` non esiste e `.env` ha `ADMIN_USER`, migra quell'utente come `proprietario` tenendo l'hash della password e generando il segreto TOTP; toglie `ADMIN_USER`/`ADMIN_PASSWORD_HASH` da `.env`, tiene/crea `SESSION_SECRET`; scrive in `ADMIN-CREDENZIALI.txt` utente, password (se nuova), chiave TOTP in base32 e URI `otpauth://`. `scripts/remove-admin.mjs -- <nome>` rimuove l'utente (rifiuta se è l'ultimo `proprietario`).
  Nel menu admin, accanto a "Esci", **Esci da tutti i dispositivi**: `POST /api/admin/logout` con `all=1` chiama `bumpSessionVersion(user)` e `audit('logout_all', …)`.
- [ ] **Step 7:** `npx vitest run` → PASS; `npm run build` → senza errori.
- [ ] **Step 8:** Verifica manuale in dev (preview `lq-milano`): esegui `npm run admin:create -- prova sviluppatore` su una copia di prova dei dati (`LQ_DATA_DIR`), accesso con password + codice generato da `totpAt` in uno script di prova (nessuna password digitata per Filippo); codice sbagliato → messaggio; `/admin/prodotti` senza codice → login.
- [ ] **Step 9:** Commit `Accesso con verifica in due passaggi, sessioni revocabili e registro`.

### Task 3: Bozze invisibili al pubblico

**Files:**
- Modify: `src/lib/catalog.ts`, `src/pages/media/[...path].ts`, `scripts/export-static.mjs`, `src/pages/admin/prodotti/index.astro`, `src/pages/admin/prodotti/[slug].astro`, `src/lib/admin-ops.ts`
- Test: `src/lib/catalog.test.ts`

**Interfaces:**
- Produces:
  - `Product.draft?: { source: 'misura'; misuraId: string; createdBy: string; createdAt: string }`
  - `Product.origin?: { source: 'misura'; misuraId: string; publishedBy?: string; confirmed: { madeIn: boolean; composition: boolean } }`
  - `listAllProducts(): Product[]` (admin), `listProducts(): Product[]` (solo non bozze), `getProduct(slug)` (solo non bozze), `getAnyProduct(slug)` (admin), `isDraft(p: Product): boolean`, `findByMisuraId(id: string): Product | undefined`

- [ ] **Step 1: Test** `catalog.test.ts` (dati temporanei con un prodotto pubblicato e una bozza): `listProducts()` non contiene la bozza; `listAllProducts()` sì; `getProduct(bozza)` → `undefined`; `getAnyProduct(bozza)` → trovato; `findByMisuraId` trova la bozza.
- [ ] **Step 2:** `npx vitest run src/lib/catalog.test.ts` → FAIL.
- [ ] **Step 3:** Implementa in `catalog.ts`; nell'admin (`prodotti/index.astro`, `[slug].astro`, `admin-ops.ts`) sostituisci `listProducts`/`getProduct` con le versioni admin.
- [ ] **Step 4:** Media: per `uploads/products/<slug>/…` e `3d/<slug>/…`, se `getAnyProduct(slug)` è una bozza e `readSession(cookies)` è `null` → 404; per le bozze `Cache-Control: private, no-store`.
- [ ] **Step 5:** `export-static.mjs`: i prodotti da visitare escono da una lettura che salta i JSON con `draft`.
- [ ] **Step 6:** `admin-ops.ts` `saveProductFromForm`: copia `draft` e `origin` dal prodotto esistente nel nuovo oggetto.
- [ ] **Step 7:** Test aggiuntivi in `catalog.test.ts` per i punti 1–3 della Review Focus: richiesta media su foto di bozza senza cookie → 404 (chiama il `GET` dell'endpoint con un contesto finto); `saveProductFromForm` su una bozza conserva `draft`; la funzione di elenco usata da `export-static.mjs` (estratta come `publicProductIds(dataDir)` in `scripts/lib/public-ids.mjs`) esclude la bozza.
- [ ] **Step 8:** `npx vitest run` → PASS. Commit `Stato bozza nascosto da negozio, media e copia statica`.

### Task 4: Endpoint Misura → catalogo con condizioni di pubblicazione

**Files:**
- Create: `src/lib/misura-item.ts`, `src/pages/api/admin/misura/item.ts`, `src/pages/api/admin/products/publish.ts`
- Modify: `src/pages/admin/prodotti/index.astro` (etichetta "Bozza da Misura", pulsante Pubblica), `src/pages/admin/prodotti/[slug].astro` (caselle di conferma made in / composizione, elenco di ciò che manca)
- Test: `src/lib/misura-item.test.ts`

**Interfaces:**
- Consumes: Task 1–3; `processImage` da `scripts/lib/images.mjs`.
- Produces:
  - `type MisuraPayload = { action: 'draft' | 'publish'; misuraId: string; title: string; price: number; category: Category; size: string; composition: string; madeIn: string; condition: Condition | ''; description: string; measures: { label: string; cm: number }[]; confirmed: { madeIn: boolean; composition: boolean } }`
  - `parsePayload(json: unknown): MisuraPayload` (lancia `InputError` con il campo nel messaggio)
  - `publishBlockers(p: Product): string[]` (vuoto = pubblicabile; messaggi italiani: "Manca il nome", "Manca il prezzo", "Manca la categoria", "Aggiungi almeno una foto", "Scrivi una descrizione (almeno 20 caratteri)", "Conferma il made in", "Conferma la composizione")
  - `toProduct(payload, images, user, old?): Product`
  - `saveMisuraItem(form: FormData, user: string): Promise<{ slug: string; published: boolean }>`
  - HTTP: `POST /api/admin/misura/item` (multipart: `payload` JSON + `photos` 1–8) → `200 { ok, slug, published, url }` | `400 { ok:false, error, blockers? }` | `401` | `403`; `POST /api/admin/products/publish` (`slug`, `confirmMadeIn`, `confirmComposition`) → stesso formato.

- [ ] **Step 1: Test** `misura-item.test.ts`:
  - `parsePayload` rifiuta campo sconosciuto, titolo di 121 caratteri, 13 misure, misura 301 cm, prezzo 100 001, `action` diversa;
  - `toProduct`: `details.misure` = `["Petto: 50,5 cm", …, "Misure indicative, capo steso in piano"]`; made in confermato → riga `Indicazione in etichetta: Made in Italia` in `details.materiale`; made in non confermato → nessuna riga; `model3d.disabled === true`;
  - `publishBlockers`: ognuna delle 7 condizioni da sola produce il suo messaggio; prodotto completo → `[]`;
  - `saveMisuraItem` con `action:'publish'` e descrizione di 10 caratteri → `InputError` con `blockers`, nessun file creato in `data/products`;
  - due chiamate con lo stesso `misuraId` (anche in parallelo con `Promise.all`) → un solo prodotto (lock in memoria per `misuraId`);
  - bozza poi `publish` con lo stesso `misuraId` → stesso slug, `draft` rimosso, `origin.publishedBy` = utente;
  - foto non immagine → `InputError`; foto JPEG con EXIF GPS (fixture creata con `sharp().withMetadata({ exif: … })`) → il `.webp` salvato non ha EXIF.
- [ ] **Step 2:** `npx vitest run src/lib/misura-item.test.ts` → FAIL.
- [ ] **Step 3:** Implementa `misura-item.ts` (controllo dimensioni foto con `sharp(buf).metadata()` prima di `processImage`: > 15 MB o > 60 Mpx → `InputError`), le due API (in testa `if (!can(locals.admin,'misura')) return 403`), `audit('misura_item', { user, slug, action })` e `audit('publish', …)`.
- [ ] **Step 4:** Admin: badge e pulsante Pubblica (chiama `publish.ts`; se ci sono `blockers` li mostra); nella scheda prodotto le due caselle di conferma compaiono solo se il prodotto ha `origin`/`draft` e il campo è presente.
- [ ] **Step 5:** `npx vitest run` → PASS; `npm run build` → OK. Commit `Endpoint Misura, condizioni di pubblicazione e Pubblica nell'admin`.

### Task 5: Build di Misura servita dietro accesso, con intestazioni proprie

**Files:**
- Create: `scripts/build-misura.mjs`, `src/pages/admin/misura/[...path].ts`, `src/lib/misura-headers.ts`
- Modify: `package.json` (`"misura:build": "node scripts/build-misura.mjs"`, campo `"misura": { "commit": "<sha>" }`), `.gitignore` (+ `private/`), `src/pages/admin/index.astro` o il menu admin (pulsante **Misura un capo** se `can`)
- Test: `src/lib/misura-headers.test.ts`

**Interfaces:**
- Consumes: Task 1–2; build `lq` di Misura (Task 8: produce `dist-lq/` + `dist-lq/manifest.json` = elenco file).
- Produces: `misuraHeaders(): [string, string][]` (CSP e Permissions-Policy esatte dei Global Constraints); `GET /admin/misura/*`.

- [ ] **Step 1: Test** `misura-headers.test.ts`: CSP contiene `'wasm-unsafe-eval'`, `connect-src 'self'`, nessun `https:`; Permissions-Policy contiene `camera=(self)` e `gyroscope=(self)`, `microphone=()`.
- [ ] **Step 2:** FAIL → implementa `misura-headers.ts` → PASS.
- [ ] **Step 3:** `build-misura.mjs`: `MISURA_DIR` (default `../../misura-app`), verifica che `git -C MISURA_DIR rev-parse HEAD` sia uguale a `package.json.misura.commit` (altrimenti esce con errore chiaro), esegue `npm ci` e `npm run build:lq` lì, copia `dist-lq/` in `private/misura/`.
- [ ] **Step 4:** `[...path].ts`: middleware già protegge `/admin/*`; in più `can(locals.admin,'misura')` altrimenti 403; percorso vuoto → `index.html`; serve solo nomi presenti in `private/misura/manifest.json` (niente `..`); tipi MIME per `.html .js .css .woff2 .svg .png .gz`; HTML `no-store`, file con hash `private, max-age=31536000, immutable`; aggiunge `misuraHeaders()` alla risposta.
- [ ] **Step 5:** Verifica che le intestazioni di `server.mjs` non le coprano: `npm run build && npm start`, poi `curl -sI http://localhost:4321/admin/misura/` con un cookie di sessione di prova → `Permissions-Policy` con `camera=(self)`; `curl -sI http://localhost:4321/` → `camera=()`. Se `server.mjs` vince, in `server.mjs` salta `securityHeaders` per i percorsi che iniziano con `/admin/misura/` (la route li imposta da sé).
- [ ] **Step 6:** Test della route (contesto finto): senza sessione → redirect al login (dal middleware); con ruolo non autorizzato → 403; `../.env` → 404; file non in manifest → 404.
- [ ] **Step 7:** Commit `Misura servita da /admin/misura con permessi e intestazioni dedicate`.

## Repository Misura

> Prima del Task 6 deve essere committata la lettura etichetta già fatta (in attesa dell'OK di Filippo).

### Task 6: Descrizione suggerita

**Files:**
- Create: `src/lib/describe.ts`
- Test: `src/lib/describe.test.ts`

**Interfaces:**
- Produces: `type DescribeInput = { category: LqCategory; brand: string; size: string; composition: string; compositionConfirmed: boolean; condition: string; measures: { label: string; cm: number }[]; notes: string }`; `suggestDescription(input: DescribeInput, variant: number): string` (varianti cicliche, almeno 3 per categoria); `LQ_CATEGORIES` (stesse 6 stringhe di `CATEGORIES` in LQ) e `type LqCategory`.

- [ ] **Step 1: Test**: con i dati di esempio della specifica (Capispalla, Max Mara, IT 44, lana vergine confermata, Ottimo, petto 50,5 / lunghezza 71,5) il testo contiene "Max Mara", "IT 44", "lana vergine", "50,5 cm" e "Misure indicative"; composizione non confermata → non compare; brand vuoto → nessun "di" orfano né doppi spazi; il testo non contiene mai `made in`, `autentic`, `original`, `anni '`; `variant` 0, 1, 2 danno testi diversi e `variant` 3 = 0; note presenti → ultimo paragrafo uguale alle note.
- [ ] **Step 2:** `npx vitest run src/lib/describe.test.ts` → FAIL.
- [ ] **Step 3:** Implementa con modelli per categoria (array di funzioni) e misure formattate con `formatCm`.
- [ ] **Step 4:** PASS. Commit `Descrizione suggerita per la scheda negozio`.

### Task 7: Foto per il negozio

**Files:**
- Create: `src/lib/shopPhoto.ts`
- Test: `src/lib/shopPhoto.test.ts`

**Interfaces:**
- Consumes: `Mask` (`src/lib/segmentation.ts`), `Raster` (`src/lib/rectify.ts`), vista piana dell'Analysis.
- Produces: `cutoutRaster(view: Raster, mask: Mask, opts?: { marginFrac?: number; bg?: [number, number, number] }): Raster` (default margine 0,06 del lato lungo, fondo `[244, 242, 238]`), usato poi con `rasterToJpeg`.

- [ ] **Step 1: Test** con raster e maschera sintetici (rettangolo-capo + rettangolo-stecca fuori maschera): i pixel della stecca diventano fondo; i pixel del capo restano invariati; il risultato è ritagliato sul riquadro della maschera più il margine; maschera vuota → errore `Error('Contorno del capo non trovato')`.
- [ ] **Step 2:** FAIL → implementa (bordo della maschera ammorbidito su 2 px) → PASS.
- [ ] **Step 3:** Commit `Foto per il negozio ritagliata dal contorno del capo`.

### Task 8: Modalità LQ: build, invio con coda, Scheda negozio

**Files:**
- Modify: `vite.config.ts` (modalità `lq`: `base: '/admin/misura/'`, nessun `VitePWA`, `outDir: 'dist-lq'`, plugin che scrive `dist-lq/manifest.json`, `define` `import.meta.env.VITE_TARGET`), `package.json` (`"build:lq": "tsc -b && vite build --mode lq"`), `src/lib/types.ts` (`Item.labelRead?: { composition?: boolean; madeIn?: boolean }` = letto dall'OCR e non ancora confermato; `Item.lqCategory?: LqCategory`), `src/ui/Details.tsx` (salva `labelRead`; in modalità LQ chip delle categorie LQ con la proposta della specifica), `src/App.tsx` (in modalità LQ dopo Dettagli → `ShopSheet`)
- Create: `src/lib/lq.ts`, `src/ui/ShopSheet.tsx`
- Test: `src/lib/lq.test.ts`

**Interfaces:**
- Consumes: Task 4 (contratto HTTP e `MisuraPayload`), Task 6, Task 7.
- Produces:
  - `toPayload(item: Item, extra: { action: 'draft' | 'publish'; description: string; confirmed: { madeIn: boolean; composition: boolean } }): MisuraPayload`
  - `LQ_CONDITION: Record<string, string>`: 'Nuovo con etichetta' → 'Nuovo con cartellino', 'Ottime condizioni' → 'Ottimo', 'Buone condizioni' → 'Buono', 'Segni di usura' → 'Discreto'
  - `publishBlockers(p: MisuraPayload, photos: number): string[]` (stessi messaggi e stesse regole della versione LQ)
  - `submitItem(payload, photos: Blob[]): Promise<{ ok: true; url: string; published: boolean } | { ok: false; status: number; error: string; blockers?: string[] }>`
  - Coda: `enqueue(itemId)`, `pending(): Promise<string[]>`, `flushQueue(): Promise<void>` (su evento `online` e dopo il login); usa il catalogo IndexedDB esistente come deposito.

- [ ] **Step 1: Test** `lq.test.ts`: `toPayload` (misure incluse con `lengthCm`, categoria LQ, conferme, le 4 condizioni mappate con `LQ_CONDITION`, condizione vuota → `''`); `publishBlockers` stessi 7 casi del Task 4 con gli stessi messaggi; `submitItem` con `fetch` finto: 401 → `{ ok:false, status:401 }` e l'item resta in coda; rete assente (fetch che lancia) → resta in coda; 200 → tolto dalla coda; due `flushQueue` contemporanei inviano una volta sola.
- [ ] **Step 2:** FAIL → implementa `lq.ts` → PASS.
- [ ] **Step 3:** In modalità `lq` il plugin OCR emette i file sotto `ocr/<versione>/` dentro `dist-lq` e `VITE_OCR_BASE` diventa `/admin/misura/ocr/<versione>` (verifica: `grep` del percorso nel chunk OCR di `dist-lq`, e i file elencati in `manifest.json`).
- [ ] **Step 3b:** `ShopSheet.tsx`: anteprima; textarea descrizione con `suggestDescription` (pulsanti **Altra versione**, **Ripristina suggerimento**; dopo la prima modifica dell'utente `edited=true` e il suggerimento non sovrascrive più); foto: ritaglio (rimovibile) + fino a 7 da fotocamera/galleria tramite `decodePhoto` e `rasterToJpeg`, riordino con frecce; caselle "Ho controllato sull'etichetta" per made in e composizione quando `labelRead` li segna; **Salva bozza** e **Pubblica nel negozio** (disattivato con l'elenco di `publishBlockers`; conferma "Il capo sarà visibile subito nel negozio"; offline → propone la bozza in coda); esito con **Vedi nel negozio** / **Apri nell'admin** / **Misura il prossimo**; 401 → "Accedi di nuovo" che apre `/admin/login?next=/admin/misura/`.
- [ ] **Step 4:** Nella schermata di scatto, modalità LQ: riga "Fotografa solo il capo, mai persone"; prima della richiesta dei sensori la riga che spiega a cosa servono. "Esci" (in modalità LQ) cancella foto e capi locali con conferma se `pending()` non è vuota.
- [ ] **Step 5:** `npx vitest run`, `npx tsc -b`, `npm run build`, `npm run build:lq` → tutti puliti; `dist-lq/` senza `sw.js` e con `manifest.json`.
- [ ] **Step 6:** Commit `Modalità LQ: scheda negozio, invio con coda e build per l'admin`.

## Verifica finale (entrambi i repository)

### Task 9: Prova completa e revisione

- [ ] **Step 1:** In LQ aggiorna `package.json.misura.commit` all'ultimo commit di Misura, `npm run misura:build && npm run build && npm start` (preview `lq-milano-prod`).
- [ ] **Step 2:** Nel browser di anteprima: login con password + codice (generato da `totpAt` con il segreto dell'utente di prova, su dati di prova) → admin → **Misura un capo** → foto di prova → misure → etichetta → Scheda negozio → **Salva bozza** → la bozza non è in `/shop`, la sua foto risponde 404 da una scheda anonima → **Pubblica** dall'admin bloccato finché non si conferma il made in → pubblicata, visibile in `/shop`.
- [ ] **Step 3:** Stesso flusso con **Pubblica nel negozio** da Misura; poi elimina il cookie di sessione e riprova: il capo resta in coda, dopo il login viene inviato una sola volta.
- [ ] **Step 4:** Leggi il registro: login, misura_item, publish con l'utente giusto.
- [ ] **Step 5:** Revisione di sicurezza di entrambi i diff con un subagente (modello sonnet, risposta breve): autenticazione, TOTP, percorso `/admin/misura`, endpoint, media delle bozze.
- [ ] **Step 6:** Prova su iPhone vero (Filippo): `npm start` in rete locale con HTTPS, fotocamera, sensori, lettura etichetta, pubblicazione.
- [ ] **Step 7:** Mostra il risultato a Filippo; push dei due repository solo dopo il suo OK.
