# LQ Milano — sito + pannello

Astro 7 su Node (`@astrojs/node`). Le pagine di contenuto sono statiche; shop, prodotti, eventi, home e pannello leggono il catalogo vivo in `data/`, quindi ogni modifica dal pannello è subito online, senza rebuild.

## Avvio
```bash
npm install
npm run admin:create        # crea utente admin -> .env + ADMIN-CREDENZIALI.txt (non in git)
npm run dev                 # sviluppo: http://localhost:4321
npm run build && npm start  # produzione (PORT, HOST)
```

## Pannello amministratore — `/admin`
- **Prodotti**: foto (trascina o scegli, anche da telefono), riordino, scelta *Fronte 3D* / *Retro 3D*, prezzo, taglia, categoria, stato, epoca, misure, materiale, disponibilità, in evidenza, posizione. Al salvataggio la **vista 3D si genera da sola**; anteprima rotante nel pannello, slider *Sensibilità sfondo* e *Rigenera 3D*.
- **Eventi**: titolo, date (ora di Milano), locandina, iscrizioni aperte/chiuse/esaurite + link.
- Sicurezza: password scrypt, cookie firmato HttpOnly/SameSite=Strict (12 h), blocco dopo 8 tentativi, controllo Origin sulle modifiche.
- Cambiare password: `npm run admin:create -- <utente> <nuova-password>` e riavviare.

## Vista 3D
`scripts/lib/garment3d.mjs`: sfondo stimato dai bordi e rimosso; **una sola sagoma** condivisa da fronte e retro (il retro viene adattato riga per riga); profondità dalla sagoma. `src/scripts/garment-viewer.ts` costruisce **un solido chiuso** (guscio frontale + posteriore + parete laterale cucita lungo il contorno): niente spazi vuoti tra i due lati. Rigenerare tutto dopo modifiche all'algoritmo: `npm run 3d:all`.

Foto ideali: capo intero, centrato, sfondo chiaro e uniforme, fronte e retro con la stessa inquadratura.

## Dati
- `data/products/*.json`, `data/events/*.json` — catalogo
- `data/uploads/` — foto (master 2400 px + 480/960/1600 WebP)
- `data/3d/` — modelli 3D generati
In produzione `data/` deve stare su un **disco persistente** (o `LQ_DATA_DIR`) e va incluso nei backup.

Dietro un proxy HTTPS (Render, Railway, nginx...) imposta **al momento della build** `LQ_ALLOWED_DOMAINS=www.lqmilano.it,lqmilano.it`, altrimenti l'admin rifiuta ogni salvataggio (403) e i cookie non sono `Secure`. Usalo solo se il proxy riscrive `X-Forwarded-For`. In alternativa per i soli cookie: `LQ_COOKIE_SECURE=1`. `.env` e `ADMIN-CREDENZIALI.txt` vengono creati leggibili solo dal proprietario.

## Hosting
Serve un hosting Node con disco persistente (es. Render, Railway, Fly.io, un VPS). Cloudflare Pages da solo non basta più: il pannello riceve upload e genera il 3D sul server.

### Anteprima su GitHub Pages (solo vetrina)
Con il repository **pubblico**: Settings → Pages → Source: *GitHub Actions*, poi Actions → *Pubblica su GitHub Pages* → Run workflow. Il sito va su `https://<utente>.github.io/<repo>/` e si aggiorna a ogni push. È una fotografia statica (`scripts/export-static.mjs`): niente pannello admin, il catalogo è quello in `data/` al momento della pubblicazione. Finché il repository è privato il workflow viene saltato.

## E-commerce
Modalità **demo** dichiarata (carrello reale, checkout di anteprima senza pagamento). Per andare live: implementare un provider in `src/lib/commerce/provider.ts` (Wix Headless, Stripe o Shopify).

## Schermata di caricamento
Con `PUBLIC_GOOGLE_MAPS_KEY` usa Street View di via Venini come sfondo; senza chiave usa la foto della vetrina.

## Privacy, cookie e sicurezza
- **Consenso cookie** (`src/components/CookieBanner.astro`, `src/lib/consent.ts`): solo strumenti tecnici propri; Google Maps e Street View si caricano solo dopo il consenso (mappe con segnaposto "Mostra la mappa"). Rifiuta con lo stesso peso di Accetta, X = rifiuto, scelta valida 6 mesi, link "Preferenze cookie" nel footer.
- **Pagine legali**: `/privacy`, `/cookie`, `/condizioni-di-vendita` (recesso 14 giorni, garanzia 12 mesi sull'usato, modulo di recesso). Dati in `src/data/site.json` → `legal`.
- **Età**: conferma "almeno 18 anni" + condizioni obbligatoria in checkout e registrazione; avviso privacy nel modulo contatti.
- **Intestazioni HTTP** (`security-headers.mjs`, applicate da `server.mjs` a ogni risposta): CSP che ammette solo il sito e Google Maps, HSTS e upgrade a HTTPS (solo su HTTPS), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy che nega fotocamera, microfono, posizione, sensori.
- Se si aggiunge un servizio esterno (es. endpoint del modulo contatti, Wix Headless), va aggiunto alla CSP e alla cookie policy.

## Da verificare con la proprietaria
CAP 20125/20127, email reale, orari, policy (resi, privacy, spedizioni).
