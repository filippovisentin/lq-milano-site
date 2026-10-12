# Authors object-sculpt-spec.json for the Schneiders balmacaan from the measured
# silhouette (measure.mjs on ref-front.png; units: garment height = 1, y up,
# x = wearer's left, z = front). Re-run after editing; the spec is the source
# of truth, the generated factory is derived from it.
import copy, json, sys

PATH = 'object-sculpt-spec.json'
import os
# review state survives re-authoring: the spec is rebuilt from the skeleton,
# but reviews, evidence and pass progress belong to the pipeline, not to us
KEEP = ('reviewHistory', 'visualEvidence', 'sculptPipeline', 'buildPasses', 'pipelineState')
_prev = json.load(open(PATH, encoding='utf-8')) if os.path.exists(PATH) else {}
s = json.load(open('spec-skeleton.json', encoding='utf-8'))
base = copy.deepcopy(s['componentTree'][0])

def comp(id, name, level, role, primitive, topo, rationale, descriptor, parent, material,
         position=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1), importance=0.6, confidence=0.7,
         features=(), seams=(), attach=None, collider='box', details=()):
    c = copy.deepcopy(base)
    c.update({
        'id': id, 'name': name, 'level': level, 'role': role, 'importance': importance,
        'confidence': confidence, 'primitive': primitive, 'topologyClass': topo,
        'topologyRationale': rationale, 'parent': parent, 'attachment': attach,
        'material': material, 'materialLayers': [material], 'fidelityTier': 'form',
        'localFeatures': list(features), 'seams': list(seams), 'details': list(details),
        'evidenceRefs': ['full-object'],
    })
    c['geometryDescriptor'] = {
        **c['geometryDescriptor'], **descriptor,
        'topologyIntent': descriptor.get('topologyIntent', 'smooth lofted cloth shell'),
        'uvStrategy': 'generated procedural coordinates',
    }
    c['transform'] = {'position': list(position), 'rotation': list(rotation), 'scale': list(scale)}
    c['dimensions'] = {'width': scale[0], 'height': scale[1], 'depth': scale[2], 'units': 'garment-height', 'confidence': confidence}
    ap = c['actionProfile']
    ap['animationRole'] = 'root' if parent is None else ('secondary-motion' if role in ('sleeve',) else 'static-detail')
    ap['pivot']['localPosition'] = list(position)
    ap['collider']['type'] = collider
    ap['destruction']['fractureGroup'] = id
    ap['destruction']['debrisMaterial'] = material
    return c

def st(y, w, d, x=0.0, z=0.0):
    # tapered-sweep on a vertical spine: rx follows the frame normal (= depth, z),
    # rz follows the binormal (= width, x)
    return {'position': [x, y, z], 'rx': d, 'rz': w, 'twist': 0.0}

def sleeve_stations(side):
    sx = 1 if side == 'l' else -1
    pts = [  # raglan: top of the tube (centre + half-width) follows the shoulder
             # slope from the neck base (0.06, 0.43) to the shoulder point (0.19, 0.37)
        (0.070, 0.405, 0.000, 0.022, 0.022),
        (0.115, 0.355, 0.000, 0.052, 0.050),
        (0.160, 0.300, 0.002, 0.066, 0.056),
        (0.186, 0.220, 0.006, 0.060, 0.052),
        (0.204, 0.100, 0.012, 0.050, 0.045),
        (0.216, -0.040, 0.018, 0.043, 0.040),
        (0.224, -0.175, 0.022, 0.037, 0.035),
    ]
    return [{'position': [sx * x, y, z], 'rx': d, 'rz': w, 'twist': 0.0} for x, y, z, w, d in pts]

body_stations = [
    st(-0.455, 0.172, 0.112),
    st(-0.300, 0.171, 0.108),
    st(-0.100, 0.178, 0.110),
    st(0.100, 0.183, 0.114),
    st(0.300, 0.178, 0.108),
    st(0.380, 0.163, 0.096),
    st(0.410, 0.105, 0.075),
    st(0.428, 0.064, 0.056),
]

