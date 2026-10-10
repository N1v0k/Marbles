#!/usr/bin/env python3
"""Build src/data/parts.json (part catalogue of the 16 mm track) directly from the STL exports.

Source: the STL files configured in tools/config.json (stl_dir, <part><stl_suffix>.stl) - the STL is the source of truth.
Measured per part (tools/stl16.py): bounding box, horizontal sockets (ports), vertical sockets (bottom/top), volume and
surface area. The release 3MF (release_3mf) provides plate, print orientation (rotation about z) and per-object settings
of each part; names_en provides the English names. Released (palette) = contained in the release 3MF; everything else
is an extra. Filament and print time come from a least-squares fit on the sliced plates of that file
(tools/plate_stats.json).

Conventions:
- Every end is a socket (7.00 wide, z 2.0..9.4, 10.6 deep). Port point = socket mouth on the end face, z 5.7 above the
  base; for level changers +32 / +64 (level height 32).
- Rim code in the part name x 8/15 = rim height in mm (40/50/60 = 21.333/26.667/32.0).
- Direction of travel (lane) from the geometry: higher port > cross lane (-y -> +y) > curve (port with y normal -> port
  with -x) > straight (-x -> +x).
- Vertical: one socket per part in the middle (open at the bottom), adapters at the bottom AND top; one pin per joint.

Usage: python tools/build_catalog.py   (then tools/convert_meshes.py, tools/convert_print_meshes.py, render_thumbs)
"""
import json, math, os, re, sys, zipfile
import xml.etree.ElementTree as ET
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT = os.path.join(ROOT, 'src', 'data')
CFG = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
STL_DIR = os.path.normpath(os.path.join(ROOT, CFG['stl_dir']))
SUFFIX = CFG['stl_suffix']                     # e.g. '_f3': <id>_f3.stl, id e.g. Gerade120_40-40_16mm
REL_3MF = os.path.normpath(os.path.join(ROOT, CFG['release_3mf']))
NAMES_EN = os.path.normpath(os.path.join(ROOT, CFG['names_en']))
J_DIR = os.path.normpath(os.path.join(ROOT, CFG['japandi_dir'])) if CFG.get('japandi_dir') else None
J_SUFFIX = CFG.get('japandi_suffix', '_j1')
# Lift: STL straight from lift_dir. The modules are catalogue parts (family liftPart); the chain uses the assembled lift
# (family lift, one entry per height and head direction, generated below).
LIFT_DIR = os.path.normpath(os.path.join(ROOT, CFG['lift_dir'])) if CFG.get('lift_dir') else None
LIFT_PARTS = CFG.get('lift_parts', {})
# Flip-flop: STL straight from flipflop_dir. Modules (family flipflopPart: body, rocker, axle pin) plus two chain parts
# Kippwippe_120-60_<Links|Rechts>_16mm (generated below). flipflop_display: rocker mounted, for the 3D view only.
FF_DIR = os.path.normpath(os.path.join(ROOT, CFG['flipflop_dir'])) if CFG.get('flipflop_dir') else None
FF_PARTS = CFG.get('flipflop_parts', {})
FF_DISPLAY = CFG.get('flipflop_display', {})
# Height adapters (flip-flop, spiral, X crossing, Y merge, short straights): family adapter like the other adapters;
# STL from height_adapter_parts (plain) / height_adapter_parts_j (Japandi).
HA_PARTS = CFG.get('height_adapter_parts', {})
# Cross tunnel 32 (the other cross tunnel exports are excluded, see EXCLUDE); family attraction (name AdapterTunnelQuer...), STL from
# cross_tunnel_parts (plain) / cross_tunnel_parts_j (Japandi).
CT_PARTS = CFG.get('cross_tunnel_parts', {})
# Y merge 120: two inlets (y +-16) and one outlet (x 64, y 0); family attraction, STL from ymerge_parts (plain) /
# ymerge_parts_j (Japandi). In the chain it is one part with two lanes sharing the outlet (lanes, merge): the track enters
# through one inlet, another strand flows into the other one.
YM_PARTS = CFG.get('ymerge_parts', {})
def lift_path(fn, suf=''):
    """lift_parts entry: file name in lift_dir or (if it contains '/') a path relative to the builder folder."""
    return os.path.normpath(os.path.join(ROOT, fn + suf + '.stl')) if '/' in fn else os.path.join(LIFT_DIR, fn + suf + '.stl')
sys.path.insert(0, HERE)
try:
    import trimesh  # noqa: F401  (area/volume, socket facets)
except ImportError:
    sys.exit('ERROR: trimesh is missing (pip install trimesh) - without it there are no sockets, areas or weights.')
from stl16 import load_stl, mesh, hsockets, vsockets  # noqa: E402

SCALE = 8 / 15                 # rim code in the name x SCALE = rim height in mm
LEVEL = 32.0                   # level height (adapter height)
PORT_Z = 5.7                   # socket centre above the base
HANG_MAX = 48.0                # shorter parts hang between their neighbours

# Not in the catalogue: fit-test blocks (print profile only)
EXCLUDE = {'Passprobe_Klotz_oben_16mm', 'Passprobe_Klotz_unten_16mm', 'Passprobe_Klotz_waagrecht_16mm',
           # replaced by the cross tunnel 32 parts
           'AdapterTunnelQuer120_40-40_16mm', 'AdapterTunnelQuer120_40-40_V20_16mm', 'AdapterTunnelQuer95_40-40_16mm'}
# Straight adapters, longest first: match_adapter takes the first whose footprint fits into the part's footprint, so the
# same length wins (Gerade100 gets AdapterGerade100, not AdapterGerade95)
ADAPTERS_STRAIGHT = ['AdapterGerade120_16mm', 'AdapterGerade100_16mm', 'AdapterGerade95_16mm', 'AdapterGerade88_16mm',
                     'AdapterGerade80_16mm']
# Without vertical socket: Gerade60/SchieneGerade60 and the spacers have no bottom socket (too short), neither do their
# adapters. Matched by equal length; held like the part by its neighbours.
ADAPTERS_NO_VSOCK = ['AdapterGerade60_16mm', 'AdapterDistanz65_16mm', 'AdapterDistanz46_16mm', 'AdapterDistanz45_16mm']


def base(pid):
    return pid[:-5] if pid.endswith('_16mm') else pid


def parse_rims(name):
    m = re.search(r'_(\d+)-(\d+)(?:_|$)', name)
    if m: return int(m.group(1)), int(m.group(2))
    m = re.search(r'_(\d+)(?:_|$)', name.replace('_R90', ''))
    if m:
        r = int(m.group(1)); return r, r
    return None, None


def family(name):
    n = name
    if n.startswith('Kippwippe_120-60_') and n.endswith(('_Links', '_Rechts')): return 'attraction', 'channel'   # chain part
    if n.startswith('Kippwippe'): return 'flipflopPart', 'channel'                                                    # module / display mesh
    if n.startswith('Lift'): return 'liftPart', 'channel'
    if n.startswith('Raststift'): return 'pin', 'pin'
    if n.startswith('SchieneLooping') or n.startswith('SchieneVersatz'): return 'attraction', 'rail'
    if n.startswith('Looping') or n.startswith('GeradeVersatz'): return 'attraction', 'channel'
    if n.startswith('AdapterTunnelQuer'): return 'attraction', 'channel'
    if n.startswith('Adapter'): return 'adapter', 'adapter'
    if n.startswith('StartSchale'): return 'start', 'channel'
    if n.startswith('EndSchale'): return 'end', 'channel'
    if n.startswith('XKreuzung') or 'Huegel' in n: return 'attraction', 'channel'
    if n.startswith('YMerge'): return 'attraction', 'channel'
    if n.startswith('SchieneDistanz'): return 'spacer', 'rail'
    if n.startswith('SchieneBremse'): return 'brake', 'rail'
    if n.startswith('SchieneRutsche'): return 'levelChanger', 'rail'
    if n.startswith('SchieneLangeKurve'): return 'longCurve', 'rail'
    if n.startswith('SchieneKurve'): return 'curve', 'rail'
    if n.startswith('SchieneGerade'): return 'straight', 'rail'
    if n.startswith('TunnelGerade'): return 'straight', 'tunnel'
    if n.startswith('TunnelKurve'): return 'curve', 'tunnel'
    if n.startswith('LangeKurve'): return 'longCurve', 'channel'
    if n.startswith('Kurve'): return 'curve', 'channel'
    if n.startswith('Gerade'): return 'straight', 'channel'
    if n.startswith('Distanz'): return 'spacer', 'channel'
    if n.startswith(('Rutsche', 'Spirale', 'Trichter', 'Zickzack')): return 'levelChanger', 'channel'
    raise ValueError(name)


