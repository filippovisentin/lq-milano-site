# LQ Milano — sito

Astro 7, statico. Contenuti originali (testi, 23 prodotti, 3 eventi, foto master Wix).

## Comandi
- `npm run dev` → http://localhost:4321 (genera prima il 3D)
- `npm run build` → `dist/` (deploy su Cloudflare Pages: build `npm run build`, output `dist`)
- `npm run 3d -- --force` → rigenera tutti i modelli 3D

## Aggiungere prodotti / eventi
- Pannello: `/admin` (Sveltia CMS). In locale con Chrome/Edge: "Lavora con repository locale" → cartella `site/`. Online: impostare `repo` in `public/admin/config.yml`.
- Oppure a mano: un file `.md` in `src/content/products/` o `src/content/events/`.
- Foto prodotto: 1ª = fronte, 2ª = retro, su sfondo chiaro uniforme → la vista 3D si crea da sola.

## Vista 3D
`scripts/build-3d.mjs` ritaglia fronte/retro dallo sfondo e ricava una mappa di profondità dalla sagoma; `src/scripts/garment-viewer.ts` (three.js, caricato solo quando serve) la ruota. Override per prodotto: `model3d.front/back/disabled`.

## E-commerce
Modalità **demo** dichiarata: carrello reale in locale, checkout di anteprima senza pagamento. Per andare live implementare un provider in `src/lib/commerce/provider.ts` (Wix Headless, Stripe o Shopify) e impostare `PUBLIC_COMMERCE_PROVIDER`. Form contatti: `PUBLIC_CONTACT_ENDPOINT` (vedi `.env.example`).

## Da verificare con la proprietaria
CAP 20125/20127, email reale, orari, policy (resi, privacy, spedizioni), account clienti.