C = []
C.append(comp('root', 'Body shell (front + back panels)', 'macro', 'body', 'tapered-sweep', 'continuous-sculpt',
    'One smoothly varying draped volume from shoulder slope to A-line hem; lofted elliptical stations measured from the front mask.',
    {'taperedSweep': {'stations': body_stations, 'radialSegments': 48, 'capEnds': True}}, None, 'fabric-shell',
    importance=1.0, confidence=0.75, collider='capsule',
    features=[{'id': 'raglan-seams', 'type': 'seam-line', 'description': 'raglan seams neck->underarm, back view', 'evidenceRefs': ['back-view']},
              {'id': 'crinkle-relief', 'type': 'normal-relief', 'description': 'fine crease field on chest and back', 'evidenceRefs': ['full-object']}],
    seams=[{'id': 'side-seam', 'path': 'lateral, underarm to hem'}, {'id': 'centre-back-seam', 'path': 'nape to vent'}]))
for side in ('l', 'r'):
    sx = 1 if side == 'l' else -1
    C.append(comp(f'sleeve-{side}', f'Raglan sleeve ({"wearer left" if side == "l" else "wearer right"})', 'macro', 'sleeve', 'tapered-sweep', 'continuous-sculpt',
        'Tapered fabric tube hanging from the raglan shoulder, cuff narrower than upper arm.',
        {'taperedSweep': {'stations': sleeve_stations(side), 'radialSegments': 24, 'capEnds': True}}, 'root', 'fabric-shell',
        importance=0.85, confidence=0.7, collider='capsule',
        attach=None))
C.append(comp('collar-stand', 'Collar stand band', 'macro', 'collar', 'tapered-sweep', 'continuous-sculpt',
    'Short band wrapping the neck opening, open at centre front.',
    {'taperedSweep': {'stations': [
        {'position': [-0.040, 0.436, 0.052], 'rx': 0.006, 'rz': 0.007, 'twist': 0},
        {'position': [-0.064, 0.442, 0.010], 'rx': 0.006, 'rz': 0.013, 'twist': 0},
        {'position': [-0.050, 0.446, -0.040], 'rx': 0.006, 'rz': 0.016, 'twist': 0},
        {'position': [0.000, 0.448, -0.058], 'rx': 0.006, 'rz': 0.017, 'twist': 0},
        {'position': [0.050, 0.446, -0.040], 'rx': 0.006, 'rz': 0.016, 'twist': 0},
        {'position': [0.064, 0.442, 0.010], 'rx': 0.006, 'rz': 0.013, 'twist': 0},
        {'position': [0.040, 0.436, 0.052], 'rx': 0.006, 'rz': 0.007, 'twist': 0}],
        'radialSegments': 12, 'capEnds': True}}, 'root', 'fabric-shell', importance=0.7))
for side in ('l', 'r'):
    sx = 1 if side == 'l' else -1
    pts = [(0.079, 0.493), (0.146, 0.457), (0.064, 0.380), (0.018, 0.420)]
    pts = [[sx * x, y - 0.44] for x, y in pts]  # local to the pivot at collar height
    if side == 'r':
        pts = pts[::-1]  # keep counter-clockwise winding after mirroring
    C.append(comp(f'collar-leaf-{side}', f'Point collar leaf ({side})', 'meso', 'collar', 'extrude', 'conforming-shell',
        'Thin folded collar fall lying on the shoulder/chest, rounded point.',
        {'profile2D': {'points': pts, 'depth': 0.008}, 'topologyIntent': 'thin extruded profile'}, 'collar-stand', 'fabric-shell',
        position=(0, 0.44, 0.058), rotation=(-0.55, 0, 0), importance=0.8, confidence=0.75,
        features=([{'id': 'collar-buttonhole-bar', 'type': 'stitch-bar', 'description': 'bar buttonhole on the leaf', 'evidenceRefs': ['collar-closeup']}] if side == 'l' else [])
                 + [{'id': f'collar-topstitch-{side}', 'type': 'topstitch', 'description': 'topstitch 4mm from edge', 'evidenceRefs': ['collar-closeup']}]))