# ---------------------------------------------------------------- UI texts (physics limits, notes) as (German, English)
# WHY follows the "too fast / too slow / marginal" warning (reason + fix); NOTES appear in the detail panel and the
# palette tooltip. Plain language, no derivations or formulas.
WHY = {
    'rail': ('Offene Schienenkurve: Ist die Kugel zu schnell, fliegt sie aus der Kurve. Abhilfe: davor eine Schienenbremse '
             'oder weniger Gefälle. Die große Kurve (R48) verträgt mehr Tempo als die enge (R24).',
             'Open rail curve: if the ball is too fast, it flies out of the curve. Fix: a rail brake before it or less drop. '
             'The large curve (R48) takes more speed than the tight one (R24).'),
    'bank': ('Gebankte Schienenkurve: Kommt die Kugel zu schnell oder hüpfend an, springt sie heraus. Ruhig wird sie hinter '
             'der Bremse K607, langsamer mit weniger Gefälle davor.',
             'Banked rail curve: if the ball arrives too fast or hopping, it jumps out. The K607 brake before it calms the '
             'ball down, less drop before it slows it down.'),
    'r24': ('Enge Kurve (R24): Bei viel Tempo klettert die Kugel an der Wand hoch (laut), bei noch mehr springt sie heraus. '
            'Abhilfe: weniger Gefälle davor oder die große Kurve (R48).',
            'Tight curve (R24): at high speed the ball climbs up the wall (noisy), even faster it jumps out. Fix: less drop '
            'before it or the large curve (R48).'),
    'r48': ('Große Kurve (R48): Bei sehr viel Tempo springt die Kugel heraus. Abhilfe: weniger Gefälle davor.',
            'Large curve (R48): at very high speed the ball jumps out. Fix: less drop before it.'),
    'h6050': ('Hügel: Zu langsam kommt die Kugel nicht über die Kuppe, zu schnell hebt sie oben ab. Davor für mittleres Tempo sorgen.',
              'Hill: too slow and the ball does not get over the top, too fast and it lifts off at the top. Arrive at medium speed.'),
    'h6040': ('Hügel: Bei mittlerem Tempo läuft die Kugel sauber, schneller hüpft sie, noch schneller springt sie aus der Rinne. '
              'Passt gut hinter das Zickzack.',
              'Hill: at medium speed the ball runs cleanly, faster it hops, even faster it jumps out of the channel. '
              'Works well after the zigzag.'),
    'sr': ('Rutsche: Kommt die Kugel zu schnell an, hebt sie an der oberen Kante ab. Davor langsamer werden lassen.',
           'Slide: if the ball arrives too fast, it lifts off at the top edge. Slow it down before.'),
    'brake': ('Schienenbremse: Sie ist für mittleres Tempo gemacht. Sehr schnell angefahren bremst sie nicht mehr zuverlässig – '
              'davor weniger Gefälle einplanen.',
              'Rail brake: made for medium speed. Approached very fast it no longer brakes reliably – plan less drop before it.'),
    'k607': ('Bremse mit Auslauf: drei Buckel, danach ein flaches Stück – die Kugel kommt ruhig heraus. Deshalb gehört sie vor '
             'jede gebankte Kurve. Sehr schnell angefahren bremst sie nicht mehr zuverlässig.',
             'Brake with run-out: three humps, then a flat section – the ball comes out calmly. That is why it belongs before '
             'every banked curve. Approached very fast it no longer brakes reliably.'),
    'funnel': ('Trichter: Zu langsam kreist die Kugel nicht, zu schnell schießt sie über den Rand. Mit mittlerem Tempo ankommen.',
               'Funnel: too slow and the ball does not circle, too fast and it shoots over the rim. Arrive at medium speed.'),
    'zz': ('Zickzack: gedacht für langsames Anrollen. Das Tempo am Ausgang ist geschätzt.',
           'Zigzag: meant for a slow approach. The exit speed is an estimate.'),
    'loop': ('Looping: Die Kugel braucht sehr viel Schwung, sonst fällt sie oben herunter. Kein Teil im Baukasten bringt sie so '
             'schnell dorthin.',
             'Loop: the ball needs a lot of momentum, otherwise it falls off at the top. No part in the set gets it there that fast.'),
    'versatz': ('Offener S-Versatz: Bei zu viel Tempo springt die Kugel seitlich heraus.',
                'Open S-offset: at too much speed the ball jumps out sideways.'),
    'ymerge': ('Y-Merge: bis etwa 0,8 m/s ohne Verlust gerechnet; bis 1,2 m/s fliegen etwa 2 von 100 Kugeln dort heraus, wo die '
               'Rillen zusammenlaufen. Abhilfe: davor weniger Gefälle.',
               'Y merge: calculated without losses up to about 0.8 m/s; up to 1.2 m/s about 2 in 100 balls fly out where the '
               'grooves meet. Fix: less drop before it.'),
    'spiral': ('Spirale: Das Tempo am Ausgang ist nur geschätzt und kann deutlich niedriger sein. Direkt danach keinen Hügel einplanen.',
               'Spiral: the exit speed is only an estimate and can be much lower. Do not put a hill right after it.'),
}
NOTES = {
    'StartSchale_60': ('Hier startet die Kugel – mit einem kleinen Schubs. Steht auf dem AdapterStart eine Ebene höher.',
                       'The ball starts here – with a little push. Stands one level higher on the AdapterStart.'),
    'EndSchale_40': ('Auffangbecken am Ende der Bahn. Steht immer auf dem Boden (Ebene 0).',
                     'Catch basin at the end of the track. Always stands on the floor (level 0).'),
    # every straight and spacer has its own height adapter of the same length
    'Gerade88_60-40': ('Kurze Gerade (47 mm). Steht auf dem AdapterGerade88.',
                       'Short straight (47 mm). Stands on the AdapterStraight88.'),
    'Gerade100': ('Gerade 53 mm. Steht auf dem AdapterGerade100.',
                  'Straight 53 mm. Stands on the AdapterStraight100.'),
    'Gerade80': ('Gerade 43 mm. Steht auf dem AdapterGerade80.',
                 'Straight 43 mm. Stands on the AdapterStraight80.'),
    'Gerade60': ('Gerade 32 mm, so lang wie eine Ebene hoch ist. Steht auf dem AdapterGerade60 – ohne Stift von unten, sie hält an ihren Nachbarn.',
                 'Straight 32 mm, as long as one level is high. Stands on the AdapterStraight60 – no pin from below, it is held by its neighbours.'),
    'SchieneGerade100': ('Schienen-Gerade 53 mm. Steht auf dem AdapterGerade100.',
                         'Rail straight 53 mm. Stands on the AdapterStraight100.'),
    'SchieneGerade80': ('Schienen-Gerade 43 mm. Steht auf dem AdapterGerade80.',
                        'Rail straight 43 mm. Stands on the AdapterStraight80.'),
    'SchieneGerade60': ('Schienen-Gerade 32 mm. Steht auf dem AdapterGerade60 – ohne Stift von unten, sie hält an ihren Nachbarn.',
                        'Rail straight 32 mm. Stands on the AdapterStraight60 – no pin from below, it is held by its neighbours.'),
    'Distanz45-0_40-40': ('Distanzstück 24 mm, das kürzeste Teil. Bleibt im 8-mm-Raster: Mit einer Gerade60 füllt es genau 56 mm. Steht auf dem AdapterDistanz45 – ohne Stift von unten, es hält an seinen Nachbarn.',
                          'Spacer 24 mm, the shortest part. Stays on the 8 mm grid: with a Straight60 it fills exactly 56 mm. Stands on the AdapterSpacer45 – no pin from below, it is held by its neighbours.'),
    'Distanz46-0_40-40': ('Distanzstück 24,5 mm. Steht auf dem AdapterDistanz46 – ohne Stift von unten, es hält an seinen Nachbarn.',
                          'Spacer 24.5 mm. Stands on the AdapterSpacer46 – no pin from below, it is held by its neighbours.'),
    'Distanz65-0_40-40': ('Distanzstück 34,7 mm. Steht auf dem AdapterDistanz65 – ohne Stift von unten, es hält an seinen Nachbarn.',
                          'Spacer 34.7 mm. Stands on the AdapterSpacer65 – no pin from below, it is held by its neighbours.'),
    'SchieneDistanz95-0_40-40': ('Schienen-Distanzstück 50,7 mm, steht auf dem AdapterGerade95.',
                                 'Rail spacer 50.7 mm, stands on the AdapterStraight95.'),
    'Zickzack240_180-60': ('Fällt zwei Ebenen (64 mm) auf 128 mm Länge. Tempo am Ausgang etwa 580 mm/s (geschätzt).',
                           'Drops two levels (64 mm) over 128 mm. Exit speed about 580 mm/s (estimated).'),
    'Trichter_100-60': ('Die Kugel kreist nach unten. Steht auf dem AdapterTrichter. Einlauf mit 110 bis 986 mm/s, Ausgang etwa 453 mm/s.',
                        'The ball circles down. Stands on the AdapterFunnel. Entry at 110 to 986 mm/s, exit about 453 mm/s.'),
    'Spirale_100-60': ('Eine Windung. Steht auf dem Boden oder auf dem AdapterSpirale. Braucht beim Drucken Stützen.',
                       'One turn. Stands on the floor or on the AdapterSpiral. Needs supports to print.'),
    'XKreuzung_50-40': ('Zwei Bahnen kreuzen sich. Die Bahn nutzt eine Spur (Querspur von links oder rechts wählbar); ein anderer Strang fährt durch die freie Spur, wenn er genau in ihren Eingang steckt. Steht auf dem Boden oder auf dem AdapterXKreuzung.',
                        'Two tracks cross. The track uses one lane (cross lane from the left or right, selectable); another strand runs through the free lane when it plugs exactly into its entrance. Stands on the floor or on the AdapterCrossing.'),
    'YMerge120': ('Y-Merge: Zwei Bahnen laufen zu einer zusammen – das Gegenstück zur Kippwippe. Die Bahn kommt durch einen Eingang '
                  '(Richtung wählen), im anderen mündet ein anderer Strang, wenn er genau hineinsteckt (32 mm daneben, gleiche Richtung, '
                  'gleicher Rand). Im Y wird die Kugel langsamer (eben etwa 70 %). Steht auf dem AdapterYMerge120 (Grundriss des Y).',
                  'Y merge: two tracks join into one – the counterpart to the flip-flop. The track comes in through one inlet '
                  '(choose the direction); another strand flows into the other one when it plugs in exactly (32 mm beside it, same '
                  'direction, same rim). The ball slows down in the Y (flat: to about 70 %). Stands on the AdapterYMerge120 (footprint of the Y).'),
    'AdapterKippwippe_120-60': ('Höhenadapter der Kippwippe: Grundriss der Kippwippe, eine Ebene hoch.', 'Height adapter for the flip-flop: its footprint, one level high.'),
    'AdapterSpirale_100-60': ('Höhenadapter der Spirale: Säule und Steg unter Ein- und Auslauf, eine Ebene hoch.', 'Height adapter for the spiral: column and bar under inlet and outlet, one level high.'),
    'AdapterXKreuzung_50-40': ('Höhenadapter der X-Kreuzung: Kreuz 64 × 64, eine Ebene hoch.', 'Height adapter for the X crossing: cross 64 × 64, one level high.'),
    'AdapterYMerge120': ('Höhenadapter des Y-Merge: Grundriss des Y, eine Ebene hoch. Buchsen an beiden Eingängen und am Ausgang.',
                         'Height adapter for the Y merge: footprint of the Y, one level high. Sockets at both inlets and at the outlet.'),
    'AdapterGerade100': ('Höhenadapter für Gerade100 und SchieneGerade100 (53 mm), eine Ebene hoch.',
                         'Height adapter for Straight100 and RailStraight100 (53 mm), one level high.'),
    'AdapterGerade88': ('Höhenadapter für die Gerade88 (47 mm), eine Ebene hoch.', 'Height adapter for the Straight88 (47 mm), one level high.'),
    'AdapterGerade80': ('Höhenadapter für Gerade80 und SchieneGerade80 (43 mm), eine Ebene hoch.',
                        'Height adapter for Straight80 and RailStraight80 (43 mm), one level high.'),
    'AdapterGerade60': ('Höhenadapter für Gerade60 und SchieneGerade60 (32 mm), eine Ebene hoch. Ohne Buchse oben und unten (zu kurz) – er hält wie sein Teil an den Nachbartürmen.',
                        'Height adapter for Straight60 and RailStraight60 (32 mm), one level high. No socket on top or bottom (too short) – like its part it is held by the neighbouring towers.'),
    'AdapterDistanz65': ('Höhenadapter für die Distanz65 (35 mm), eine Ebene hoch. Ohne Buchse oben und unten – er hält an den Nachbartürmen.',
                         'Height adapter for the Spacer65 (35 mm), one level high. No socket on top or bottom – it is held by the neighbouring towers.'),
    'AdapterDistanz45': ('Höhenadapter für die Distanz45 (24 mm), eine Ebene hoch. Ohne Buchse oben und unten – er hält an den Nachbartürmen.',
                         'Height adapter for the Spacer45 (24 mm), one level high. No socket on top or bottom – it is held by the neighbouring towers.'),
    'AdapterDistanz46': ('Höhenadapter für die Distanz46 (25 mm), eine Ebene hoch. Ohne Buchse oben und unten – er hält an den Nachbartürmen.',
                         'Height adapter for the Spacer46 (25 mm), one level high. No socket on top or bottom – it is held by the neighbouring towers.'),
    'Gerade120_60-50_Huegel': ('Braucht Schwung, um über die Kuppe zu kommen. Oben hebt die Kugel ab etwa 473 mm/s ab.',
                               'Needs momentum to get over the top. At the top the ball lifts off from about 473 mm/s.'),
    'Gerade120_60-40_Huegel': ('Läuft sauber zwischen 248 und 657 mm/s. Passt gut hinter das Zickzack.',
                               'Runs cleanly between 248 and 657 mm/s. Works well after the zigzag.'),
    'SchieneRutsche120_100-60': ('Führt eine Ebene tiefer, ohne dass die Kugel fällt. Sie kommt schnell heraus – dahinter eine Schienenbremse einplanen.',
                                 'Takes the ball one level down without a fall. It comes out fast – plan a rail brake after it.'),
    'Rutsche120_100-60': ('Wie die SchieneRutsche, aber als Rinne. Die Kugel kommt schnell heraus.',
                          'Like the RailSlide, but as a channel. The ball comes out fast.'),
    'SchieneBremse120_40-40_K420': ('Mehrere Buckel bremsen die Kugel auf etwa 314 mm/s.', 'Several humps slow the ball down to about 314 mm/s.'),
    'SchieneBremse120_60-60_K420': ('Mehrere Buckel bremsen die Kugel auf etwa 314 mm/s.', 'Several humps slow the ball down to about 314 mm/s.'),
    'SchieneBremse120_40-40_S500': ('Bremst nur Kugeln, die schneller als etwa 365 mm/s sind.', 'Only slows balls that are faster than about 365 mm/s.'),
    'SchieneBremse120_40-40_S600': ('Leichte Bremse (ab etwa 438 mm/s), gut vor großen Schienenkurven (R48).',
                                    'Light brake (from about 438 mm/s), good before large rail curves (R48).'),
    'SchieneBremse120_60-60_K607': ('Bremse mit Auslauf: Die Kugel kommt ruhig heraus, ohne zu hüpfen. Gehört vor jede gebankte Kurve.',
                                    'Brake with run-out: the ball comes out calmly, without hopping. Belongs before every banked curve.'),
    'AdapterTunnelQuer120_40-40': ('Adapter mit einer Rinne quer hindurch: Die untere Bahn läuft durch, oben steht ein Teil darauf. Oben ohne Buchse – das Teil darüber hält nur an seinen Nachbarn.',
                                   'Adapter with a channel running across: the lower track runs through, a part stands on top. No socket on top – the part above is held only by its neighbours.'),
    'AdapterTunnelQuer120_40-40_V20': ('Wie AdapterTunnelQuer120, die Rinne quer ist um 10,7 mm versetzt.',
                                       'Like AdapterTunnelCross120, the cross channel is offset by 10.7 mm.'),
    'AdapterTunnelQuer95_40-40': ('Kürzerer Tunnel-Adapter (50,7 mm lang).', 'Shorter tunnel adapter (50.7 mm long).'),
    # cross tunnel 32: cross lane 32 mm = Gerade60, connections on the 8 mm grid
    'AdapterTunnelQuer120_40-40_Q32': ('Adapter mit einer Rinne quer hindurch: Die untere Bahn läuft durch, oben steht ein 120er-Teil darauf. Die Querspur ist 32 mm lang wie eine Gerade60 und liegt in der Mitte (32 mm ab Anfang) – so passt die untere Bahn meist ohne Ausgleichsstück. Oben ohne Buchse – das Teil darüber hält nur an seinen Nachbarn.',
                                       'Adapter with a channel running across: the lower track runs through, a 120 part stands on top. The cross track is 32 mm long like a Straight60 and sits in the middle (32 mm from the start) – so the lower track usually fits without a filler piece. No socket on top – the part above is held only by its neighbours.'),
    'AdapterTunnelQuer120_40-40_Q32_V16': ('Wie der Quertunnel 120, die Querspur liegt aber 16 mm ab dem Anfang (umgedreht 48 mm).',
                                           'Like the cross tunnel 120, but the cross track sits 16 mm from the start (turned round: 48 mm).'),
    'AdapterTunnelQuer95_40-40_Q32': ('Quertunnel unter einer Gerade100 (Adapter 50,7 mm lang). Die Querspur liegt 24 mm ab dem Anfang der Gerade100, umgedreht 24 mm vor ihrem Ende.',
                                      'Cross tunnel under a Straight100 (adapter 50.7 mm long). The cross track sits 24 mm from the start of the Straight100, turned round 24 mm before its end.'),
    'Raststift_16mm': ('Ein Stift für alle Verbindungen: je Fuge, je Turmstufe und je Kopplung zweier Türme einer. Der Builder zählt sie automatisch.',
                       'One pin for every connection: one per joint, per tower step and per coupling of two towers. The builder counts them automatically.'),
    'Looping240_40-40': ('Braucht sehr viel Schwung (mindestens etwa 970 mm/s), den kein Teil im Baukasten liefert. Steht nur auf dem Boden (Ebene 0).',
                         'Needs a lot of momentum (at least about 970 mm/s), which no part in the set delivers. Stands on the floor only (level 0).'),
}
for k in ('Looping240_40-40_v2', 'SchieneLooping240_40-40', 'SchieneLooping240_40-40_v2'): NOTES[k] = NOTES['Looping240_40-40']

