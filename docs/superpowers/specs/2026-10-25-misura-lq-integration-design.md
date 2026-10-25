# Misura dentro l'admin di LQ Milano — design

Data: 2026-10-25 · Autore: Filippo Visentin (con Claude) · Stato: approvato in chat, da rivedere per iscritto

## Obiettivo
Usare Misura (PWA che misura i capi da una foto con una stecca da 50 cm e legge l'etichetta sul
dispositivo, repository privato `filippovisentin/misura-app`) direttamente dall'admin del sito
LQ Milano. Un capo misurato diventa una **bozza di prodotto LQ** con foto, misure, taglia,
composizione e provenienza; una persona la completa e la pubblica dall'admin.

**Chi:** solo utenti con ruolo **proprietario** o **sviluppatore**. Nessun altro accede all'admin
per ora. I due ruoli hanno gli stessi permessi; il ruolo serve a sapere chi è chi e a poter
differenziare in futuro.

**Successo:** dal capo steso alla bozza su LQ in circa 1 minuto, senza export/import manuali;
nessuna pagina o API pubblica mostra una bozza; nessuna affermazione su origine, composizione o
brand viene pubblicata senza conferma di una persona.

## Decisioni prese
- **Strada A**: Misura resta un prodotto a sé nel suo repository; una build dedicata viene servita
  dal server LQ sotto `/admin/misura/`, dietro accesso e ruolo. Scartate: copiare Misura dentro LQ
  (due copie da mantenere) e lasciarla separata con import da file (due accessi, passaggio manuale,
  Misura non protetta dai ruoli).
- **Verifica in due passaggi obbligatoria** (codice TOTP a 6 cifre) per entrambi i ruoli.
- **Solo bozze**: Misura non pubblica mai. Pubblica solo una persona dall'admin.

## 1. Utenti, ruoli, verifica in due passaggi
- La coppia `ADMIN_USER` / `ADMIN_PASSWORD_HASH` in `.env` diventa una lista di utenti in un file
  privato fuori da git (`data/private/users.json`, scritto in modo atomico come gli altri dati):
  `{ user, role: 'proprietario' | 'sviluppatore', passwordHash (scrypt), totpSecret, lastTotpStep, sessionVersion, createdAt }`.
- `npm run admin:create -- <nome> <ruolo>` crea o ruota un utente: genera password robusta e segreto
  TOTP, scrive le credenziali (con il QR/URI per l'app di autenticazione) in `ADMIN-CREDENZIALI.txt`
  (git-ignored), come oggi. `npm run admin:remove -- <nome>` toglie un utente.
  Migrazione: al primo avvio, se esiste solo il vecchio `ADMIN_USER`, lo script lo converte in un
  utente `proprietario` e chiede di configurare il TOTP; finché non è configurato quell'utente non
  entra.
- Accesso in due passi: password → codice TOTP (finestra ±1 periodo; un codice già usato viene
  rifiutato grazie a `lastTotpStep`). Tra i due passi c'è solo un cookie temporaneo di 5 minuti che
  non apre nessuna pagina admin.
  Il limite di tentativi attuale (8 per IP ogni 15 minuti) vale per entrambi i passi; ogni fallimento
  finisce nel registro (sezione 4).
- La sessione firmata contiene `{ u, role, v: sessionVersion, mfa: true, exp }`. Il middleware, a ogni
  richiesta, rilegge l'utente dal file (con cache breve invalidata alla modifica del file) e rifiuta
  se l'utente non esiste più, se `v` non coincide (ruolo cambiato, utente rimosso, "esci da tutti i
  dispositivi") o se `mfa` manca.
- Permesso unico per ora: `can(user, 'misura')` è vero per entrambi i ruoli. Le pagine e le API di
  Misura chiamano sempre `can`, così un ruolo futuro senza Misura non richiede di toccare quel codice.

## 2. Misura servita in modo protetto
- **Build LQ di Misura** (nel repository di Misura, `npm run build:lq`):
  - `base: '/admin/misura/'`;
  - niente service worker né precache: chi usa l'admin è online e dopo l'uscita sul telefono non deve
    restare una copia dell'app;
  - adattatore `CatalogRepo` "LQ" che salva verso l'endpoint della sezione 3 (il catalogo locale resta
    come coda delle bozze non ancora inviate);
  - file OCR (Tesseract.js, modelli eng+ita) inclusi nella build, nessuna risorsa esterna.