C.append(comp('placket', 'Fly-front placket', 'meso', 'closure', 'box', 'assembled-solid',
    'Flat concealed-button strip overlapping the left front panel, genuinely a thin rectangle.',
    {}, 'root', 'fabric-shell', position=(0.012, -0.02, 0.112), scale=(0.034, 0.84, 0.006), importance=0.75,
    features=[{'id': 'placket-topstitch', 'type': 'topstitch', 'description': 'two stitch rows along the placket edges', 'evidenceRefs': ['full-object']}]))
C.append(comp('top-button', 'Exposed top button', 'micro', 'fastener', 'cylinder', 'assembled-solid',
    'Small dark-brown disc button at the neck.', {}, 'placket', 'horn-button',
    position=(0.0, 0.405, 0.118), rotation=(1.5708, 0, 0), scale=(0.016, 0.006, 0.016), importance=0.7))
for side in ('l', 'r'):
    sx = 1 if side == 'l' else -1
    C.append(comp(f'welt-pocket-{side}', f'Slanted welt pocket ({side})', 'meso', 'pocket', 'box', 'surface-relief',
        'Raised welt lip of a slanted slit pocket, 30 deg from vertical, at hip height.',
        {}, 'root', 'fabric-shell', position=(sx * 0.105, -0.115, 0.108), rotation=(0, sx * 0.25, sx * 0.52),
        scale=(0.012, 0.12, 0.008), importance=0.65))
    C.append(comp(f'cuff-tab-{side}', f'Cuff tab ({side})', 'meso', 'trim', 'box', 'assembled-solid',
        'Strap across the cuff, buttoned.', {}, f'sleeve-{side}', 'fabric-shell',
        position=(sx * 0.236, -0.150, 0.040), rotation=(0, 0, 0), scale=(0.040, 0.014, 0.006), importance=0.5))
    C.append(comp(f'cuff-button-{side}', f'Cuff tab button ({side})', 'micro', 'fastener', 'cylinder', 'assembled-solid',
        'Small dark button on the cuff tab.', {}, f'cuff-tab-{side}', 'horn-button',
        position=(sx * 0.250, -0.150, 0.045), rotation=(1.5708, 0, 0), scale=(0.011, 0.005, 0.011), importance=0.45))
C.append(comp('back-vent', 'Centre back vent', 'meso', 'vent', 'box', 'surface-relief',
    'Overlap pleat on the lower back, hem up to ~35% height.', {}, 'root', 'fabric-shell',
    position=(0.0, -0.32, -0.112), scale=(0.014, 0.27, 0.006), importance=0.55))
C.append(comp('neck-interior', 'Neck opening interior', 'meso', 'interior', 'cylinder', 'assembled-solid',
    'Dark hollow of the neck seen inside the collar (garment on invisible mannequin).', {}, 'root', 'fabric-interior',
    position=(0, 0.436, 0.0), scale=(0.104, 0.012, 0.092), importance=0.5))
# topstitch rows as a repetition-backed micro group
C.append(comp('placket-stitch-rows', 'Placket topstitch rows', 'micro', 'stitching', 'tube', 'fiber-strand',
    'Thin thread line following the placket edge.',
    {'tubePath': {'points': [[-0.004, 0.40, 0.116], [-0.004, -0.44, 0.116]], 'radius': 0.0012, 'closed': False}},
    'placket', 'thread', importance=0.4,
    attach={'parentSocket': 'placket-edge', 'localStart': [-0.004, 0.40, 0.116], 'localEnd': [-0.004, -0.44, 0.116],
            'contactType': 'embed', 'embedDepth': 0.0008, 'gapTolerance': 0.001}))