# Limits per part in mm/s (ball centre): calculated guide values, not measured on a printed track.
# Brakes: threshold = speed from which the brake acts, cap = speed afterwards.
BRAKES = {'S600': (438, 409), 'S500': (365, 343), 'K420': (307, 314), 'K607': (443, 445)}


def physics_for(name, fam, system, rim_in, rim_out, radius, L):
    if fam in ('adapter', 'pin'):
        return {'k': 1.4, 'L': None, 'drop': 0, 'limits': {}}
    drop = round((rim_in - rim_out) * SCALE, 3) if (rim_in is not None and rim_out is not None) else 0
    ph = {'k': 1.544 if system == 'rail' else 1.4, 'L': L, 'drop': drop}
    if radius: ph['R'] = radius
    lim, why = {}, None
    if fam in ('curve', 'longCurve'):
        if system == 'rail':
            if 'Bank' in name:
                vmax = 354 if radius < 36 else 501; why = 'bank'
            else:
                vmax = 226 if radius < 36 else 319; why = 'rail'
            lim = {'vmax': vmax, 'vwarn': round(vmax * 0.85)}
        else:
            if radius < 36: lim = {'vmax': 949, 'vwarn': 657}; why = 'r24'
            else: lim = {'vmax': 1315, 'vwarn': 949}; why = 'r48'
    if name == 'Gerade120_60-50_Huegel':
        ph['crest'] = {'dh': 3.2, 'R': 14.77, 'vcrestMax': 473}
        lim = {'vmin': 212, 'vmax': 518}; why = 'h6050'
    if name == 'Gerade120_60-40_Huegel':
        ph['crest'] = {'dh': 2.67, 'R': 44.11, 'vcrestMax': 715}
        lim = {'vmin': 248, 'vwarn': 657, 'vmax': 913}; why = 'h6040'
    if name in ('SchieneRutsche120_100-60', 'Rutsche120_100-60'):
        lim = {'vwarn': 457}; why = 'sr'
    if fam == 'brake':
        key = name.split('_')[-1]
        ph['brake'] = {'threshold': BRAKES[key][0], 'cap': BRAKES[key][1]}
        lim = {'vwarn': 621}; why = 'brake'
        if key == 'K607': ph['brake']['runout'] = 16.0; why = 'k607'
    if name.startswith('Trichter'):
        ph['fixedExit'] = 453; lim = {'vmin': 110, 'vmax': 986}; why = 'funnel'
    if name.startswith('Zickzack'):
        ph['fixedExit'] = 580; ph['estimate'] = True; lim = {'vwarn': 548}; why = 'zz'
    if 'Looping' in name:
        lim = {'vmin': 971, 'vmax': 1037}; why = 'loop'
    if name == 'SchieneVersatz120_40-40':
        lim = {'vmax': 632}; why = 'versatz'
    if name.startswith('Spirale'):
        ph['R'] = 24.0; ph['fixedExit'] = 204; ph['estimate'] = True
        lim = {'vmax': 1095, 'vwarn': 730}; why = 'spiral'
    if name.startswith('StartSchale'):
        ph['v0'] = 0
    if name.startswith('YMerge'):
        # 3D simulation: on a flat Y the ball exits at ~70 % of the speed of an equally long straight; with a drop
        # (50-40, 60-50) this evens out -> loss at the junction as a factor on the inlet speed (inLoss)
        ph['inLoss'] = 0.7
        lim = {'vwarn': 800, 'vmax': 1200}; why = 'ymerge'
    if why: lim['why'], lim['whyEn'] = WHY[why]
    ph['limits'] = lim
    return ph


