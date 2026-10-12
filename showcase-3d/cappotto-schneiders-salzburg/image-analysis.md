# Image analysis — Cappotto Schneiders Salzburg

References: ref-front.png (front, flat on invisible mannequin, white bg), ref-back.png (back),
ref-collar.png (collar/placket close-up), ref-detail.png (label/lining detail).

## L1 Identification
- Work type: single-breasted balmacaan raincoat (car coat), knee length, raglan sleeves.
- Classification: garment / outerwear, soft-goods. primaryDomain = object (no body, the
  garment is shown on an invisible mannequin: hollow neck opening). Confidence 0.92.

## L2 Form & silhouette
- Bounding volume: tall trapezoidal prism, height ≈ 1.5 × shoulder width; hem width ≈ 1.05 ×
  shoulder width (slight A-line). Bilateral symmetry about the centre front (placket axis).
- Shape language: organic soft-shell (cloth draped on an implied torso), not geometric.
- Primitives: torso = lofted elliptical cross-sections (deep at chest, shallower at hem);
  sleeves = tapered tubes (cuff Ø ≈ 0.55 × upper-arm Ø) hanging almost vertical, slight
  forward bend; collar = two folded extruded profiles (point collar) wrapping a neck cylinder.

## L3 Decomposition
- Macro: body shell (front L/R panels + back panel), sleeve L, sleeve R, collar.
- Meso: fly-front placket (concealed buttons, one visible top button), slanted welt
  pocket L/R (≈ 30° from vertical, at hip height), back centre vent (lower ~35% of back),
  raglan seams (neck → underarm, visible on back), cuff tab with button on each sleeve.
- Micro: topstitch rows along collar edge and placket, collar buttonhole bar, button(s)
  (dark brown, ~1.5% of height), fabric crinkle (fine crease field on upper chest/back).

## L4 Spatial relationships
- <collar, attached-to, neckline> butt seam; collar stands ~3% height, falls over shoulders.
- <placket, overlaps, left front panel> overlap, flush; buttons embedded under placket.
- <sleeve, attached-to, body> via raglan seam running from neck to underarm (overlap seam).
- <welt pocket, embedded-in, front panel> slit with raised lip.
- <vent, embedded-in, back panel> overlap pleat from hem up to ~35% height.
- <cuff tab, attached-to, sleeve hem> overlap, button on tab.

## L5 Materials (PBR)
- Shell fabric: cotton/poly gabardine-like woven, dielectric (metalness 0), roughness ≈ 0.7
  (satin sheen visible on back highlights → roughness 0.6–0.7, mild sheen), opaque.
  Normal relief: fine crinkle/crease, twill grain too fine to model (normal map optional).
- Buttons: horn/plastic, dark brown, roughness 0.4, dielectric.
- Interior (neck opening): same fabric seen inside, darker (ambient occlusion).

## L6 Color & finish
- Shell albedo: greyish olive / stone khaki, mid-light value, low saturation
  (≈ sRGB #a4a48f front, back slightly darker/greener #8f8f7a under the studio light).
- Finish: satin (soft sheen), no pattern.
- Buttons: dark brown, low value.

## L7 Identity features
- Point collar with rounded tips and bar buttonhole on the wearer's left collar leaf.
- Concealed fly-front with single exposed top button.
- Slanted welt pockets (two).
- Raglan sleeve seams (back view) — defines the shoulder silhouette (no shoulder seam).
- Back centre vent; cuff tabs with button.
- Long, loose A-line knee-length body.

## L8 Uncertainty
- Side depth of torso is hidden (front/back views only): inferred from a typical
  mannequin chest depth ≈ 0.55 × shoulder width (inference).
- Inside of neck opening: inferred (dark interior).
- Exact pocket depth / vent overlap: not visible, cosmetic only.
- Lighting baked into photos (soft top light) → de-light before using as albedo.