- **Nel sito LQ** uno script (`npm run misura:build`) costruisce Misura a una versione fissata (tag o
  commit indicato in `package.json`) e ne copia il risultato in `private/misura/`, **fuori** dalla
  cartella pubblica e dalla build statica.
- **Percorso protetto** `/admin/misura/[...path]` nel server LQ: verifica accesso, `mfa` e
  `can(user,'misura')`, poi consegna il file richiesto da `private/misura/` (solo nomi presenti
  nell'elenco della build, nessun `..`), con `Cache-Control: no-store` per l'HTML e cache privata
  per i file con hash.
- **Intestazioni solo su `/admin/misura/*`**:
  - `Permissions-Policy: camera=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)`
    e tutto il resto negato come oggi;
  - CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self';
    img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; font-src 'self';
    base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  Il resto del sito mantiene le intestazioni di `security-headers.mjs` invariate (fotocamera e sensori
  bloccati).
- Prima della richiesta del browser per fotocamera e sensori, Misura mostra una riga che spiega a cosa
  servono; nella schermata di scatto un avviso ricorda di fotografare solo il capo, mai persone.
- "Esci" in Misura cancella dal telefono foto e bozze. Se ci sono bozze non ancora inviate chiede
  prima conferma ("Hai N bozze non inviate: eliminarle?"); se l'utente annulla, non esce.
  La sessione scaduta invece non cancella nulla (vedi sezione 7).
- Nell'admin compare il pulsante **Misura un capo**, visibile solo se `can(user,'misura')`.

## 3. Dal capo misurato alla bozza LQ
- **Endpoint** `POST /api/admin/misura/draft` (multipart): una foto JPEG + un JSON. Protetto dal
  middleware admin (sessione, `mfa`, origine, ruolo).
- **Controlli sul server**:
  - foto: massimo 15 MB e 60 Mpx, decodificata e ricodificata con `sharp` (verifica che sia
    un'immagine, toglie EXIF/GPS), stesse larghezze di `IMAGE_WIDTHS`;
  - JSON validato con uno schema rigido, campi sconosciuti rifiutati. Limiti: titolo 120, taglia 20,
    composizione 200, made in 40, note 2000, al massimo 12 misure (etichetta 40 caratteri, valore
    0–300 cm), prezzo 0–100 000;
  - `misuraId` (uuid del capo in Misura) obbligatorio: un secondo invio con lo stesso id aggiorna la
    stessa bozza invece di crearne un'altra.
- **Corrispondenza dei campi**:

  | Misura | Prodotto LQ |
  |---|---|
  | name | `title` |
  | price | `price` |
  | sizeLabel | `size` |
  | misure incluse | `details.misure` ("Petto: 50,5 cm") + riga fissa "Misure indicative, capo steso in piano" |
  | composition | `details.materiale` |
  | madeIn | `details.materiale` riga "Indicazione in etichetta: Made in …" (solo se confermata) |
  | condition | `details.stato` (voci LQ) |
  | notes | `description` |
  | categoria | `category` (scelta tra le categorie LQ, vedi sotto) |

- **Categoria**: in modalità LQ Misura mostra le categorie del sito con una proposta: Giacca →
  Capispalla; Pantalone e Gonna → Pantaloni e gonne; Vestito → Altro; Top → scelta obbligatoria tra
  Camicie e Maglieria e polo.
- **Foto**: la foto raddrizzata di Misura diventa la prima immagine; il 3D non viene generato per le
  bozze (`model3d.disabled = true`).
- **Stato bozza**: nuovo campo `draft?: { source: 'misura', misuraId, createdBy, createdAt,
  confirmed: { madeIn: boolean, composition: boolean, brand: boolean } }` sul prodotto.
  - `listProducts()` (usata dalle pagine pubbliche, dalle API pubbliche, dalla sitemap e da
    `scripts/export-static.mjs`) **esclude le bozze per impostazione predefinita**; l'admin usa una
    nuova `listAllProducts()`. Così un nuovo punto pubblico non può mostrarle per errore.
  - `getProduct(slug)` pubblico restituisce `undefined` per una bozza (404).
  - Nell'elenco admin la bozza ha l'etichetta "Bozza da Misura" e il pulsante **Pubblica**.
- **Conferme prima di pubblicare**: i campi letti dall'etichetta arrivano con lo stato di conferma
  (in Misura: il segno "da etichetta" tolto = confermato a mano o accettato esplicitamente). Pubblica
  è bloccato finché provenienza e composizione presenti non sono confermate; il pannello admin mostra
  cosa manca e permette di confermare. Il brand non viene mai scritto come "autentico"; resta solo
  dove lo mette una persona.

## 4. Registro delle operazioni
- File append-only `data/private/audit.log` (JSON per riga): accessi riusciti e falliti (utente, IP,
  passo), creazione/aggiornamento bozza, conferme, pubblicazione, cancellazione, gestione utenti.
- Conservazione 12 mesi: le righe più vecchie vengono rimosse all'avvio del server.
- Non contiene foto né password; gli IP servono solo alla sicurezza.

## 5. Aspetti legali
- **Made in**: un'indicazione di origine falsa o fallace può essere un illecito anche penale. Si
  pubblica solo confermata e sempre come "Indicazione in etichetta: Made in …", mai come garanzia del
  negozio.
- **Composizione**: nomi delle fibre nella forma italiana del regolamento UE sulle fibre tessili (già
  così nel parser di Misura); pubblicazione solo dopo conferma.
- **Brand / autenticità**: mai dichiarata in automatico.
- **Misure**: sempre accompagnate da "Misure indicative, capo steso in piano".
- **Privacy**: la lettura etichetta avviene sul telefono; al server arriva solo ciò che si salva, foto
  ripulita. Dati degli utenti admin (nome, ruolo, accessi, registro) minimi, indicati in una breve
  informativa interna per proprietari e sviluppatore.
- Da far rileggere a un consulente prima del lancio: dicitura del made in e nota sulle misure.

## 6. Esperienza d'uso
1. Admin → **Misura un capo**.
2. Scatto con la stecca → conferma estremi.
3. Misure (correzioni se servono).
4. Dettagli con **Fotografa l'etichetta**, categoria LQ.
5. **Salva come bozza su LQ** → "Bozza creata" con **Apri nell'admin** / **Misura il prossimo**.

## 7. Errori
- **Sessione scaduta o revocata**: risposta 401; Misura tiene la bozza in coda, mostra "Accedi di
  nuovo" (apre il login con ritorno a `/admin/misura/`) e reinvia dopo l'accesso.
- **Rete assente**: la bozza resta in coda sul telefono, invio automatico quando torna la rete;
  avviso con il numero di bozze in attesa.
- **Dati rifiutati (400)**: messaggio in italiano con il campo preciso; la bozza resta modificabile.
- **Doppio invio**: gestito da `misuraId` (aggiorna, non duplica).
- **Errore del server (500)**: messaggio generico, nessun dettaglio interno; la bozza resta in coda.

## 8. Test
- **LQ (vitest)**:
  - permessi: senza sessione, sessione senza `mfa`, utente rimosso, `sessionVersion` cambiata, ruolo
    senza `can('misura')` (con un ruolo finto nei test), origine diversa;
  - TOTP: codice giusto, sbagliato, scaduto, riusato;
  - endpoint bozza: schema rigido, limiti, campi sconosciuti, foto non immagine, EXIF/GPS assente dopo
    la ricodifica, idempotenza con lo stesso `misuraId`;
  - bozze invisibili: `listProducts`, `getProduct`, sitemap, API pubbliche, export statico;
  - Pubblica bloccata senza conferme;
  - percorso `/admin/misura/*`: nessun file senza accesso, niente `..`, intestazioni corrette solo lì.
- **Misura (vitest)**: conversione capo → payload LQ (categorie, misure, conferme), coda di invio.
- **Prove finali**: flusso completo nel browser contro la build di produzione con le intestazioni
  reali; prova su iPhone vero (fotocamera, sensori, lettura etichetta); revisione di sicurezza del
  codice da un subagente.

## 9. Ordine di lavoro
1. Utenti, ruoli, TOTP, sessione con versione, registro (LQ).
2. Stato bozza, `listProducts`/`listAllProducts`, endpoint, conferme e Pubblica (LQ).
3. Build LQ di Misura con adattatore e coda (Misura).
4. Script di build in LQ, percorso protetto e intestazioni dedicate (LQ).
5. Test, prove finali, revisione di sicurezza.

## Fuori da questa versione
- Ruoli diversi da proprietario e sviluppatore (il codice usa già `can()` per accoglierli).
- Più foto per capo da Misura, generazione 3D dalle bozze.
- Collegamento con Wix per il checkout (già deciso a parte).