# ---------------------------------------------------------------- Geometry
ROT = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}   # (cos, sin)


def rot2(p, rot):
    c, s = ROT[rot]
    return (c * p[0] - s * p[1], s * p[0] + c * p[1])


def vsock_rot(s, rot, off=(0, 0)):
    """Rotate a vertical socket (about 0/0) and translate it: centre, width axis, ear side."""
    c = rot2(s['c'], rot)
    dax = (0, 1) if s['wax'] == 'x' else (1, 0)          # direction of the D axis (across the width axis)
    ear = rot2((dax[0] * s['ear'], dax[1] * s['ear']), rot)
    wax = 'x' if abs(ear[1]) > 0.5 else 'y'
    e = int(round(ear[1] if wax == 'x' else ear[0]))
    return {'c': (c[0] + off[0], c[1] + off[1]), 'wax': wax, 'ear': e}


def same_vsock(a, b, tol=0.3):
    return abs(a['c'][0] - b['c'][0]) < tol and abs(a['c'][1] - b['c'][1]) < tol and a['wax'] == b['wax'] and a['ear'] == b['ear']


def foot_of(bb):
    return [round(bb[0][0], 3) + 0.0, round(bb[0][1], 3) + 0.0, round(bb[1][0], 3) + 0.0, round(bb[1][1], 3) + 0.0]