s['componentTree'] = C
s['silhouette'] = {
    'boundingShape': 'tall A-line trapezoid, height 1.0, shoulder span 0.43, hem span 0.35, sleeves to 0.70 of height',
    'aspectRatios': [{'name': 'height/shoulder-span', 'value': 2.3}],
    'symmetry': 'bilateral about centre front',
    'dominantCurves': ['shoulder slope (raglan)', 'hem slight curve', 'collar points'],
    'negativeSpaces': ['gap between sleeve and body below 0.56 height'],
    'landmarks': [{'id': 'collar-point', 'y': 0.38}, {'id': 'cuff', 'y': -0.175}, {'id': 'hem', 'y': -0.455}],
}
s['viewEvidence'] = [
    {'id': 'full-object', 'view': 'front', 'imageRegion': {'x': 0, 'y': 0, 'width': 1, 'height': 1, 'units': 'normalized'}, 'observations': ['front silhouette measured row by row'], 'confidence': 0.85, 'image': 'ref-front.png'},
    {'id': 'back-view', 'view': 'back', 'imageRegion': {'x': 0, 'y': 0, 'width': 1, 'height': 1, 'units': 'normalized'}, 'observations': ['raglan seams', 'centre vent', 'cuff tab'], 'confidence': 0.8, 'image': 'ref-back.png'},
    {'id': 'collar-closeup', 'view': 'front-detail', 'imageRegion': {'x': 0, 'y': 0, 'width': 1, 'height': 1, 'units': 'normalized'}, 'observations': ['collar leaves, buttonhole bar, top button'], 'confidence': 0.85, 'image': 'ref-collar.png'},
]
s['coordinateFrame'] = {'front': '+Z (camera-facing in ref-front.png)', 'up': '+Y', 'left': '+X is the wearer\'s left', 'scaleReference': 'garment height = 1.0 (collar top to hem)'}
s['assumptions'] = ['Torso depth 0.22 of height (no side photo): typical mannequin chest depth.', 'Sleeve cross-section near round.']
s['risks'] = ['Side profile is inferred; review from 90 deg.', 'Projected photo stretches on flanks; blend front/back by facing.']
s['referenceCamera'].update({'solved': True, 'projection': 'orthographic', 'fovDegrees': 1.0, 'aspect': 0.6667,
    'positionHint': [0, 0, 10], 'note': 'Product flat shot: orthographic front projection, frame fitted to garment bbox.'})
s['scores'] = {'object_isolation': 0.95, 'silhouette_readability': 0.9, 'depth_inference': 0.55, 'primitive_decomposition': 0.8,
               'material_procedurality': 0.6, 'occlusion_risk': 0.35, 'interaction_fit': 0.8}
s['repetitionSystems'] = [
    {'id': 'buttons', 'description': 'dark horn buttons: top button + one per cuff tab', 'componentRefs': ['top-button', 'cuff-button-l', 'cuff-button-r'], 'count': 3, 'distribution': 'explicit', 'variation': 'none'},
    {'id': 'topstitch', 'description': 'topstitch rows along collar edges and placket', 'componentRefs': ['placket-stitch-rows', 'collar-leaf-l', 'collar-leaf-r'], 'count': 3, 'distribution': 'edge-follow', 'variation': 'none'},
]
s['featureReviewTargets'] = [
    {'id': 'overall-silhouette', 'name': 'A-line knee-length body with near-vertical sleeves', 'tier': 'critical', 'passIds': ['blockout'], 'minimumScore': 0.8, 'mustPass': True, 'componentRefs': ['root', 'sleeve-l', 'sleeve-r'], 'evidenceRefs': ['full-object']},
    {'id': 'shoulder-raglan', 'name': 'Sloped raglan shoulder line, no set-in shoulder seam', 'tier': 'critical', 'passIds': ['blockout', 'structural-pass'], 'minimumScore': 0.75, 'mustPass': True, 'componentRefs': ['root', 'sleeve-l', 'sleeve-r'], 'evidenceRefs': ['back-view']},
    {'id': 'point-collar', 'name': 'Point collar leaves with stand', 'tier': 'critical', 'passIds': ['structural-pass'], 'minimumScore': 0.75, 'mustPass': True, 'componentRefs': ['collar-stand', 'collar-leaf-l', 'collar-leaf-r'], 'evidenceRefs': ['collar-closeup']},
    {'id': 'front-closure', 'name': 'Fly-front placket with single exposed top button', 'tier': 'important', 'passIds': ['structural-pass'], 'minimumScore': 0.7, 'mustPass': False, 'componentRefs': ['placket', 'top-button'], 'evidenceRefs': ['collar-closeup']},
    {'id': 'fabric-surface', 'name': 'Stone-olive satin fabric with crinkle relief (projected photo)', 'tier': 'critical', 'passIds': ['material-pass'], 'minimumScore': 0.75, 'mustPass': True, 'componentRefs': ['root'], 'evidenceRefs': ['full-object']},
]
mats = {m['id']: m for m in s['materials']}
fab = copy.deepcopy(mats['base'])
fab.update({'id': 'fabric-shell', 'name': 'Gabardine shell (stone olive satin)', 'baseColor': '#a3a38e', 'color': '#a3a38e',
            'albedo': {'dominant': '#a3a38e', 'secondary': ['#8f8f7a', '#b4b39d'], 'samplingNotes': 'projected de-lit photo on front/back; palette for flanks'},
            'colorVariation': {'palette': ['#a3a38e', '#8f8f7a', '#b4b39d'], 'pattern': 'projected-photo', 'amplitude': 0.1, 'heightCorrelation': 0.2},
            'roughness': {'base': 0.68, 'variation': 0.1, 'map': 'independent-procedural-field', 'localResponse': 'slightly glossier on crinkle crests'},
            'sheen': {'color': '#d8d6c4', 'roughness': 0.5, 'intensity': 0.35},
            'localOverrides': [{'id': 'crinkle-relief', 'channel': 'normal', 'region': 'chest and upper back', 'description': 'fine crease field', 'strength': 0.3}]})