def tfoot(foot, rot, off):
    pts = [rot2(p, rot) for p in ((foot[0], foot[1]), (foot[2], foot[1]), (foot[0], foot[3]), (foot[2], foot[3]))]
    xs = [p[0] + off[0] for p in pts]; ys = [p[1] + off[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def lane_order(fam, ports):
    """Sort ports as [inlet, outlet, others]; returns (ports, lane)."""
    if not ports: return ports, [None, None]
    if fam in ('adapter', 'liftPart', 'flipflopPart'): return ports, [None, None]
    if len(ports) == 1:
        return ports, ([None, 0] if fam == 'start' else [0, None])
    idx = list(range(len(ports)))
    zs = [p['p'][2] for p in ports]
    def n_is(p, nx, ny): return abs(p['n'][0] - nx) < 0.01 and abs(p['n'][1] - ny) < 0.01
    ent = ext = None
    if max(zs) - min(zs) > 1:
        ent = int(np.argmax(zs))
        # outlet = lowest port NOT on the inlet face: level changers have a second socket at level 0 there (coupling to
        # the tower below the feeding part, not a lane) - it stays an extra port
        other = [i for i in idx if i != ent and not n_is(ports[i], ports[ent]['n'][0], ports[ent]['n'][1])]
        ext = min(other or [i for i in idx if i != ent], key=lambda i: zs[i])
    else:
        my = [i for i in idx if n_is(ports[i], 0, -1)]; py = [i for i in idx if n_is(ports[i], 0, 1)]
        mx = [i for i in idx if n_is(ports[i], -1, 0)]; px = [i for i in idx if n_is(ports[i], 1, 0)]
        if my and py: ent, ext = my[0], py[0]
        elif (my or py) and mx: ent, ext = (my or py)[0], mx[0]
        elif mx and px: ent, ext = mx[0], px[0]
        else: raise ValueError('no lane detected: %s' % ports)
    order = [ent, ext] + [i for i in idx if i not in (ent, ext)]
    return [ports[i] for i in order], [0, 1]


# ---------------------------------------------------------------- Loading
files = sorted(f for f in os.listdir(STL_DIR) if f.lower().endswith(SUFFIX + '.stl'))
if not files: sys.exit('ERROR: no STL files in %s' % STL_DIR)
GEOM = {}
for f in files:
    pid = f[:-len(SUFFIX + '.stl')]
    tri = load_stl(os.path.join(STL_DIR, f)); m = mesh(tri)
    GEOM[pid] = {'bb': [[round(float(x), 3) + 0.0 for x in m.bounds[0]], [round(float(x), 3) + 0.0 for x in m.bounds[1]]],
                 'ports': hsockets(m), 'vsock': vsockets(m), 'volume': float(abs(m.volume)) / 1000.0, 'area': float(m.area) / 100.0,
                 'bodies': int(m.body_count), 'file': f}
    if GEOM[pid]['bodies'] != 1: print('WARNING: %s has %d bodies' % (pid, GEOM[pid]['bodies']))
SRC, SRC_J = {}, {}          # parts outside stl_dir: STL path relative to the builder folder
if LIFT_DIR:
    for pid, fn in LIFT_PARTS.items():
        path = lift_path(fn)
        m = mesh(load_stl(path))
        GEOM[pid] = {'bb': [[round(float(x), 3) + 0.0 for x in m.bounds[0]], [round(float(x), 3) + 0.0 for x in m.bounds[1]]],
                     'ports': hsockets(m), 'vsock': vsockets(m), 'volume': float(abs(m.volume)) / 1000.0, 'area': float(m.area) / 100.0,
                     'bodies': int(m.body_count), 'file': os.path.basename(path)}
        SRC[pid] = os.path.relpath(path, ROOT).replace(os.sep, '/')
    print('Lift: %d modules from %s' % (len(LIFT_PARTS), LIFT_DIR))
if FF_DIR:
    ff_paths = {pid: os.path.join(FF_DIR, fn + '.stl') for pid, fn in FF_PARTS.items()}
    ff_paths.update({pid: os.path.normpath(os.path.join(ROOT, rel)) for pid, rel in FF_DISPLAY.items()})
    for pid, path in ff_paths.items():
        m = mesh(load_stl(path))
        GEOM[pid] = {'bb': [[round(float(x), 3) + 0.0 for x in m.bounds[0]], [round(float(x), 3) + 0.0 for x in m.bounds[1]]],
                     'ports': hsockets(m), 'vsock': vsockets(m), 'volume': float(abs(m.volume)) / 1000.0, 'area': float(m.area) / 100.0,
                     'bodies': int(m.body_count), 'file': os.path.basename(path)}
        SRC[pid] = os.path.relpath(path, ROOT).replace(os.sep, '/')
    print('Flip-flop: %d modules + %d display meshes from %s' % (len(FF_PARTS), len(FF_DISPLAY), FF_DIR))
for pid, rel in list(HA_PARTS.items()) + list(CT_PARTS.items()) + list(YM_PARTS.items()):
    path = os.path.normpath(os.path.join(ROOT, rel))
    m = mesh(load_stl(path))
    GEOM[pid] = {'bb': [[round(float(x), 3) + 0.0 for x in m.bounds[0]], [round(float(x), 3) + 0.0 for x in m.bounds[1]]],
                 'ports': hsockets(m), 'vsock': vsockets(m), 'volume': float(abs(m.volume)) / 1000.0, 'area': float(m.area) / 100.0,
                 'bodies': int(m.body_count), 'file': os.path.basename(path)}
    SRC[pid] = os.path.relpath(path, ROOT).replace(os.sep, '/')
if HA_PARTS: print('Height adapters: %d from %s' % (len(HA_PARTS), sorted(set(os.path.dirname(v) for v in HA_PARTS.values()))))
if CT_PARTS: print('Cross tunnel 32: %d from %s' % (len(CT_PARTS), sorted(set(os.path.dirname(v) for v in CT_PARTS.values()))))
if YM_PARTS: print('Y merge: %d from %s' % (len(YM_PARTS), sorted(set(os.path.dirname(v) for v in YM_PARTS.values()))))

# Japandi edition: grooved = <id>_j1.stl exists and is not byte-identical to the plain file. Hull, sockets and plates stay
# the same; only volume/area (for filament and print time) are taken from it, plus a hull check.
JGEOM = {}
if J_DIR and os.path.isdir(J_DIR):
    for f in files:
        pid = f[:-len(SUFFIX + '.stl')]
        jf = os.path.join(J_DIR, pid + J_SUFFIX + '.stl')
        if not os.path.exists(jf): print('WARNING: Japandi file missing: %s' % jf); continue
        if open(jf, 'rb').read() == open(os.path.join(STL_DIR, f), 'rb').read(): continue
        mj = mesh(load_stl(jf))
        bbj = [[round(float(x), 3) + 0.0 for x in mj.bounds[0]], [round(float(x), 3) + 0.0 for x in mj.bounds[1]]]
        if max(abs(a - b) for u, v in zip(bbj, GEOM[pid]['bb']) for a, b in zip(u, v)) > 0.01:
            print('WARNING: Japandi hull differs: %s %s / %s' % (pid, bbj, GEOM[pid]['bb']))
        JGEOM[pid] = {'volume': float(abs(mj.volume)) / 1000.0, 'area': float(mj.area) / 100.0}
    for pid, fn in LIFT_PARTS.items():
        jf = lift_path(fn, J_SUFFIX)
        if not os.path.exists(jf): continue
        mj = mesh(load_stl(jf))
        JGEOM[pid] = {'volume': float(abs(mj.volume)) / 1000.0, 'area': float(mj.area) / 100.0}
        SRC_J[pid] = os.path.relpath(jf, ROOT).replace(os.sep, '/')
    for pid, rel in list(CFG.get('flipflop_parts_j', {}).items()) + list(CFG.get('height_adapter_parts_j', {}).items()) + list(CFG.get('cross_tunnel_parts_j', {}).items()) + list(CFG.get('ymerge_parts_j', {}).items()):
        jf = os.path.normpath(os.path.join(ROOT, rel))
        if pid not in SRC or not os.path.exists(jf): continue
        if open(jf, 'rb').read() == open(os.path.join(ROOT, SRC[pid]), 'rb').read(): continue
        mj = mesh(load_stl(jf))
        JGEOM[pid] = {'volume': float(abs(mj.volume)) / 1000.0, 'area': float(mj.area) / 100.0}
        SRC_J[pid] = os.path.relpath(jf, ROOT).replace(os.sep, '/')
    print('Japandi: %d grooved parts' % len(JGEOM))

# Profile 3MF: plate, print orientation, per-object settings (keyed by English name)
names_en = json.load(open(NAMES_EN, encoding='utf-8')) if os.path.exists(NAMES_EN) else {}
plate_of, rot_of, meta_of, plate_objs = {}, {}, {}, {}
if os.path.exists(REL_3MF):
    with zipfile.ZipFile(REL_3MF) as z:
        ms = ET.fromstring(z.read('Metadata/model_settings.config'))
        model = z.read('3D/3dmodel.model').decode('utf-8', 'replace')
    objs = {}
    for o in ms.findall('object'):
        md = {m.get('key'): m.get('value') for m in o.findall('metadata') if m.get('key')}
        objs[o.get('id')] = md['name']
        # per-object settings (e.g. curves: top_surface_pattern = concentric) - everything except name and extruder
        extra = {k: v for k, v in md.items() if k not in ('name', 'extruder')}
        if extra: meta_of[md['name']] = extra
    for pl in ms.findall('plate'):
        md = {m.get('key'): m.get('value') for m in pl.findall('metadata')}
        for mi in pl.findall('model_instance'):
            mm_ = {m.get('key'): m.get('value') for m in mi.findall('metadata')}
            nm = objs[mm_['object_id']]
            plate_of[nm] = {'no': int(md['plater_id']), 'name': md.get('plater_name', '')}
            plate_objs.setdefault(int(md['plater_id']), []).append(nm)
    build = model[model.find('<build'):]
    for oid, t in re.findall(r'<item objectid="(\d+)"[^>]*transform="([^"]+)"', build):
        a = [float(x) for x in t.split()]
        # 3MF: row vector p' = p . M -> rotation angle from (m00, m01)
        rot_of[objs[oid]] = int(round(math.degrees(math.atan2(a[1], a[0])))) % 360
else:
    print('WARNING: profile 3MF missing (%s) - no plates, print orientation or calibration' % REL_3MF)

# ---------------------------------------------------------------- Filament/print time calibration (fit on the profile plates)
CALIB = os.path.join(HERE, 'calib.json')
STATS = os.path.join(HERE, 'plate_stats.json')
en2id = {e: i for i, e in names_en.items()}
if plate_objs and os.path.exists(STATS):
    stats_all = json.load(open(STATS, encoding='utf-8'))
    stats, excluded = stats_all['plates'], stats_all.get('excluded', {})
    rows_g, rows_h, yg, yh, used = [], [], [], [], []
    for no, objs_ in sorted(plate_objs.items()):
        s = stats.get(str(no))
        ids = [en2id.get(n) for n in objs_]
        # excluded: plates whose layout changed since slicing
        if not s or str(no) in excluded or any(i is None or i not in GEOM for i in ids): continue
        A = sum(GEOM[i]['area'] for i in ids)
        Vn = sum(GEOM[i]['volume'] for i in ids if not base(i).startswith('Adapter'))
        Va = sum(GEOM[i]['volume'] for i in ids if base(i).startswith('Adapter'))
        n = len(ids)
        rows_g.append([A, Vn, Va, n]); yg.append(s['g'])
        rows_h.append([A, Vn, Va, n, 1.0]); yh.append(s['min'] / 60.0); used.append(no)
    cg = np.linalg.lstsq(np.array(rows_g), np.array(yg), rcond=None)[0]
    ch = np.linalg.lstsq(np.array(rows_h), np.array(yh), rcond=None)[0]
    pg = np.array(rows_g) @ cg; ph_ = np.array(rows_h) @ ch
    calib = {'g': [float(x) for x in cg], 'h': [float(x) for x in ch[:4]], 'plateH': float(ch[4]),
             'note': 'Least squares on %d sliced plates of the release profile (A1, 0.20 mm, 7.5 %% gyroid): '
                     'g = a*area[cm2] + b*volume[cm3] (adapters: c*volume) + d per part; h likewise plus setup time per plate' % len(used),
             'error': {'g_mean': round(float(np.mean(np.abs(pg - yg))), 2), 'h_mean': round(float(np.mean(np.abs(ph_ - yh))), 3)}}
    json.dump(calib, open(CALIB, 'w', encoding='utf-8'), indent=1)
    print('Calibration: %d plates, mean error %.1f g / %.2f h' % (len(used), calib['error']['g_mean'], calib['error']['h_mean']))
calib = json.load(open(CALIB, encoding='utf-8'))

# Japandi: grooves cost print time beyond the area formula (+30..40 % on grooved plates of the release profile).
# Correction h += k * (area j1 - area plain) [cm2], k by least squares on the Japandi plates (tools/plate_stats_j.json;
# plates whose parts changed since slicing are excluded). Grams fit without a correction.
STATS_J = os.path.join(HERE, 'plate_stats_j.json')
if plate_objs and JGEOM and os.path.exists(STATS_J):
    sj = json.load(open(STATS_J, encoding='utf-8'))
    xs, ys, used_j = [], [], []
    for no, objs_ in sorted(plate_objs.items()):
        s = sj['plates'].get(str(no))
        ids = [en2id.get(n) for n in objs_]
        if not s or str(no) in sj.get('excluded', {}) or any(i is None or i not in GEOM for i in ids): continue
        cg, ch = calib['g'], calib['h']
        h = calib['plateH']
        for i in ids:
            g = JGEOM.get(i, GEOM[i]); ad = base(i).startswith('Adapter')
            h += ch[0] * g['area'] + (ch[2] if ad else ch[1]) * g['volume'] + ch[3]
        dA = sum(JGEOM[i]['area'] - GEOM[i]['area'] for i in ids if i in JGEOM)
        xs.append(dA); ys.append(s['min'] / 60.0 - h); used_j.append(no)
    xs, ys = np.array(xs), np.array(ys)
    calib['jpH'] = float(xs @ ys / (xs @ xs)) if float(xs @ xs) > 0 else 0.0
    res = ys - calib['jpH'] * xs
    calib['jpNote'] = 'Japandi time correction per cm2 of grooved area, fitted on %d plates of the Japandi release profile, mean residual %.2f h' % (len(used_j), float(np.mean(np.abs(res))))
    json.dump(calib, open(CALIB, 'w', encoding='utf-8'), indent=1)
    print('Japandi time correction: %.4f h per cm2, %d plates, mean residual %.2f h' % (calib['jpH'], len(used_j), float(np.mean(np.abs(res)))))


def grams_hours(pid, g=None):
    jap = g is not None
    g = g or GEOM[pid]; ad = base(pid).startswith('Adapter')
    cg, ch = calib['g'], calib['h']
    gr = cg[0] * g['area'] + (cg[2] if ad else cg[1]) * g['volume'] + cg[3]
    hr = ch[0] * g['area'] + (ch[2] if ad else ch[1]) * g['volume'] + ch[3]
    if jap: hr += calib.get('jpH', 0.0) * (g['area'] - GEOM[pid]['area'])     # grooves cost time (Japandi correction)
    return round(max(gr, 0.1), 1), round(max(hr, 0.01), 3)


# ---------------------------------------------------------------- Catalogue
# Rolling distance in mm for parts whose ball path is not the straight inlet -> outlet distance (turns, crests, ramps)
LMAN = {'Spirale_100-60': 176.0, 'Trichter_100-60': 533.33, 'Zickzack240_180-60': 355.0, 'Rutsche_120-60': 72.0,
        'SchieneRutsche120_100-60': 69.33, 'Rutsche120_100-60': 69.33, 'Gerade120_60-50_Huegel': 66.67,
        'Gerade120_60-40_Huegel': 66.67, 'XKreuzung_50-40': 64.0}
# Y merge: branch of two circular arcs with equal turning angle th = 2 atan(16/64): length 64 / sin(th) * th
for _r in ('40-40', '50-40', '50-50', '60-50', '60-60'):
    _th = 2 * math.atan(16 / 64); LMAN['YMerge120_' + _r] = round(64 / math.sin(_th) * _th, 2)
parts = []
# natural sort order: Gerade60 < Gerade80 < Gerade88 < Gerade100 < Gerade120 instead of alphabetical (100 < 120 < 60)
natkey = lambda s: [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', s)]
for pid in sorted(GEOM, key=natkey):
    if pid in EXCLUDE: continue
    g = GEOM[pid]; name = base(pid)
    fam, system = family(name)
    rim_in, rim_out = parse_rims(name) if fam not in ('adapter', 'pin', 'liftPart', 'flipflopPart') else (None, None)
    ports, lane = lane_order(fam, [dict(q) for q in g['ports']])
    bb = g['bb']; foot = foot_of(bb)
    L = radius = center = None; turn = 0
    pi = ports[lane[0]] if lane[0] is not None else None
    po = ports[lane[1]] if lane[1] is not None else None
    if pi and po:
        din = [-pi['n'][0], -pi['n'][1]]; dout = po['n'][:2]
        cross = din[0] * dout[1] - din[1] * dout[0]; dot = din[0] * dout[0] + din[1] * dout[1]
        if abs(dot - 1) < 1e-6: turn = 0
        elif abs(dot + 1) < 1e-6: turn = 180
        else: turn = 90 if cross > 0 else -90      # +90 = left turn
        if turn in (90, -90):
            A = np.array([din, dout]); b = np.array([din[0] * pi['p'][0] + din[1] * pi['p'][1], dout[0] * po['p'][0] + dout[1] * po['p'][1]])
            M = np.linalg.solve(A, b)
            center = [round(float(M[0]), 3) + 0.0, round(float(M[1]), 3) + 0.0]
            radius = round(float(math.hypot(pi['p'][0] - M[0], pi['p'][1] - M[1])), 3)
            L = round(math.pi / 2 * radius, 2)
        else:
            L = round(math.hypot(po['p'][0] - pi['p'][0], po['p'][1] - pi['p'][1]), 2)
    if name in LMAN: L = LMAN[name]
    phys = physics_for(name, fam, system, rim_in, rim_out, radius, L)
    feed_rim = None
    if rim_in is not None and pi is not None:
        feed_rim = int(round(rim_in - (pi['p'][2] - PORT_Z) * 60 / LEVEL))
    gr, hr = grams_hours(pid)
    en = names_en.get(pid, pid)
    pl = plate_of.get(en)
    part = {
        'id': pid, 'file': pid, 'family': fam, 'system': system, 'mirrored': 'gespiegelt' in name,
        'rimIn': rim_in, 'rimOut': rim_out, 'feedRim': feed_rim,
        'bbox': bb, 'foot': foot, 'height': round(bb[1][2], 3),
        'volume': round(g['volume'], 2), 'area': round(g['area'], 1), 'grams': gr, 'hours': hr,
        'ports': ports, 'lane': lane,
        'reversible': bool(pi and po and fam not in ('adapter', 'start', 'end', 'pin', 'liftPart', 'flipflopPart')
                           and abs(pi['p'][2] - PORT_Z) < 0.01 and abs(po['p'][2] - PORT_Z) < 0.01),
        'vsock': {'bottom': g['vsock']['bottom'], 'top': g['vsock']['top']},
        'phys': phys, 'turn': turn, 'radius': radius, 'center': center, 'length': L,
        'adapter': None, 'note': NOTES.get(name, NOTES.get(name.split('_')[0], ('', '')))[0],
        'noteEn': NOTES.get(name, NOTES.get(name.split('_')[0], ('', '')))[1],
        'nameEn': en, 'plate': pl,
        # released: on a plate of the release 3MF other than the "Extras" plates
        'released': bool(pl) and not pl['name'].lstrip('0123456789 ').startswith('Extras'),
        'printRot': rot_of.get(en, 0), 'printMeta': meta_of.get(en, {}),
        # Japandi edition: only for grooved parts (null = identical to the plain part)
        'jp': None if pid not in JGEOM else dict(zip(('grams', 'hours'), grams_hours(pid, JGEOM[pid]))),
    }
    if pid in SRC: part['src'] = SRC[pid]
    if pid in SRC_J: part['srcJ'] = SRC_J[pid]
    parts.append(part)
by_id = {p['id']: p for p in parts}

# ---------------------------------------------------------------- Y merge
# Two inlets on the face x 0 (y +16 / -16, normal -x), one outlet at x 64 (normal +x). Ports [inlet +y, outlet,
# inlet -y]; lane 0 = through inlet +y (the outlet is then 16 mm to the right), lane 1 = through inlet -y. Both lanes
# share the outlet (merge): the chain uses one, another strand flows into the other (chain.ts laneDock).
for pid in YM_PARTS:
    p = by_id.get(pid)
    if not p: continue
    ps = [dict(q) for q in GEOM[pid]['ports']]
    inlets = sorted([q for q in ps if abs(q['n'][0] + 1) < 0.01], key=lambda q: -q['p'][1])
    outlets = [q for q in ps if abs(q['n'][0] - 1) < 0.01]
    if len(ps) != 3 or len(inlets) != 2 or len(outlets) != 1 or abs(inlets[0]['p'][1] - 16) > 0.05 or abs(inlets[1]['p'][1] + 16) > 0.05 \
            or abs(outlets[0]['p'][1]) > 0.05 or any(abs(q['p'][2] - PORT_Z) > 0.01 for q in ps):
        sys.exit('ERROR: Y merge sockets not as expected (%s): %s' % (pid, ps))
    p.update({'ports': [inlets[0], outlets[0], inlets[1]], 'lane': [0, 1], 'lanes': [[0, 1], [2, 1]], 'merge': True, 'reversible': False,
              'turn': 0, 'feedRim': p['rimIn']})
if YM_PARTS: print('Y merge: %d parts, ports [inlet +y, outlet, inlet -y], lanes [[0, 1], [2, 1]]' % sum(1 for i in YM_PARTS if i in by_id))

# ---------------------------------------------------------------- Adapter matching (vertical socket + footprint)
def match_adapter(p, cands):
    """Adapter and rotation such that its TOP socket (centre, width axis, ear side) sits on the part's bottom socket and
    its footprint stays within the part's footprint."""
    if not p['vsock']['bottom']: return None
    s = p['vsock']['bottom'][0]
    for aid in cands:
        A = by_id.get(aid)
        if not A or not A['vsock']['top']: continue
        t = A['vsock']['top'][0]
        for rot in (0, 90, 180, 270):
            tr = vsock_rot(t, rot)
            off = (s['c'][0] - tr['c'][0], s['c'][1] - tr['c'][1])
            if not same_vsock(vsock_rot(t, rot, off), s): continue
            fa = tfoot(A['foot'], rot, off); fp = p['foot']
            if fa[0] < fp[0] - 0.6 or fa[1] < fp[1] - 0.6 or fa[2] > fp[2] + 0.6 or fa[3] > fp[3] + 0.6: continue
            return {'type': aid, 'offset': [round(off[0], 3) + 0.0, round(off[1], 3) + 0.0], 'rot': rot}
    return None


for p in parts:
    name = base(p['id']); fam = p['family']
    if fam in ('adapter', 'pin', 'end', 'liftPart', 'flipflopPart'): continue
    if name.startswith('AdapterTunnelQuer'):
        # carrier without vertical sockets: stands on the straight adapter of the same length, located by the footprint
        Lp = p['foot'][2] - p['foot'][0]
        for aid in ADAPTERS_STRAIGHT:
            A = by_id[aid]
            if abs((A['foot'][2] - A['foot'][0]) - Lp) < 0.1: p['adapter'] = {'type': aid, 'offset': [0.0, 0.0], 'rot': 0}; break
        continue
    if not p['vsock']['bottom'] and fam in ('straight', 'spacer') and p['turn'] == 0:
        # no vertical socket: adapter of the same length (Gerade60, SchieneGerade60, Distanz65, Distanz46)
        Lp = p['foot'][2] - p['foot'][0]
        for aid in ADAPTERS_NO_VSOCK:
            A = by_id.get(aid)
            if A and abs((A['foot'][2] - A['foot'][0]) - Lp) < 0.1 and abs((A['foot'][3] - A['foot'][1]) - (p['foot'][3] - p['foot'][1])) < 0.1:
                p['adapter'] = {'type': aid, 'offset': [0.0, 0.0], 'rot': 0}; break
        if p['adapter'] is None: print('NOTE: no adapter (no vertical socket) for %s' % p['id'])
        continue
    if fam == 'start': cands = ['AdapterStart_16mm']
    elif name.startswith('YMerge'): cands = ['AdapterYMerge120_16mm']
    elif name.startswith('Trichter'): cands = ['AdapterTrichter_100-60_16mm']
    elif name.startswith('Spirale'): cands = ['AdapterSpirale_100-60_16mm']
    elif name.startswith('XKreuzung'): cands = ['AdapterXKreuzung_50-40_16mm']
    elif p['turn'] in (90, -90): cands = ['AdapterKurve90_16mm'] if p['radius'] < 36 else ['AdapterLangeKurve90_16mm']
    else: cands = ADAPTERS_STRAIGHT
    p['adapter'] = match_adapter(p, cands)
    if cands and p['adapter'] is None and (p['foot'][2] - p['foot'][0]) > HANG_MAX and 'Looping' not in name:
        print('NOTE: no adapter for %s (stands on level 0 only)' % p['id'])

# ---------------------------------------------------------------- Lift
# Filament and time of the modules: the lift prints with its own settings (housing 15 % grid, screws/crank 4 walls 30 %,
# concentric top), so the area formula (fitted on 7.5 % gyroid) does not apply. The formula values are scaled to the
# sliced plate 16 of the release 3MF (one of each module: foot, middle, head, 3 screws, crank).
LIFT_KIT = ['LiftFuss_40_16mm', 'LiftMitte_16mm', 'LiftKopf_60_16mm', 'LiftSchnecke_Fuss_16mm', 'LiftSchnecke_Mitte_16mm',
            'LiftSchnecke_Kopf_16mm', 'LiftKurbel_16mm']
lift_parts = [by_id[i] for i in LIFT_KIT if i in by_id]
if lift_parts and CFG.get('lift_slice'):
    def plate16(ed):
        fn = os.path.normpath(os.path.join(ROOT, CFG['lift_slice'] % ed))
        if not os.path.exists(fn): return None
        for pl in json.load(open(fn, encoding='utf-8'))['platten']:
            if 'Lift' in pl['name']: return pl['zeit_s'] / 3600.0 - calib['plateH'], pl['gramm']
        return None
    sl_plain, sl_jp = plate16('plain'), plate16('japandi')
    if sl_plain:
        fg = sl_plain[1] / sum(p['grams'] for p in lift_parts); fh = sl_plain[0] / sum(p['hours'] for p in lift_parts)
        for p in lift_parts: p['grams'] = round(p['grams'] * fg, 1); p['hours'] = round(p['hours'] * fh, 3)
        print('Lift: plate 16 plain %.1f g / %.2f h (without setup time), factor g %.2f, h %.2f' % (sl_plain[1], sl_plain[0], fg, fh))
    if sl_jp:
        grooved = [p for p in lift_parts if p['jp']]
        rest_g = sum(p['grams'] for p in lift_parts if not p['jp']); rest_h = sum(p['hours'] for p in lift_parts if not p['jp'])
        fg = (sl_jp[1] - rest_g) / sum(p['jp']['grams'] for p in grooved); fh = (sl_jp[0] - rest_h) / sum(p['jp']['hours'] for p in grooved)
        for p in grooved: p['jp'] = {'grams': round(p['jp']['grams'] * fg, 1), 'hours': round(p['jp']['hours'] * fh, 3)}
        print('Lift: plate 16 Japandi %.1f g / %.2f h, housing factor g %.2f, h %.2f' % (sl_jp[1], sl_jp[0], fg, fh))
    for p in lift_parts:
        p['note'], p['noteEn'] = ('Modul des Lifts – kommt mit dem Lift in die Stückliste.', 'Lift module – comes with the lift in the parts list.')

# Assembled lift for the chain: N levels high (foot + N-1 middle sections + head, one screw segment per module, crank).
# Inlet at the foot (+y face, rim 40, level 0), outlet at the head (rim 60 at level N); the head can face any direction
# (4 shafts, hand-over in the chamber) - straight (0), left (+90), back (180), right (-90). Pins inside the lift:
# foot->middle 3, middle->middle 4, middle->head 3, crank 1; head directly on the foot 2 (3 when the free corners are
# stacked: head left). Dimensions and ports are measured on the STL (foot inlet, head outlet).
LIFT_N = tuple(range(1, 11))     # heights 1..10 levels
LIFT_DIRS = [('Gerade', 'Straight', 0, 0), ('Links', 'Left', 90, 90), ('Zurueck', 'Back', 180, 180), ('Rechts', 'Right', 270, -90)]
CRANK_Z = 62.0                 # crank sits on the neck of the head screw (2 mm above the head)
CRANK_R = 46.5                 # reach of the crank arm (handle) around the axis
LIFT_WHY = ('Lift: Der Einlauf ist für ruhiges Anrollen gemacht. Kommt die Kugel sehr schnell, kann sie zurückprallen – '
            'davor weniger Gefälle einplanen.',
            'Lift: the inlet is made for a calm approach. If the ball comes in very fast, it can bounce back – plan less drop before it.')
if lift_parts and len(lift_parts) == len(LIFT_KIT):
    foot_mod, head_mod = by_id['LiftFuss_40_16mm'], by_id['LiftKopf_60_16mm']
    p_in = foot_mod['ports'][0] if foot_mod['ports'] else None
    p_out = head_mod['ports'][0] if head_mod['ports'] else None
    if not p_in or not p_out:
        sys.exit('ERROR: lift ports not found (foot %s, head %s)' % (foot_mod['ports'], head_mod['ports']))
    crank_h = by_id['LiftKurbel_16mm']['bbox'][1][2]
    for n in LIFT_N:
        for de, en, rot, turn in LIFT_DIRS:
            pid = 'Lift%d_%s_16mm' % (n, de)
            c, s_ = ROT[rot]
            q = p_out['p']; nn = p_out['n']
            exitp = {'p': [round(c * q[0] - s_ * q[1], 3) + 0.0, round(s_ * q[0] + c * q[1], 3) + 0.0, round(LEVEL * n + q[2], 3)],
                     'n': [round(c * nn[0] - s_ * nn[1], 6) + 0.0, round(s_ * nn[0] + c * nn[1], 6) + 0.0, 0.0]}
            kit = [('LiftFuss_40_16mm', 1), ('LiftMitte_16mm', n - 1), ('LiftKopf_60_16mm', 1), ('LiftSchnecke_Fuss_16mm', 1),
                   ('LiftSchnecke_Mitte_16mm', n - 1), ('LiftSchnecke_Kopf_16mm', 1), ('LiftKurbel_16mm', 1)]
            kit = [(i, k) for i, k in kit if k > 0]
            pins = ((3 if rot == 90 else 2) if n == 1 else 3 + 4 * (n - 2) + 3) + 1
            asm = ([{'id': 'LiftFuss_40_16mm', 'z': 0.0, 'rot': 0}, {'id': 'LiftSchnecke_Fuss_16mm', 'z': 0.0, 'rot': 0}]
                   + [x for i in range(1, n) for x in ({'id': 'LiftMitte_16mm', 'z': LEVEL * i, 'rot': 0},
                                                       {'id': 'LiftSchnecke_Mitte_16mm', 'z': LEVEL * i, 'rot': 0})]
                   + [{'id': 'LiftKopf_60_16mm', 'z': LEVEL * n, 'rot': rot}, {'id': 'LiftSchnecke_Kopf_16mm', 'z': LEVEL * n, 'rot': 0},
                      {'id': 'LiftKurbel_16mm', 'z': LEVEL * n + CRANK_Z, 'rot': 0}])
            gsum = lambda key: round(sum(by_id[i][key] * k for i, k in kit), 3)
            jp_sum = {'grams': round(sum((by_id[i]['jp'] or by_id[i])['grams'] * k for i, k in kit), 1),
                      'hours': round(sum((by_id[i]['jp'] or by_id[i])['hours'] * k for i, k in kit), 3)}
            top = round(LEVEL * n + CRANK_Z + crank_h, 3)
            levels_txt = ('eine Ebene' if n == 1 else '%d Ebenen' % n, 'one level' if n == 1 else '%d levels' % n)
            note = ('Hebt die Kugel %s hoch: Kugeln in den Einlauf unten, Kurbel im Uhrzeigersinn drehen. Oben kommt sie langsam heraus – '
                    'danach Gefälle einplanen. Den Kopf kannst du in jede Richtung drehen („Ausgang drehen“). Steht immer auf dem Boden (Ebene 0).' % levels_txt[0],
                    'Lifts the ball %s: put balls into the inlet at the bottom and turn the crank clockwise. The ball comes out slowly at the top – '
                    'plan a downhill part after it. The top can face any direction ("Turn exit"). Always stands on the floor (level 0).' % levels_txt[1])
            part = {
                'id': pid, 'file': '', 'family': 'lift', 'system': 'channel', 'mirrored': False,
                'rimIn': 40, 'rimOut': 60, 'feedRim': 40,
                'bbox': [[-CRANK_R, -CRANK_R, 0.0], [CRANK_R, CRANK_R, top]], 'foot': list(foot_mod['foot']),
                'height': top, 'volume': gsum('volume'), 'area': gsum('area'), 'grams': round(gsum('grams'), 1), 'hours': gsum('hours'),
                'ports': [dict(p_in), exitp], 'lane': [0, 1], 'reversible': False,
                'vsock': {'bottom': [], 'top': []},
                'phys': {'k': 1.4, 'L': None, 'drop': round((40 - 60 - 60 * n) * SCALE, 3), 'fixedExit': 120, 'estimate': True,
                         'limits': {'vwarn': 320, 'why': LIFT_WHY[0], 'whyEn': LIFT_WHY[1]}},
                'turn': turn, 'radius': None, 'center': None, 'length': None,
                'adapter': None, 'note': note[0], 'noteEn': note[1],
                'nameEn': 'Lift%d_%s_16mm' % (n, en), 'plate': head_mod['plate'], 'released': bool(head_mod['released']),
                'printRot': 0, 'printMeta': {}, 'jp': jp_sum if any(by_id[i]['jp'] for i, _ in kit) else None,
                'lift': {'n': n, 'dir': en.lower(), 'headRot': rot, 'kit': [{'id': i, 'n': k} for i, k in kit], 'pins': pins,
                         'asm': asm, 'crankR': CRANK_R, 'housingTop': LEVEL * n + 60.0, 'crankZ': [LEVEL * n + CRANK_Z, top]},
                'palette': de == 'Gerade',
            }
            parts.append(part); by_id[pid] = part
    print('Lift: %d variants (height %s, head %s)' % (len(LIFT_N) * len(LIFT_DIRS), LIFT_N, [d[0] for d in LIFT_DIRS]))

# ---------------------------------------------------------------- Flip-flop
# Modules: body (grooved in Japandi), rocker, round axle pin - printed with their own settings (body and rocker 15 %, no
# brim) on plate 14 next to the X crossing. Filament/time: the flip-flop's share of plate 14 (plate sliced with the
# flip-flop minus the plate with the crossing alone, field "vorher" in flipflop_slice), split by the formula. Two parts go
# into the chain: inlet at the top of the x face (rim 60 at level 1, rim code 120 like Rutsche_120-60), outlet +y (Links)
# or -y (Rechts) at level 0, rim 60. Balls leave alternately left and right; the chain follows one outlet. Exit speed from
# a 3D simulation: median ~180 mm/s, independent of the inlet speed; error-free up to ~1.3 m/s.
FF_KIT = ['Kippwippe_120-60_16mm', 'Kippwippe_Wippe_16mm', 'Kippwippe_Achsstift_16mm']
ff_parts = [by_id[i] for i in FF_KIT if i in by_id]
FF_WHY = ('Kippwippe: bis etwa 1,3 m/s ohne Fehler gerechnet. Kommt die Kugel noch schneller, kann sie zurückspringen oder '
          'hinausfliegen – davor weniger Gefälle oder eine Bremse.',
          'Flip-flop: calculated without errors up to about 1.3 m/s. If the ball comes in even faster, it can bounce back or '
          'fly out – plan less drop or a brake before it.')
if ff_parts and len(ff_parts) == len(FF_KIT):
    def plate14(ed):
        fn = os.path.normpath(os.path.join(ROOT, CFG['flipflop_slice'] % ed)) if CFG.get('flipflop_slice') else None
        if not fn or not os.path.exists(fn): return None
        for pl in json.load(open(fn, encoding='utf-8'))['platten']:
            if pl['platte'] == 14 and pl.get('vorher'):
                # the Y merge parts are on plate 14 too: the state with the flip-flop only is vorher_ymerge
                z, g_ = pl.get('vorher_ymerge') or (pl['zeit_s'], pl['gramm'])
                return (z - pl['vorher'][0]) / 3600.0, g_ - pl['vorher'][1]
        return None
    sl_plain, sl_jp = plate14('plain'), plate14('japandi')
    if sl_plain:
        fg = sl_plain[1] / sum(p['grams'] for p in ff_parts); fh = sl_plain[0] / sum(p['hours'] for p in ff_parts)
        for p in ff_parts: p['grams'] = round(p['grams'] * fg, 1); p['hours'] = round(p['hours'] * fh, 3)
        print('Flip-flop: share of plate 14 plain %.1f g / %.2f h, factor g %.2f, h %.2f' % (sl_plain[1], sl_plain[0], fg, fh))
    if sl_jp:
        grooved = [p for p in ff_parts if p['jp']]
        rest_g = sum(p['grams'] for p in ff_parts if not p['jp']); rest_h = sum(p['hours'] for p in ff_parts if not p['jp'])
        fg = (sl_jp[1] - rest_g) / sum(p['jp']['grams'] for p in grooved); fh = (sl_jp[0] - rest_h) / sum(p['jp']['hours'] for p in grooved)
        for p in grooved: p['jp'] = {'grams': round(p['jp']['grams'] * fg, 1), 'hours': round(p['jp']['hours'] * fh, 3)}
        print('Flip-flop: share of plate 14 Japandi %.1f g / %.2f h, body factor g %.2f, h %.2f' % (sl_jp[1], sl_jp[0], fg, fh))
    for p in ff_parts:
        p['note'], p['noteEn'] = ('Teil der Kippwippe – kommt mit der Kippwippe in die Stückliste.', 'Flip-flop part – comes with the flip-flop in the parts list.')
    for pid in FF_DISPLAY:
        if pid in by_id:
            by_id[pid].update({'display': True, 'palette': False, 'note': 'Nur für die 3D-Ansicht: Wippe eingebaut.',
                               'noteEn': 'For the 3D view only: rocker in place.'})
    body = by_id['Kippwippe_120-60_16mm']
    bp = body['ports']
    zs = [q['p'][2] for q in bp]
    ent = int(np.argmax(zs))
    ex = {s: [i for i, q in enumerate(bp) if abs(q['n'][1] - s) < 0.01 and abs(q['p'][2] - PORT_Z) < 0.01] for s in (1, -1)}
    if zs[ent] - PORT_Z < LEVEL - 0.1 or len(ex[1]) != 1 or len(ex[-1]) != 1:
        sys.exit('ERROR: flip-flop sockets not as expected: %s' % bp)
    kit = [(i, 1) for i in FF_KIT]
    gsum = lambda key: round(sum(by_id[i][key] * k for i, k in kit), 3)
    jp_sum = {'grams': round(sum((by_id[i]['jp'] or by_id[i])['grams'] * k for i, k in kit), 1),
              'hours': round(sum((by_id[i]['jp'] or by_id[i])['hours'] * k for i, k in kit), 3)}
    for de, en, s_, turn in (('Links', 'Left', 1, 90), ('Rechts', 'Right', -1, -90)):
        order = [ent, ex[s_][0]] + [i for i in range(len(bp)) if i not in (ent, ex[s_][0])]
        pp = [dict(bp[i]) for i in order]
        L = round(abs(pp[1]['p'][0] - pp[0]['p'][0]) + abs(pp[1]['p'][1] - pp[0]['p'][1]), 2)
        side = ('links' if s_ == 1 else 'rechts', 'left' if s_ == 1 else 'right')
        other = ('rechts' if s_ == 1 else 'links', 'right' if s_ == 1 else 'left')
        note = ('Kippwippe: Die Kugel kommt oben an (Rand 60, eine Ebene höher), kippt die Wippe und läuft eine Ebene tiefer '
                'hinaus – abwechselnd links und rechts. Die Bahn folgt dem Ausgang %s; jede zweite Kugel nimmt den Ausgang %s – '
                'dort mit „Abzweig bauen“ einen eigenen Strang oder eine Endschale anschließen („Ausgang wechseln“ tauscht die Seiten). '
                'Steht auf dem Boden oder auf dem AdapterKippwippe. Achsstift gedruckt, kein Zusatzteil.' % (side[0], other[0]),
                'Flip-flop: the ball arrives at the top (rim 60, one level up), tips the rocker and leaves one level lower – '
                'left and right in turn. The track follows the %s exit; every second ball takes the %s exit – use "Build branch" '
                'to connect a strand of its own or an end cup there ("Switch exit" swaps the sides). Stands on the floor or on the '
                'AdapterFlipFlop. The axle is a printed pin, no extra hardware.' % (side[1], other[1]))
        pid = 'Kippwippe_120-60_%s_16mm' % de
        part = {
            'id': pid, 'file': '', 'family': 'attraction', 'system': 'channel', 'mirrored': False,
            'rimIn': 120, 'rimOut': 60, 'feedRim': int(round(120 - (pp[0]['p'][2] - PORT_Z) * 60 / LEVEL)),
            'bbox': body['bbox'], 'foot': list(body['foot']), 'height': body['height'],
            'volume': gsum('volume'), 'area': gsum('area'), 'grams': round(gsum('grams'), 1), 'hours': gsum('hours'),
            'ports': pp, 'lane': [0, 1], 'reversible': False, 'vsock': body['vsock'],
            'phys': {'k': 1.4, 'L': L, 'drop': round(60 * SCALE, 3), 'fixedExit': 180, 'estimate': True,
                     'limits': {'vwarn': 1100, 'vmax': 1300, 'why': FF_WHY[0], 'whyEn': FF_WHY[1]}},
            'turn': turn, 'radius': None, 'center': None, 'length': L,
            'adapter': None, 'note': note[0], 'noteEn': note[1],
            'nameEn': 'FlipFlop_120-60_%s_16mm' % en, 'plate': body['plate'], 'released': bool(body['released']),
            'printRot': 0, 'printMeta': {}, 'jp': jp_sum if body['jp'] else None,
            'kit': [{'id': i, 'n': k} for i, k in kit],
            'asm': [{'id': body['id'], 'z': 0.0, 'rot': 0}, {'id': 'Kippwippe_Ansicht_Wippe_%s_16mm' % de, 'z': 0.0, 'rot': 0}],
            'swap': 'Kippwippe_120-60_%s_16mm' % ('Rechts' if s_ == 1 else 'Links'),
        }
        # stands on the floor or on the AdapterKippwippe height adapter (floorOnly if none matches)
        part['adapter'] = match_adapter(part, ['AdapterKippwippe_120-60_16mm'])
        if part['adapter'] is None: print('NOTE: no AdapterKippwippe for %s (stands on level 0 only)' % pid); part['floorOnly'] = True
        parts.append(part); by_id[pid] = part
    print('Flip-flop: 2 chain parts (exit left/right), inlet z %.1f, exits %s' % (zs[ent], [bp[ex[1][0]]['p'], bp[ex[-1][0]]['p']]))

# ---------------------------------------------------------------- Y merge: filament/time
# The 5 Y merge parts sit on plate 14 (default settings). Their share = plate 14 now minus plate 14 without them
# (field vorher_ymerge in flipflop_slice), split by the formula like the flip-flop.
ym_parts = [by_id[i] for i in YM_PARTS if i in by_id]
if ym_parts and CFG.get('flipflop_slice'):
    def ym_share(ed):
        fn = os.path.normpath(os.path.join(ROOT, CFG['flipflop_slice'] % ed))
        if not os.path.exists(fn): return None
        for pl in json.load(open(fn, encoding='utf-8'))['platten']:
            if pl['platte'] == 14 and pl.get('vorher_ymerge'):
                return (pl['zeit_s'] - pl['vorher_ymerge'][0]) / 3600.0, pl['gramm'] - pl['vorher_ymerge'][1]
        return None
    sl_plain, sl_jp = ym_share('plain'), ym_share('japandi')
    if sl_plain:
        fg = sl_plain[1] / sum(p['grams'] for p in ym_parts); fh = sl_plain[0] / sum(p['hours'] for p in ym_parts)
        for p in ym_parts: p['grams'] = round(p['grams'] * fg, 1); p['hours'] = round(p['hours'] * fh, 3)
        print('Y merge: share of plate 14 plain %.1f g / %.2f h, factor g %.2f, h %.2f' % (sl_plain[1], sl_plain[0], fg, fh))
    if sl_jp and all(p['jp'] for p in ym_parts):
        fg = sl_jp[1] / sum(p['jp']['grams'] for p in ym_parts); fh = sl_jp[0] / sum(p['jp']['hours'] for p in ym_parts)
        for p in ym_parts: p['jp'] = {'grams': round(p['jp']['grams'] * fg, 1), 'hours': round(p['jp']['hours'] * fh, 3)}
        print('Y merge: share of plate 14 Japandi %.1f g / %.2f h, factor g %.2f, h %.2f' % (sl_jp[1], sl_jp[0], fg, fh))

# Stable short codes for URLs (codes.json is extended, existing codes are kept)
CODES = os.path.join(HERE, 'codes.json')
codes = json.load(open(CODES, encoding='utf-8')) if os.path.exists(CODES) else {}
nxt = max([int(x, 36) for x in codes.values()] + [-1]) + 1
for p in parts:
    if p['id'] not in codes:
        codes[p['id']] = np.base_repr(nxt, 36).lower(); nxt += 1
    p['code'] = codes[p['id']]
json.dump(codes, open(CODES, 'w', encoding='utf-8'), indent=0, sort_keys=True)
os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
json.dump({'parts': parts, 'geom': GEOM}, open(os.path.join(ROOT, 'data', 'parts_raw.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
json.dump({'parts': parts, 'calib': {k: calib[k] for k in ('g', 'h', 'plateH')}}, open(os.path.join(OUT, 'parts.json'), 'w', encoding='utf-8'),
          separators=(',', ':'), ensure_ascii=False)
print(len(parts), 'parts,', sum(p['released'] for p in parts), 'in the release profile, extras:', sorted(p['id'] for p in parts if not p['released']))
for p in parts:
    if p['family'] not in ('adapter', 'pin'):
        print('%-46s %-10s %-8s rim %s-%s feed %s turn %4d R %s L %s ad %s rev %s' % (
            p['id'], p['family'], p['system'], p['rimIn'], p['rimOut'], p['feedRim'], p['turn'], p['radius'], p['length'],
            p['adapter'] and (p['adapter']['type'][:-5], p['adapter']['rot'], p['adapter']['offset']), p['reversible']))