inner = copy.deepcopy(mats['base'])
inner.update({'id': 'fabric-interior', 'name': 'Shell fabric, interior in shadow', 'baseColor': '#3f3f35', 'color': '#3f3f35',
              'albedo': {'dominant': '#3f3f35', 'secondary': ['#2e2e27'], 'samplingNotes': 'neck opening'},
              'roughness': {'base': 0.85, 'variation': 0.05, 'map': 'independent-procedural-field', 'localResponse': 'flat'}, 'localOverrides': []})
btn = copy.deepcopy(mats['base'])
btn.update({'id': 'horn-button', 'name': 'Horn button', 'baseColor': '#3a2a20', 'color': '#3a2a20',
            'albedo': {'dominant': '#3a2a20', 'secondary': ['#4a3528'], 'samplingNotes': 'top button in collar close-up'},
            'roughness': {'base': 0.4, 'variation': 0.08, 'map': 'independent-procedural-field', 'localResponse': 'polished rim'}, 'localOverrides': []})
thr = copy.deepcopy(inner)
thr.update({'id': 'thread', 'name': 'Topstitch thread', 'baseColor': '#8d8c78', 'color': '#8d8c78',
            'albedo': {'dominant': '#8d8c78', 'secondary': [], 'samplingNotes': 'tone-on-tone stitching'}})
s['materials'] = [fab, inner, btn, thr]
for p in s['buildPasses']:
    if p['id'] == 'blockout':
        p['componentRefs'] = ['root', 'sleeve-l', 'sleeve-r', 'collar-stand']
json.dump(s, open(PATH, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print('components', len(C))

# ---- integer 0..3 scores and detail inventory links (validator contract)
s = json.load(open(PATH, encoding='utf-8'))
s['scores'] = {'object_isolation': 3, 'silhouette_readability': 3, 'depth_inference': 2, 'primitive_decomposition': 2,
               'material_procedurality': 2, 'occlusion_risk': 1, 'interaction_fit': 2}
s['preSpecAssessment']['complexity']['scores'] = {'silhouetteComplexity': 2, 'componentCount': 2, 'hierarchyDepth': 2, 'repetitionDensity': 1,
    'materialLayerCount': 1, 'localDetailDensity': 2, 'occlusionRisk': 1, 'actionReadinessNeed': 1}
links = {
    'collar-point-leaves': ('contour', 'collar-leaf-l'), 'collar-buttonhole-bar': ('stitch', 'collar-buttonhole-bar'),
    'collar-topstitch': ('stitch', 'collar-topstitch-l'), 'fly-placket': ('seam', 'placket'), 'top-button': ('fastener', 'top-button'),
    'welt-pocket-l': ('ridge', 'welt-pocket-l'), 'welt-pocket-r': ('ridge', 'welt-pocket-r'), 'raglan-seams': ('seam', 'raglan-seams'),
    'back-vent': ('seam', 'back-vent'), 'cuff-tabs': ('fastener', 'cuff-tab-l'), 'crinkle-relief': ('ridge', 'fabric-shell/crinkle-relief'),
    'neck-interior': ('hole', 'neck-interior'),
}
for d in s['preSpecAssessment']['detailInventory']['details']:
    kind, ref = links[d['id']]
    d.update({'kind': kind, 'affects': 'geometry' if kind not in ('ridge',) or 'fabric' not in ref else 'normal',
              'mapsTo': {'kind': 'material.localOverrides' if '/' in ref else 'component', 'ref': ref}, 'confidence': 0.75,
              'evidenceRef': 'full-object', 'region': {'x': 0, 'y': 0, 'width': 1, 'height': 1}})
json.dump(s, open(PATH, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)

# ---- colour recipes (extract_part_color_recipe.py on crops/), attachments, lighting
s = json.load(open(PATH, encoding='utf-8'))
rec = json.load(open('recipes.json', encoding='utf-8'))
by_mat = {'fabric-shell': 'fabric', 'thread': 'fabric', 'horn-button': 'button', 'fabric-interior': 'interior'}
def socket(pid, start, end, contact='embed', depth=0.002):
    return {'parentSocket': pid, 'localStart': start, 'localEnd': end, 'contactType': contact, 'embedDepth': depth, 'gapTolerance': 0.002}
for c in s['componentTree']:
    r = dict(rec[by_mat[c['material']]]); r['componentId'] = c['id']
    c['colorMaterialRecipe'] = r
    p = c['transform']['position']
    if c['primitive'] == 'cylinder':
        c['attachment'] = socket(c['parent'] + '-surface', [p[0], p[1], p[2] - 0.003], [p[0], p[1], p[2] + 0.003])
s['lightingFromPhoto'] = [
    {'id': 'key', 'type': 'directional', 'direction': [0.25, 0.85, 0.45], 'intensity': 2.4, 'color': '#fff6e8', 'evidence': 'soft top-front studio light: brighter shoulders, darker hem'},
    {'id': 'fill', 'type': 'hemisphere', 'skyColor': '#fffaf0', 'groundColor': '#b8a890', 'intensity': 0.9, 'evidence': 'white sweep bounce'},
    {'id': 'rim', 'type': 'directional', 'direction': [-0.6, 0.3, -0.7], 'intensity': 1.1, 'color': '#ffd9b0', 'evidence': 'site viewer neon rim accent'},
    {'id': 'environment', 'type': 'environment', 'preset': 'RoomEnvironment', 'intensity': 0.6, 'evidence': 'neutral studio reflections for satin sheen'},
]
json.dump(s, open(PATH, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)

# ---- reference PBR (extract_pbr_evidence.py), resolved unknowns, lighting intent
s = json.load(open(PATH, encoding='utf-8'))
pbr = json.load(open('pbr.json', encoding='utf-8'))
for m in s['materials']:
    m['referencePbr'] = pbr[m['id']]
pa = s['preSpecAssessment']
s['assumptions'] += [f'RESOLVED: {u}' for u in pa['unknownsToResolveBeforeImplementation']]
pa['unknownsToResolveBeforeImplementation'] = []
s['lightingFromPhoto'].append({'id': 'exposure', 'type': 'tone-mapping', 'toneMapping': 'ACESFilmic', 'exposure': 1.05,
    'notes': 'ACES filmic tone mapping, exposure 1.05; contact shadow: soft ground shadow ellipse under the hem plus ambient occlusion in creases'})
json.dump(s, open(PATH, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)

s = json.load(open(PATH, encoding='utf-8'))
for k in KEEP:
    if k in _prev:
        s[k] = _prev[k]
json.dump(s, open(PATH, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
