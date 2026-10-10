// Minimal bilingual UI texts (DE/EN).
import type { Part } from './catalog';
export type Lang = 'de' | 'en';
const T: Record<string, [string, string]> = {
  title: ['Kugelbahn-Builder 16 mm', 'Marble Run Builder 16 mm'],
  subtitle: ['Baukasten für 16-mm-Murmeln · Raststift-System', 'Modular run for 16 mm marbles · snap-pin system'],
  subtitleJ: ['Japandi-Edition · Rillen, Sand, Schoko', 'Japandi edition · grooves, sand, chocolate'],
  japandi: ['Japandi-Style', 'Japandi style'],
  colors: ['Farben', 'Colours'], colFamily: ['Familienfarben (zur Orientierung)', 'Family colours (for orientation)'], colCustom: ['Eigene Auswahl', 'Custom selection'],
  colOwn: ['Eigene Farbe …', 'Custom colour …'], ownColor: ['Eigene Farbe {c}', 'Custom colour {c}'],
  filPick: ['{g}: Filament wählen', '{g}: choose filament'], filAll: ['Alle Sorten', 'All types'], filSearch: ['Farbe suchen …', 'Search colour …'],
  filNone: ['Keine Farbe gefunden.', 'No colour found.'], filSource: ['Farben: Bambu Studio', 'Colours: Bambu Studio'], close: ['Schließen', 'Close'],
  filFit: ['Die Raststift-Passung ist bisher nur mit Bambu PLA Basic bestätigt. Mit {types} zuerst Platte 01 (Passprobe) drucken.', 'The snap-pin fit is so far only confirmed with Bambu PLA Basic. With {types}, print plate 01 (fit test) first.'],
  filOwnType: ['eigener Farbe', 'a custom colour'],
  colTrack: ['Bahn', 'Track'], colRail: ['Schiene', 'Rails'], colAdapter: ['Adapter + Stifte', 'Adapters + pins'], colAccent: ['Akzente', 'Accents'],
  colorsNote: ['Tippe auf eine Gruppe und wähle ein Filament aus der Farbliste von Bambu Studio (oder eine eigene Farbe). Filamentfarben färben die 3D-Ansicht und trennen die Druckplatten nach Filament – jede Platte ist dann einfarbig. Akzente sind Start, Ende, Hügel, Kreuzung und Loopings. Die Vorschaubilder der Palette bleiben in den Standardfarben. Die Wahl wird gespeichert und steckt im Link.', 'Tap a group and pick a filament from the Bambu Studio colour list (or a custom colour). Filament colours tint the 3D view and split the print plates by filament – every plate is then single-colour. Accents are start, end, hills, crossing and loops. The palette thumbnails keep their standard colours. The choice is saved and part of the link.'],
  mdColor: ['Filament je Farbe', 'Filament per colour'], plateColor: ['Filament {c}', 'filament {c}'],
  japandiHint: ['Japandi-Edition: senkrechte Rillen an allen flachen Seitenwänden ({n} Teile), dazu die ganze Oberfläche im Japandi-Stil. Maße, Buchsen und Platten sind gleich; Stückliste, Druckplan und Plattenliste beziehen sich auf das Japandi-Druckprofil.', 'Japandi edition: vertical grooves on all flat side walls ({n} parts), and the whole interface in Japandi style. Dimensions, sockets and plates are the same; BOM, print plan and plate list refer to the Japandi print profile.'],
  parts: ['Teile', 'Parts'], view3d: ['3D', '3D'], track: ['Bahn', 'Track'],
  new: ['Neu', 'New'], demo: ['Beispiel laden', 'Load example'], undo: ['Rückgängig', 'Undo'], redo: ['Wiederholen', 'Redo'],
  share: ['Link kopieren', 'Copy link'], save: ['JSON speichern', 'Save JSON'], load: ['JSON laden', 'Load JSON'],
  bom: ['Stückliste', 'Bill of materials'], bomCsv: ['Stückliste CSV', 'BOM as CSV'],
  help: ['Hilfe', 'Help'], ok: ['OK', 'OK'],
  search: ['Suchen …', 'Search …'], showLegacy: ['Extras zeigen (Hügel, Zickzack, Loopings, Versatz)', 'show extras (hills, zigzag, loops, offsets)'], reverseMode: ['bergauf zeigen', 'show uphill'],
  compatibleOnly: ['nur passende', 'compatible only'],
  fit: ['Einpassen', 'Fit'], top: ['Oben', 'Top'], iso: ['Iso', 'Iso'], adapters: ['Adapter', 'Adapters'], path: ['Kugelweg', 'Ball path'],
  speedColors: ['Tempo-Farben', 'Speed colours'],
  level: ['Ebene', 'Level'], speed: ['Tempo', 'Speed'], statusOk: ['ok', 'ok'], statusWarn: ['knapp', 'marginal'], statusError: ['Fehler', 'error'], statusStop: ['bleibt stehen', 'stops'],
  delete: ['Löschen', 'Delete'], reverse: ['Umdrehen', 'Reverse'], insertAfter: ['Danach einfügen', 'Insert after'], appendMode: ['Ans Ende', 'Append'],
  empty: ['Noch keine Teile. Links ein Teil wählen – am besten mit der StartSchale beginnen.', 'No parts yet. Pick a part on the left – start with the StartCup.'],
  stats: ['Kennzahlen', 'Key figures'], trackParts: ['Bahnteile', 'Track parts'], adapterParts: ['Adapter', 'Adapters'],
  height: ['Bauhöhe', 'Build height'], footprint: ['Grundriss', 'Footprint'], drop: ['Gefälle gesamt', 'Total drop'], length: ['Bahnlänge', 'Track length'],
  filament: ['Filament ca.', 'Filament approx.'], printTime: ['Druckzeit ca.', 'Print time approx.'], levels: ['Standebenen', 'Levels'],
  issues: ['Hinweise', 'Notes'], noIssues: ['Keine Kollisionen, alle Fugen passen.', 'No collisions, all joints fit.'],
  physics: ['Kugel-Check', 'Ball check'], push: ['Anschubs', 'Initial push'],
  physInfo: ['Wie gerechnet wird', 'How this is calculated'], ballMass: ['Kugelgewicht', 'Ball weight'],
  ballNote: ['Das Gewicht ändert das Tempo nicht: Leichte und schwere Kugeln rollen gleich schnell. Es bestimmt nur, wie viel Wucht die Kugel am Ende hat (Glasmurmel 16 mm: 5,4 g, Stahlkugel 16 mm: 16,8 g).',
             'Weight does not change the speed: light and heavy balls roll equally fast. It only sets how much punch the ball has at the end (16 mm glass marble: 5.4 g, 16 mm steel ball: 16.8 g).'],
  energyEnd: ['Energie am Ende', 'Energy at the end'], speedTitle: ['Tempo Eingang → Ausgang in mm/s (Kugel-Check)', 'speed in → out in mm/s (ball check)'],
  famRail: ['Schienen-{fam}', 'Rail {fam}'], famTunnel: ['Tunnel-{fam}', 'Tunnel {fam}'], crr: ['Rollwiderstand', 'Rolling resistance'],
  physNote: ['Der Kugel-Check rechnet Teil für Teil: Gefälle macht die Kugel schneller, der Rollwiderstand bremst sie, in Kurven etwas stärker. Jedes Teil hat Grenzen – zum Beispiel, ab welchem Tempo die Kugel aus einer Kurve springt. Diese Grenzen sind gerechnete Richtwerte, noch nicht an der gedruckten Bahn gemessen; gemessen ist nur der Rollwiderstand. Knappe Stellen am besten erst mit ein paar Teilen ausprobieren.',
             'The ball check works part by part: drop makes the ball faster, rolling resistance slows it down, a bit more in curves. Every part has limits – for example the speed at which the ball jumps out of a curve. These limits are calculated guide values, not yet measured on the printed track; only the rolling resistance is measured. Best try tight spots with a few parts first.'],
  in: ['ein', 'in'], out: ['aus', 'out'], rim: ['Rand', 'rim'], count: ['Stk', 'qty'], grams: ['g', 'g'], hours: ['h', 'h'],
  legacyTag: ['Extra', 'extra'], estimateTag: ['geschätzt', 'estimate'],
  linkCopied: ['Link in die Zwischenablage kopiert.', 'Link copied to clipboard.'],
  confirmNew: ['Bahn wirklich leeren?', 'Really clear the track?'],
  helpText: [
    `<p><b>So geht's:</b> Links in der Teileliste ein Grundteil wählen (Gerade, Kurve R24, Rutsche …) und in den Auswahlfeldern der Karte die Variante einstellen – Ausführung (Rille, Schiene, Tunnel), Länge, Rand. Ein Tipp auf die Karte (oder +) steckt das Teil an das offene Ende der Bahn. Die Chips oben filtern nach Gruppe; „nur passende“ zeigt nur Werte, deren Rand an das offene Ende passt. Im 16-mm-System hat jedes Teil an beiden Enden eine <b>Buchse</b>; verbunden wird immer mit einem <b>Raststift</b>. Adaptertürme und Standebenen entstehen automatisch.</p>
     <p><b>Richtung wählen:</b> Kurven, Lift, Kippwippe und Y-Merge wählst du ohne Richtung. Der Builder prüft, in welche Richtung Platz ist: Passt nur eine, baut er sie ein. Passen mehrere, erscheinen sie als <b>Schatten</b> in der 3D-Ansicht – den gewünschten anklicken (oder die Knöpfe über der Ansicht, Pfeiltasten, Esc bricht ab). Rote Schatten stoßen irgendwo an. Flache Kurven sind umgedreht die Gegenkurve, Fallkurven gibt es gespiegelt – das erledigt die Richtungswahl.</p>
     <p><b>Ebenen:</b> Eine Ebene ist 32 mm hoch (ein Adapter). Ein Ebenenwechsler (Rutsche, Spirale, Zickzack, Trichter …) hat seine Eingangsbuchse auf Podest-Niveau und steht eine Ebene tiefer. Die tiefste Ebene ist immer 0.</p>
     <p><b>Kugel-Check:</b> Die Geschwindigkeit wird über Fallhöhe und Rollwiderstand geschätzt. Gelb = knapp an einer Grenze, Rot = überschritten (z. B. offene Schienenkurve zu schnell, Hügel hebt ab), Braun = Kugel bleibt liegen. Die Grenzen sind gerechnete Richtwerte.</p>
     <p><b>Bearbeiten:</b> Teil antippen (3D oder Liste) – im Detailfenster stehen dieselben Auswahlfelder wie in der Teileliste (z. B. Rille ↔ Schiene, Länge, Lift-Höhe), dazu Löschen, Richtung wechseln, Umdrehen, „Danach einfügen“ und „Ersetzen“: im Ersetzen-Modus zeigt die Teileliste nur, was zwischen Vorgänger und Nachfolger passt.</p>
     <p><b>Bergauf:</b> Jedes Teil mit zwei Buchsen auf Standardhöhe lässt sich umgedreht einbauen – ohne Zusatzteil, der Raststift passt in jede Buchse. Gefälleteile laufen dann bergauf; mit „bergauf zeigen“ stehen diese Ränder (z. B. 40 → 50 ↗) in den Auswahlfeldern. Der Kugel-Check sagt, ob der Schwung reicht.</p>
     <p><b>Adaptertürme:</b> Unter jedem Teil einer höheren Ebene steht ein Turm aus Adaptern (32 mm). Teil und Adapter, Adapter und Adapter halten mit <b>einem</b> Raststift in der Mitte; Türme derselben Ebene, deren Stirnbuchsen sich gegenüberliegen, werden ebenfalls mit einem Raststift gekoppelt. Gespiegelte Kurven stehen auf dem Standard-Kurvenadapter, um −90° gedreht. Alle Raststifte stehen automatisch in Stückliste und Druckplan.</p>
     <p><b>Druckplatten:</b> Der Slider begrenzt die Druckzeit je Platte; die Teile werden je Standebene (tiefste zuerst) auf 256-mm-Platten verteilt. Jedes Teil liegt wie im Druckprofil (Kurven 90°, gespiegelte 180°, „hinten keine Buchse“).</p>
     <p><b>Adapter-Slots:</b> Im Detailfenster eines Teils steht jeder Adapter unter ihm mit zwei Knöpfen. <i>Tunnel</i> tauscht einen geraden Adapter gegen seinen Quertunnel: die kreuzende Rand-40-Gerade der unteren Ebene wird automatisch in Geraden/Distanzstücke + Quertunnel 32 + Geraden/Distanzstücke zerlegt, sodass der Tunnel genau unter dem Adapter liegt (die Kreuzung muss eine Fahrspur treffen: 16, 32 oder 48 mm ab Adapter-Anfang – sonst sagt der Knopf, um wie viel die untere Strecke zu verschieben ist). <i>Weglassen</i> lässt den Adapter einfach weg (Freestyle-Tunnel): das darüber hängt an seinen gesteckten Nachbarn, der Builder warnt, wenn nichts mehr hält.</p>
     <p><b>Raster und Verbinden:</b> Unter dem offenen Ende steht, wo es im 8-mm-Raster des ersten Teils liegt – längs und quer zur Fahrtrichtung. Im Raster gehen Rundkurs, Quertunnel und X-Kreuzung genau auf. Gerade80 und Distanz65 verschieben um ⅓ Raster, Gerade100 um ⅔. „Verbinden …“ sucht die kürzesten Teilefolgen (Geraden, Distanzstücke, Kurven, Rutschen) vom Ende des Hauptstrangs zu einem Ziel: zurück in den Eingang des ersten Teils (Rundkurs, z. B. mit Lift), in eine freie Querspur oder durch einen Quertunnel unter einem 120er/95er-Adapter – dann setzt der Builder den Tunnel gleich mit ein. Die Fahrspuren solcher Tunnel zeigt die 3D-Ansicht als Linien am Boden (für das gewählte Teil und auf der Ebene des offenen Endes). Endet die Bahn knapp vor ihrem Anfang, sagt ein Hinweis, um wie viel. Danach den Kugel-Check ansehen: der Assistent prüft Lage und Kollisionen, nicht das Tempo.</p>
     <p><b>Japandi-Style:</b> Der Builder startet in der Japandi-Edition; der Schalter oben rechts wechselt zur glatten Edition und zurück. Japandi heißt: senkrechte Rillen an allen flachen Seitenwänden (Geraden, Kurven, Adapter, Schalen, Trichter …), die ganze Oberfläche in Sand, Kohle und Kupfer. Maße, Buchsen, Kugel-Check und Platten bleiben gleich; Gewicht, Druckzeit, Druckplan und Plattenliste gelten dann für das Japandi-Druckprofil. Die Wahl steckt auch im Link.</p>
     <p><b>Farben:</b> Unter „Farben“ stehen die Familienfarben (zur Orientierung), Vorlagen wie „Knochen auf Braun“ oder „Kupfer auf Schwarz“ und eine eigene Auswahl für Bahn, Schiene, Adapter und Akzente: Ein Tipp auf die Gruppe öffnet die Filamentfarben von Bambu Studio (nach Sorte, mit Suche), dazu geht jede eigene Farbe. Mit Filamentfarben färbt sich die 3D-Ansicht, und der Druckplan legt nur Teile aus demselben Filament auf eine Platte und nennt die Menge je Filament.</p>
     <p><b>Lift:</b> Der Lift hebt die Kugel mit einer Kurbel 1 bis 10 Ebenen hoch – Kugeln unten in den Einlauf, im Uhrzeigersinn kurbeln. Die Höhe stellst du auf der Karte oder im Detailfenster ein (gedruckt und erprobt bis +5, darüber gerechnet), die Richtung des Ausgangs per Schatten bzw. „Ausgang drehen“. Er steht immer auf dem Boden. Führt die Bahn wieder genau zum Einlauf zurück, ist sie ein Rundkurs. In Stückliste und Druckplan stehen die einzelnen Module (Fuß, Mittelstücke, Kopf, Schneckensegmente, Kurbel).</p>
     <p><b>Kippwippe und Abzweige:</b> Die Kippwippe nimmt die Kugel oben an (Rand 60), kippt und schickt sie eine Ebene tiefer hinaus – abwechselnd links und rechts. Sie steht auf dem Boden oder auf ihrem Höhenadapter. Die Bahn folgt einem Ausgang; am anderen beginnt mit „Abzweig bauen“ (Detailfenster oder Pfeil in der 3D-Ansicht) ein zweiter <b>Strang</b>, den du wie die Bahn weiterbaust. Die Bahn-Liste zeigt die Stränge getrennt; Kugel-Check, Kollisionen, Stückliste und Druckplan gelten für alle. Löschst du die Kippwippe, fällt ihr Abzweig mit weg (Rückgängig holt alles zurück). In Stückliste und Druckplan stehen Körper, Wippe und Achsstift; die Geschwindigkeit am Ausgang ist geschätzt (etwa 180 mm/s).</p><p><b>X-Kreuzung:</b> Die Bahn nutzt eine Spur; im Auswahlfeld legst du fest, ob die Querspur von links oder von rechts kommt. Steckt später ein anderer Strang (oder dieselbe Bahn) genau in die freie Spur, fährt er hindurch und geht an ihrem Ausgang weiter – der Builder erkennt das selbst. Der Rand muss passen (hohe Seite 50, niedrige Seite 40, dann bergauf durch die Kreuzung). Die Kreuzung steht auf dem Boden oder auf ihrem Höhenadapter.</p><p><b>Y-Merge:</b> Zwei Bahnen laufen zu einer zusammen – das Gegenstück zur Kippwippe. Beim Einbauen wählst du, durch welchen Eingang die Bahn kommt (Schatten: der Ausgang liegt 16 mm rechts oder links). Der andere Eingang bleibt frei: Steckt ein anderer Strang – etwa der Abzweig einer Kippwippe – genau hinein (32 mm neben der Bahn, gleiche Richtung, gleicher Rand), mündet er dort und endet; die Kugel läuft im Y weiter. „Verbinden …“ sucht den Weg dorthin auch selbst. Im Y wird die Kugel langsamer (eben etwa 70 % des Tempos), bis 0,8 m/s am Eingang ist es gerechnet ohne Verlust. Das Y steht auf dem Boden oder auf seinem Höhenadapter (AdapterYMerge120).</p>
     <p><b>In einem Stück drucken:</b> Unter „In einem Stück drucken“ den Drucker wählen und „Druckplatte zeigen und einhalten“ einschalten: die Platte erscheint in der 3D-Ansicht, die Bahn sitzt mittig darauf (wenn nötig um 90° gedreht), und Teile, mit denen sie nicht mehr passt, sind in der Teileliste ausgegraut. „Bahn in einem Stück (3MF)“ lädt eine Datei mit <b>einem</b> Objekt: Bambu Studio verschweißt alle Bahnteile und Adapter beim Slicen – ohne Raststifte. Erhöhte Teile drucken mit Baumstützen (nur auf der Platte). Lift und Kippwippe bleiben lose (bewegliche Teile) und liegen mit ihren Raststiften auf einer eigenen Platte. Die 3MF-Exporte schaltest du mit dem Druckprofil von MakerWorld frei: herunterladen, hierher ziehen – aus dieser Datei holt der Builder die Druckteile. Sie bleibt nur in diesem Browserfenster (nichts wird hochgeladen oder gespeichert); nach dem Neuladen der Seite ziehst du sie wieder hinein.</p>
     <p><b>Teilen:</b> „Link kopieren“ packt die ganze Bahn in die URL. „JSON speichern“ für die Ablage, „Stückliste CSV“ für die Tabellenkalkulation. Die „Profil-Plattenliste“ sagt, welche Platte des Druckprofils (jedes Teil genau einmal) wie oft gebraucht wird.</p>`,
    `<p><b>How it works:</b> Pick a base part in the parts list on the left (straight, curve R24, slide …) and set the variant in the card's selectors – style (groove, rail, tunnel), length, rim. Tapping the card (or +) plugs the part into the open end of the track. The chips at the top filter by group; “compatible only” shows only values whose rim fits the open end. In the 16 mm system every part has a <b>socket</b> at both ends; parts are always joined with a <b>snap pin</b>. Adapter towers and levels are created automatically.</p>
     <p><b>Choosing a direction:</b> Curves, lift, flip-flop and Y merge are picked without a direction. The builder checks which way there is room: if only one fits, it is placed. If several fit, they appear as <b>shadows</b> in the 3D view – click the one you want (or the buttons above the view, arrow keys, Esc cancels). Red shadows collide with something. Flat curves are the opposite curve when reversed and drop curves come mirrored – the direction choice takes care of that.</p>
     <p><b>Levels:</b> One level is 32 mm (one adapter). A level changer (slide, spiral, zigzag, funnel …) has its entry socket at pedestal height and stands one level lower. The lowest level is always 0.</p>
     <p><b>Ball check:</b> Speed is estimated from drop height and rolling resistance. Yellow = close to a limit, red = exceeded (e.g. open rail curve too fast, hill lifts off), brown = ball stops. The limits are calculated guide values.</p>
     <p><b>Editing:</b> Tap a part (3D or list) – the detail panel has the same selectors as the parts list (e.g. groove ↔ rail, length, lift height), plus delete, switch direction, reverse, “Insert after” and “Replace”: in replace mode the parts list only shows what fits between predecessor and successor.</p>
     <p><b>Uphill:</b> Every part with two sockets at standard height can be installed reversed – no extra part, the snap pin fits every socket. Sloped parts then run uphill; with “show uphill” these rims (e.g. 40 → 50 ↗) appear in the selectors. The ball check tells you whether the momentum is enough.</p>
     <p><b>Adapter towers:</b> Every part on a higher level stands on a tower of adapters (32 mm). Part and adapter, adapter and adapter are held by <b>one</b> snap pin in the middle; towers on the same level whose end sockets face each other are coupled with a snap pin as well. Mirrored curves stand on the standard curve adapter rotated by −90°. All snap pins appear in the BOM and print plan automatically.</p>
     <p><b>Print plates:</b> The slider limits the print time per plate; parts are distributed per level (lowest first) onto 256 mm plates. Every part lies as in the print profile (curves 90°, mirrored 180°, “no socket at the back”).</p>
     <p><b>Adapter slots:</b> A part's detail panel lists every adapter under it with two buttons. <i>Tunnel</i> swaps a straight adapter for its cross-tunnel version: the crossing rim-40 straight of the lower level is split automatically into straights/spacers + cross tunnel 32 + straights/spacers so the tunnel sits exactly under the adapter (the crossing must hit a lane: 16, 32 or 48 mm from the start of the adapter – otherwise the button tells you how far to shift the lower run). <i>Omit</i> simply leaves the adapter out (freestyle tunnel): what sits above hangs on its plugged-in neighbours, and the builder warns when nothing holds it any more.</p>
     <p><b>Grid and connect:</b> Below the open end you see where it lies in the 8 mm grid of the first part – along and across the running direction. On the grid, loops, cross tunnels and the X crossing fit exactly. Gerade80 and Distanz65 shift by ⅓ grid, Gerade100 by ⅔. “Connect …” finds the shortest part sequences (straights, spacers, curves, slides) from the end of the main strand to a target: back into the entrance of the first part (a loop, e.g. with a lift), into a free cross lane, or through a cross tunnel under a 120/95 adapter – the builder then adds the tunnel as well. The 3D view shows the lanes of such tunnels as lines on the floor (for the selected part and on the level of the open end). If the track ends just short of its start, a note tells you by how much. Check the ball run afterwards: the assistant checks position and collisions, not speed.</p>
     <p><b>Japandi style:</b> The builder starts in the Japandi edition; the switch at the top right changes to the plain edition and back. Japandi means: vertical grooves on all flat side walls (straights, curves, adapters, cups, funnel …), and the whole interface in sand, charcoal and copper. Dimensions, sockets, ball check and plates stay the same; weight, print time, print plan and plate list then refer to the Japandi print profile. The choice is part of the link too.</p>
     <p><b>Colours:</b> Under “Colours” you find the family colours (for orientation), presets such as “Bone on brown” or “Copper on black”, and a custom selection for track, rails, adapters and accents: tapping a group opens the Bambu Studio filament colours (by type, with search), and any custom colour works too. With filament colours the 3D view is tinted, and the print plan only puts parts of the same filament on one plate and lists the amount per filament.</p>
     <p><b>Lift:</b> The lift raises the ball by 1 to 10 levels with a crank – put balls into the inlet at the bottom and turn clockwise. Set the height on the card or in the detail panel (printed and tested up to +5, higher is calculated), the exit direction with the shadows or “Turn exit”. It always stands on the floor. If the track leads exactly back to the inlet, it is a loop. The BOM and print plan list the individual modules (base, middle pieces, top, screw segments, crank).</p>
     <p><b>Flip-flop and branches:</b> The flip-flop takes the ball at the top (rim 60), tips over and sends it out one level lower – alternately left and right. It stands on the floor or on its height adapter. The track follows one exit; at the other one “Build branch” (detail panel or arrow in the 3D view) starts a second <b>strand</b> that you build on like the track. The track list shows the strands separately; ball check, collisions, BOM and print plan cover all of them. Deleting the flip-flop also removes its branch (Undo brings everything back). The BOM and print plan show body, rocker and axle pin; the exit speed is an estimate (about 180 mm/s).</p><p><b>X crossing:</b> The track uses one lane; the selector sets whether the cross lane comes from the left or the right. If another strand (or the same track) later plugs exactly into the free lane, it runs through and continues at its exit – the builder detects this by itself. The rim has to fit (high side 50, low side 40 – then uphill through the crossing). The crossing stands on the floor or on its height adapter.</p><p><b>Y merge:</b> two tracks join into one – the counterpart to the flip-flop. When you add it, you choose which inlet the track uses (shadows: the exit sits 16 mm to the right or left). The other inlet stays free: if another strand – say the branch of a flip-flop – plugs exactly into it (32 mm beside the track, same direction, same rim), it flows in there and ends; the ball carries on in the Y. „Connect …“ finds the way there by itself, too. The ball slows down in the Y (flat: to about 70 % of its speed); up to 0.8 m/s at the inlet it is calculated without losses. The Y stands on the floor or on its height adapter (AdapterYMerge120).</p>
     <p><b>Print in one piece:</b> Under “Print in one piece” choose your printer and switch on “Show the print plate and stay on it”: the plate appears in the 3D view, the track sits in its middle (turned by 90° if needed), and parts that would no longer fit are greyed out in the parts list. “Track in one piece (3MF)” downloads a file with <b>one</b> object: Bambu Studio fuses all track parts and adapters while slicing – no snap pins. Raised parts print with tree supports (build plate only). The lift and the flip-flop stay loose (moving parts) and lie on a plate of their own with their snap pins. The 3MF exports are unlocked with the print profile from MakerWorld: download it, drop it here – the builder takes the print parts from this file. It stays in this browser tab only (nothing is uploaded or stored); after reloading the page, drop it in again.</p>
     <p><b>Sharing:</b> “Copy link” packs the whole track into the URL. “Save JSON” for archiving, “BOM as CSV” for spreadsheets. The “profile plate list” tells you which plate of the print profile (every part exactly once) you need how many times.</p>`],
  famStart: ['Start', 'Start'], famStraight: ['Geraden', 'Straights'], famCurve: ['Kurven R24', 'Curves R24'], famLongCurve: ['Kurven R48', 'Curves R48'],
  famSpacer: ['Distanzstücke', 'Spacers'], famLevelChanger: ['Ebenenwechsler', 'Level changers'], famAttraction: ['Attraktionen', 'Attractions'],
  famBrake: ['Bremsen', 'Brakes'], famEnd: ['Ende', 'End'], famAdapter: ['Adapter', 'Adapters'],
  famPin: ['Raststifte', 'Snap pins'], famLift: ['Lift', 'Lift'], famLiftPart: ['Lift-Module', 'Lift modules'], famFlipflopPart: ['Kippwippe-Teile', 'Flip-flop parts'],
  liftName: ['Lift +{n} · {dir}', 'Lift +{n} · {dir}'],
  liftDir_straight: ['geradeaus', 'straight on'], liftDir_left: ['nach links', 'to the left'], liftDir_back: ['zurück', 'back'], liftDir_right: ['nach rechts', 'to the right'],
  liftTurn: ['Ausgang drehen', 'Turn exit'], liftUp: ['Eine Ebene höher', 'One level higher'], liftDown: ['Eine Ebene niedriger', 'One level lower'],
  flipflopSwap: ['Ausgang wechseln', 'Switch exit'], ymSwap: ['Eingang wechseln', 'Switch inlet'], flipflopKit: ['Bausatz: {list}', 'Kit: {list}'],
  liftKit: ['Fuß + {m} Mittelstück(e) + Kopf, {s} Schneckensegmente, Kurbel · {p} Raststifte im Lift', 'Bottom + {m} middle part(s) + top, {s} screw segments, crank · {p} snap pins inside the lift'],
  ringClosed: ['Rundkurs: Das Ende der Bahn steckt im Anfang – die Kugel läuft im Kreis (ein Raststift mehr).', 'Loop: the end of the track plugs into its start – the ball runs in circles (one more snap pin).'],
  sysChannel: ['Rinne', 'channel'], sysRail: ['Schiene', 'rails'], sysTunnel: ['Tunnel', 'tunnel'], sysAdapter: ['Adapter', 'adapter'], sysPin: ['Stift', 'pin'],
  why: ['Grund', 'why'], mirrored: ['gespiegelt', 'mirrored'], left: ['links', 'left'], right: ['rechts', 'right'],
  connStraight: ['Gerade{n}', 'Straight{n}'], connSpacer: ['Distanz{n}', 'Spacer{n}'], connCurve: ['Kurve R{r} {dir}', 'Curve R{r} {dir}'],
  connSlide: ['Rutsche {a}-{b} (Ebene −1)', 'Slide {a}-{b} (level −1)'], helpFooter: ['{n} Teile', '{n} parts'],
  asRight: ['Rechtskurve = {name} umgedreht eingebaut', 'right curve = {name} installed reversed'],
  asLeft: ['Linkskurve = {name} umgedreht eingebaut', 'left curve = {name} installed reversed'],
  ballEnd: ['Ankunft', 'arrival'],
  pinsHint: ['{f} Fugen · {t} Turmstufen · {r} Kopplungen', '{f} joints · {t} tower steps · {r} couplings'],
  // physics / chain
  notConnected: ['nicht angeschlossen', 'not connected'], noArrival: ['Kugel kommt nicht mehr an', 'ball does not arrive'],
  tooFast: ['zu schnell: {v} mm/s (höchstens {max})', 'too fast: {v} mm/s (at most {max})'], marginal: ['knapp: {v} mm/s (Grenze {max})', 'marginal: {v} mm/s (limit {max})'],
  tooSlow: ['zu langsam: {v} mm/s (mindestens {min})', 'too slow: {v} mm/s (at least {min})'],
  crestFail: ['kommt nicht über den Hügel ({dh} mm hoch) – mehr Schwung nötig', 'does not get over the hill ({dh} mm high) – needs more momentum'],
  liftOff: ['hebt oben am Hügel ab: {v} mm/s (höchstens {max})', 'lifts off at the top of the hill: {v} mm/s (at most {max})'],
  stops: ['Kugel bleibt liegen – das Gefälle reicht nicht', 'ball stops – not enough drop'],
  jointEnded: ['Kette ist beendet', 'track already ends'], noEntry: ['kein Eingang', 'no entry socket'],
  rimMismatch: ['braucht Rand {need}, Vorgänger liefert Rand {have}', 'needs rim {need}, previous part delivers rim {have}'],
  noFit: ['passt nicht', 'does not fit'], notConnectable: ['Teil hat keinen passenden Eingang', 'part has no matching entry'],
  levelBad: ['Ebene {S} ist kein Vielfaches von {L}', 'level {S} is not a multiple of {L}'],
  tooHigh: ['{n}. {name} steht auf Ebene {S} – höher als {max} mm baut der Builder keinen Adapterturm.', '{n}. {name} stands on level {S} – the builder does not stack adapter towers above {max} mm.'],
  collide: ['{a} und {b} überschneiden sich ({d} mm)', '{a} and {b} overlap ({d} mm)'],
  collideAdapter: ['{a} kollidiert mit {b} (Ebene {z}) unter Teil {n} ({d} mm)', '{a} collides with {b} (level {z}) under part {n} ({d} mm)'],
  collideStacks: ['Adaptertürme von Teil {a} und {b} überschneiden sich auf Ebene {z} ({d} mm)', 'adapter towers of parts {a} and {b} overlap on level {z} ({d} mm)'],
  crest: ['auf der Kuppe', 'on top'],
  replace: ['Ersetzen', 'Replace'], cancel: ['Abbrechen', 'Cancel'],
  modeReplace: ['Ersetze {n}. {name} – Teil links antippen', 'Replacing {n}. {name} – tap a part on the left'],
  modeInsert: ['Einfügen nach {n}. {name}', 'Inserting after {n}. {name}'], modeAppend: ['Anfügen am Ende', 'Appending at the end'],
  plates: ['Druckplatten', 'Print plates'], maxHours: ['max. Druckzeit je Platte', 'max. print time per plate'],
  onePiece: ['In einem Stück drucken', 'Print in one piece'], plateMode: ['Druckplatte zeigen und einhalten', 'Show the print plate and stay on it'],
  printerCustom: ['Eigene Größe', 'Custom size'], threeMfOne: ['Bahn in einem Stück (3MF)', 'Track in one piece (3MF)'],
  plateFits: ['Passt auf {name}: {x} × {y} × {z} mm{rot}', 'Fits on {name}: {x} × {y} × {z} mm{rot}'], plateRot: [' (um 90° gedreht)', ' (turned by 90°)'],
  plateOver: ['Zu groß für {name} ({x} × {y} × {z} mm): {list}', 'Too big for {name} ({x} × {y} × {z} mm): {list}'],
  overX: ['{v} mm zu breit', '{v} mm too wide'], overY: ['{v} mm zu tief', '{v} mm too deep'], overZ: ['{v} mm zu hoch', '{v} mm too tall'],
  plateBlock: ['passt nicht mehr auf die Platte ({name}): {list}', 'would no longer fit on the plate ({name}): {list}'],
  plateFix: ['Teile entfernen oder einen größeren Drucker wählen.', 'Remove parts or choose a bigger printer.'],
  plateLooseOut: ['{list} steht über den Plattenrand hinaus – kein Problem, druckt ohnehin separat.', '{list} reaches past the plate edge – no problem, it prints separately anyway.'],
  looseInfo: ['Lose, weil beweglich: {list} – auf eigener Platte, dazu {p} Raststifte für ihre Fugen.', 'Loose because they move: {list} – on a plate of their own, plus {p} snap pins for their joints.'],
  supportsInfo: ['Erhöhte Teile: in der Datei sind Baumstützen nur auf der Platte eingeschaltet.', 'Raised parts: the file switches on tree supports on the build plate only.'],
  onePieceEst: ['Richtwert: ca. {g} g, {h} h (Summe der Einzelteile ohne Raststifte – genau: in Bambu Studio slicen).', 'Estimate: about {g} g, {h} h (sum of the single parts without pins – exact: slice in Bambu Studio).'],
  onePieceEmpty: ['Noch keine Bahn.', 'No track yet.'],
  onePieceNote: ['Eine Datei, ein Objekt: Bambu Studio lädt alle Bahnteile und Adapter als Teile eines Objekts und verschweißt sie beim Slicen – ohne Raststifte, ohne Fugen, dafür nicht mehr zerlegbar. Lift und Kippwippe haben bewegliche Teile und bleiben lose. In Bambu Studio denselben Drucker einstellen. Von Hand geht es auch: Teile auf eine Platte, Rechtsklick „Verschmelzen“, Werkzeug „Zusammenbauen“ (Taste Y), „Zentrumsgleichheit“.',
                 'One file, one object: Bambu Studio loads all track parts and adapters as parts of one object and fuses them while slicing – no snap pins, no joints, but it no longer comes apart. The lift and the flip-flop have moving parts and stay loose. Choose the same printer in Bambu Studio. You can also do it by hand: parts on one plate, right-click “Merge”, the “Assemble” tool (key Y), “Center coincidence”.'],
  threeMfOneDone: ['Bahn in einem Stück: {n} Teile ✓', 'Track in one piece: {n} parts ✓'],
  keyTitle: ['Mit dem MakerWorld-Profil freischalten', 'Unlock with the MakerWorld profile'],
  keyText: ['Die 3MF-Exporte bauen auf dem Druckprofil von MakerWorld auf. Lade auf der Modellseite das Profil mit allen Teilen herunter („3MF herunterladen“) und zieh die Datei hierher. Aus dieser Datei holt der Builder die Druckteile für deine Bahn. Die Datei bleibt nur in diesem Browserfenster – sie wird nicht hochgeladen und nicht gespeichert. Nach dem Neuladen der Seite ziehst du sie einfach wieder hinein. Japandi und glatt haben je ein eigenes Profil.',
            'The 3MF exports are built from the MakerWorld print profile. On the model page, download the all-parts profile (“Download 3MF”) and drop the file here. The builder takes the print parts for your track from this file. The file stays in this browser tab only – it is neither uploaded nor stored. After reloading the page, just drop it in again. Japandi and plain each have their own profile.'],
  keyDrop: ['3MF hierher ziehen oder tippen zum Auswählen', 'Drop the 3MF here or tap to choose it'], keyPage: ['Zur Modellseite auf MakerWorld', 'Open the model page on MakerWorld'],
  keyChecking: ['Prüfe …', 'Checking …'], keyOk: ['Freigeschaltet: {t}', 'Unlocked: {t}'],
  keyState: ['MakerWorld-Profil: {t} (Stand {d}) ✓', 'MakerWorld profile: {t} (version {d}) ✓'], keyNone: ['🔒 3MF-Exporte: MakerWorld-Profil nötig', '🔒 3MF exports: MakerWorld profile needed'],
  keyAdd: ['Profil hinzufügen', 'Add profile'], keyRemove: ['entfernen', 'remove'], keyDev: ['Entwickler-Build: keine MakerWorld-Kennung nötig', 'Developer build: no MakerWorld ID needed'],
  keyTest: ['Testmodus: keine MakerWorld-Kennung nötig (7× aufs Logo beendet ihn)', 'Test mode: no MakerWorld ID needed (tap the logo 7× to end it)'],
  testOn: ['Testmodus an: keine MakerWorld-Kennung nötig – die Druckteile kommen weiter aus einer Profil-3MF', 'Test mode on: no MakerWorld ID needed – the print parts still come from a profile 3MF'],
  testOff: ['Testmodus aus: 3MF-Exporte wieder mit MakerWorld-Profil', 'Test mode off: 3MF exports need the MakerWorld profile again'],
  // print parts from the dropped print profile (meshes3mf.ts), kept in memory for this session only
  meshOk: ['Druckteile geladen: {ed}, {n} Teile – nur für diese Sitzung ✓', 'Print parts loaded: {ed}, {n} parts – this session only ✓'],
  meshAgain: ['Die Druckteile kommen aus der Profil-Datei und werden nicht gespeichert. Nach dem Neuladen der Seite bitte die 3MF noch einmal hierher ziehen.', 'The print parts come from the profile file and are not stored. After reloading the page, please drop the 3MF here again.'],
  meshOtherPlain: ['Dieses Profil ist die glatte Edition. Exportiere glatt – oder zieh das Japandi-Profil hierher.', 'This profile is the plain edition. Export plain – or drop the Japandi profile here.'],
  meshOtherJapandi: ['Dieses Profil ist die Japandi-Edition. Exportiere Japandi – oder zieh das glatte Profil hierher.', 'This profile is the Japandi edition. Export Japandi – or drop the plain profile here.'],
  meshSwitchPlain: ['Glatt exportieren', 'Export plain'], meshSwitchJapandi: ['Japandi exportieren', 'Export Japandi'],
  meshSwitched: ['Auf die glatte Edition umgestellt.', 'Switched to the plain edition.'], meshSwitchedJ: ['Auf die Japandi-Edition umgestellt.', 'Switched to the Japandi edition.'],
  mesh_noParts: ['In der Datei stecken nicht die Teile der 16-mm-Bahn ({d} erkannt). Bitte das Profil mit allen Teilen nehmen.', 'The file does not contain the parts of the 16 mm run ({d} recognised). Please use the all-parts profile.'],
  mesh_unknownEdition: ['Die Teile in der Datei passen weder zur Japandi- noch zur glatten Edition dieses Builders. Ist das Profil neuer als der Builder? Dann bitte den Builder neu laden.', 'The parts in this file match neither the Japandi nor the plain edition of this builder. Is the profile newer than the builder? Then please reload the builder.'],
  meshState: ['Druckteile (nur diese Sitzung): {list}', 'Print parts (this session only): {list}'],
  meshNone: ['Druckteile: Profil-3MF hierher ziehen (wird nicht gespeichert)', 'Print parts: drop the profile 3MF here (not stored)'],
  edJapandi: ['Japandi', 'Japandi'], edPlain: ['glatt', 'plain'],
  key_notZip: ['Das ist keine 3MF-Datei.', 'This is not a 3MF file.'], key_notThreeMf: ['In der Datei fehlt das 3D-Modell.', 'The file has no 3D model.'],
  key_notMakerWorld: ['Die Datei kommt nicht von MakerWorld (keine Designer-Kennung). Bitte das Druckprofil auf der Modellseite mit „3MF herunterladen“ holen.', 'The file is not from MakerWorld (no designer ID). Please get the print profile from the model page with “Download 3MF”.'],
  key_otherDesigner: ['Das Profil ist von einem anderen Designer ({d}).', 'This profile is by another designer ({d}).'],
  key_otherModel: ['Das ist ein anderes Modell ({d}).', 'This is a different model ({d}).'],
  key_tooFewParts: ['Das ist nicht das Profil mit allen Teilen der 16-mm-Bahn ({d} Teile erkannt).', 'This is not the all-parts profile of the 16 mm run ({d} parts recognised).'],
  key_outdated: ['Dieses Profil ist veraltet (Stand {d}). Bitte das aktuelle Profil herunterladen.', 'This profile is outdated (version {d}). Please download the current profile.'],
  planMd: ['Druckplan (Markdown)', 'Print plan (Markdown)'], threeMfAll: ['3MF alle Ebenen', '3MF all levels'], threeMfLevel: ['3MF Ebene {l}', '3MF level {l}'],
  platesNote: ['Bambu Lab A1 (256 mm). Platten je Standebene, tiefste Ebene zuerst, in Kettenreihenfolge; jedes Teil liegt wie im Druckprofil (aufrecht, Kurven 90°, gespiegelte 180°). Die Raststifte einer Ebene liegen hinter deren Teilen. Zeiten und Gewichte sind aus den geslicten Platten des Druckprofils geschätzt (0,20 mm, 15 % Gyroid, Adapter 10 %, ohne Stützen – Spirale und Loopings brauchen Stützen).',
               'Bambu Lab A1 (256 mm). Plates per level, lowest level first, in chain order; every part lies as in the print profile (upright, curves 90°, mirrored 180°). The snap pins of a level follow its parts. Times and weights are estimated from the sliced plates of the print profile (0.20 mm, 15 % gyroid, adapters 10 %, no supports – spiral and loops need supports).'],
  platesTotal: ['{n} Platten · {h} h · {kg} kg', '{n} plates · {h} h · {kg} kg'], tooBig: ['passt auf keine Platte', 'does not fit on a plate'],
  generating: ['3MF wird erzeugt …', 'generating 3MF …'],
  nothingToExport: ['Noch keine Teile in der Bahn – nichts zu exportieren.', 'No parts in the track yet – nothing to export.'], previewMeshNote: ['Achtung: nicht im Druckprofil, in der 3MF nur als grobes Vorschau-Netz – so nicht drucken: {list}. Lade das aktuelle Profil von der Modellseite.', 'Warning: not in the print profile, only a coarse preview mesh in the 3MF – do not print it like this: {list}. Download the current profile from the model page.'],
  uphillFail: ['Kugel schafft den Anstieg von {h} mm nicht (Teil ist bergauf eingebaut)', 'ball cannot climb the {h} mm rise (part is installed uphill)'],
  loadFailed: ['Datei konnte nicht gelesen werden (kein Kugelbahn-16-JSON)', 'file could not be read (not a 16 mm marble-run JSON)'],
  loadSkipped: ['{n} unbekannte Teile übersprungen', '{n} unknown parts skipped'],
  threeMfTitleAll: ['Kugelbahn 16 mm{ed} alle Ebenen', 'Marble run 16 mm{ed} all levels'], threeMfTitleOne: ['Kugelbahn 16 mm{ed} in einem Stück', 'Marble run 16 mm{ed} in one piece'], threeMfTitleLevel: ['Kugelbahn 16 mm{ed} Ebene {l}', 'Marble run 16 mm{ed} level {l}'],
  planTitle: ['Kugelbahn 16 mm{ed} – Druckplan', 'Marble run 16 mm{ed} – print plan'],
  shareFallback: ['Link zum Kopieren:', 'Link to copy:'], meshError: ['3D-Mesh', '3D mesh'],
  csvHeader: ['Teil;Anzahl;Filament_g;Druckzeit_h;Typ', 'Part;Qty;Filament_g;PrintTime_h;Type'], csvSum: ['SUMME', 'TOTAL'], csvFilament: ['Filament', 'Filament'],
  mdHeader: ['Bambu Lab A1 · max. {h} h je Platte · Lage wie im Druckprofil (aufrecht, Kurven 90°, gespiegelte 180°) · 0,20 mm, ohne Stützen', 'Bambu Lab A1 · max. {h} h per plate · orientation as in the print profile (upright, curves 90°, mirrored 180°) · 0.20 mm, no supports'],
  mdCols: ['| Ebene | Platten | Teile | Zeit | Filament |', '| Level | Plates | Parts | Time | Filament |'], mdSum: ['Summe', 'Total'],
  mdLevel: ['Ebene {l} mm', 'Level {l} mm'], mdPlateCols: ['| Platte | Zeit | Filament | Teile (# = Position in der Kette) |', '| Plate | Time | Filament | Parts (# = position in the chain) |'],
  mdTooBig: ['Passt auf keine Platte: ', 'Does not fit on any plate: '],
  // adapter slots: tunnel swap and omit (freestyle tunnel)
  noAdapter: ['{n}. {name} steht auf Ebene {S}, aber für dieses Teil gibt es keinen Adapter im Sortiment – es kann nur auf Ebene 0 stehen', '{n}. {name} stands on level {S}, but there is no adapter for this part in the set – it can only stand on level 0'],
  adapterSlots: ['Adapter unter diesem Teil', 'Adapters under this part'],
  slotOmitted: ['weggelassen', 'omitted'], btnTunnel: ['Tunnel', 'Tunnel'], btnOmit: ['Weglassen', 'Omit'], btnRestore: ['Wieder einsetzen', 'Restore'],
  omitHeld: ['{n}. {name}: {type} auf Ebene {z} weggelassen (Freestyle-Tunnel) – das darüber hängt an seinen Nachbarn', '{n}. {name}: {type} on level {z} omitted (freestyle tunnel) – what sits above hangs on its neighbours'],
  omitFree: ['{n}. {name}: {type} auf Ebene {z} weggelassen, aber nichts hält das darüber (kein Nachbar auf derselben Ebene gesteckt) – so steht es nicht', '{n}. {name}: {type} on level {z} omitted, but nothing holds what sits above (no neighbour plugged in on that level) – it will not stand'],
  tunnelNoVariant: ['{type} hat keine Tunnel-Version (nur AdapterGerade120, AdapterGerade100 und AdapterGerade95)', '{type} has no tunnel version (only AdapterStraight120, AdapterStraight100 and AdapterStraight95)'],
  tunnelNothingCrosses: ['unter diesem Adapter (Ebene {z}) kreuzt keine Bahn – nichts zu tunneln', 'no track crosses under this adapter (level {z}) – nothing to tunnel'],
  tunnelNotStraight: ['{n}. {name} kreuzt den Adapter, ist aber keine gerade Rand-40-Strecke – der Quertunnel braucht eine Rinnen- oder Schienengerade auf Rand 40', '{n}. {name} crosses the adapter but is not a straight rim-40 run – the cross tunnel needs a channel or rail straight on rim 40'],
  tunnelNotAcross: ['{n}. {name} läuft nicht quer zum Adapter – der Quertunnel geht nur im rechten Winkel', '{n}. {name} does not run across the adapter – the cross tunnel only works at a right angle'],
  tunnelNoFit: ['die Bahn kreuzt {c} mm ab dem Adapteranfang; die Tunnel-Versionen haben ihre Fahrspur bei: {list}. Untere Strecke um die Differenz verschieben (andere Gerade oder Distanzstück).', 'the track crosses {c} mm from the start of the adapter; the tunnel versions have their lane at: {list}. Shift the lower run by the difference (another straight or a spacer).'],
  tunnelAtEdge: ['der Adapter kreuzt {d} mm ab Anfang der geraden Strecke ({L} mm lang) – der 32-mm-Quertunnel ragt über ihr Ende hinaus', 'the adapter crosses {d} mm from the start of the straight run ({L} mm long) – the 32 mm cross tunnel would stick out past its end'],
  tunnelNoSpacers: ['für die Reststücke {a} mm und {b} mm gibt es keine Distanz-Kombination (±0,6 mm; Distanzstücke 24,5 / 34,7, Schiene 50,7)', 'no spacer combination hits the remaining {a} mm and {b} mm (±0.6 mm; spacers 24.5 / 34.7, rail 50.7)'],
  tunnelShiftAfter: ['Der Rest der Bahn rückt dabei um {mm} mm (die Füllstücke treffen die alte Länge nicht genau).', 'The rest of the track moves by {mm} mm (the filler pieces cannot match the old length exactly).'],
  tunnelShift: ['Automatik: gerade Strecke {seg} um {mm} mm verändert (Geraden/Distanzstücke), damit die Kreuzung auf die Tunnel-Fahrspur trifft.', 'Auto: straight run {seg} changed by {mm} mm (straights/spacers) so the crossing hits the tunnel lane.'],
  tunnelAutoFail: ['Automatisch ließ sich keine Strecke davor passend verschieben (keine gerade Strecke längs der Adapterachse oder keine Distanz-Kombination).', 'Could not shift a preceding run automatically (no straight run along the adapter axis, or no spacer combination).'],
  tunnelDone: ['{tunnel} eingesetzt: {n} Teil(e) der unteren Bahn durch {m} ersetzt (davor {a}, danach {b})', '{tunnel} inserted: {n} part(s) of the lower track replaced by {m} (before: {a}, after: {b})'],
  // profile plate list (print profile: every part exactly once on its plate)
  mwList: ['Profil-Plattenliste', 'Profile plate list'],
  mwListTitle: ['Modular Marble Run 16 mm{ed} – Plattenliste für diese Bahn', 'Modular Marble Run 16 mm{ed} – plate list for this track'],
  mwListIntro: ['Das Druckprofil ({file}) enthält jedes Teil genau einmal, nach Familien auf Platten verteilt. Für diese Bahn: die Platte in Bambu Studio öffnen, das Teil so oft auf eine freie Platte kopieren, wie hier steht, und nur diese Platte drucken. Zuerst Platte 01 (Passprobe) je Filament; Raststifte (Platte 02) entsprechend vervielfachen.',
               'The print profile ({file}) contains every part exactly once, grouped by family on plates. For this track: open the plate in Bambu Studio, copy the part onto a free plate as many times as listed here, and print only that plate. Print plate 01 (fit test) first for every filament; multiply the snap pins (plate 02) accordingly.'],
  mwCols: ['| Platte | Teil | Stück |', '| Plate | Part | Qty |'],
  mwNotReleased: ['Nicht im Druckprofil:', 'Not in the print profile:'],
  // parts list by base part, direction choice, branches
  grp_start: ['Start-Schale', 'Start cup'], grp_straight: ['Gerade', 'Straight'], grp_curve: ['Kurve R24', 'Curve R24'], grp_longCurve: ['Kurve R48', 'Curve R48'],
  grp_spacer: ['Distanzstück', 'Spacer'], grp_brake: ['Schienenbremse', 'Rail brake'], grp_slide: ['Rutsche', 'Slide'], grp_spiral: ['Spirale', 'Spiral'],
  grp_funnel: ['Trichter', 'Funnel'], grp_zigzag: ['Zickzack', 'Zigzag'], grp_lift: ['Lift', 'Lift'], grp_flipflop: ['Kippwippe', 'Flip-flop'], grp_ymerge: ['Y-Merge', 'Y merge'],
  grp_crossing: ['X-Kreuzung', 'X crossing'], grp_crossTunnel: ['Quertunnel', 'Cross tunnel'], grp_hill: ['Hügel', 'Hill'], grp_loop: ['Looping', 'Loop'],
  grp_offset: ['Versatz', 'Offset'], grp_end: ['End-Schale', 'End cup'],
  chip_all: ['Alle', 'All'], chip_straight: ['Geraden', 'Straights'], chip_curve: ['Kurven', 'Curves'], chip_level: ['Ebenen', 'Levels'], chip_special: ['Spezial', 'Special'], chip_startEnd: ['Start/Ende', 'Start/End'],
  dim_kind: ['Ausführung', 'Style'], dim_len: ['Länge', 'Length'], dim_rim: ['Rand (Einlauf → Auslauf)', 'Rim (in → out)'], dim_type: ['Typ', 'Type'], dim_h: ['Höhe (Ebenen)', 'Height (levels)'], dim_cross: ['Querspur', 'Cross lane'],
  dir_left: ['links', 'left'], dir_right: ['rechts', 'right'], dir_straight: ['geradeaus', 'straight on'], dir_back: ['zurück', 'back'],
  dirHint: ['Richtung wählst du beim Einbauen (Schatten im 3D)', 'You choose the direction when placing (shadows in 3D)'],
  addPart: ['Einbauen', 'Add'], untestedTag: ['ungeprüft', 'untested'], uphillTag: ['bergauf', 'uphill'],
  openEnd: ['Offenes Ende: Rand {rim} · Ebene {lvl}', 'Open end: rim {rim} · level {lvl}'],
  // grid helpers: grid at the open end, loop almost closed, tunnel lanes, connect
  gridLine: ['Raster: längs {a} · quer {q}', 'Grid: along {a} · sideways {q}'],
  gridOn: ['im Raster', 'on grid'],
  gridThird: ['⅓ bis zum Raster (Distanz65 oder Gerade80)', '⅓ to the grid (Distanz65 or Gerade80)'],
  gridTwoThirds: ['⅔ bis zum Raster (Gerade100)', '⅔ to the grid (Gerade100)'],
  gridOff: ['{d} mm neben dem Raster', '{d} mm off the grid'],
  gridAcrossThird: ['⅓ daneben (nach einer Kurve ausgleichen)', '⅓ off (compensate after a curve)'],
  gridHelp: ['8-mm-Raster ab dem ersten Teil. Im Raster passen Rundkurs, Quertunnel und X-Kreuzung genau. Gerade80 und Distanz65 verschieben um ⅓, Gerade100 um ⅔.', '8 mm grid from the first part. On the grid, loops, cross tunnels and the X crossing fit exactly. Gerade80 and Distanz65 shift by ⅓, Gerade100 by ⅔.'],
  nearRing: ['Rundkurs fast zu: das Ende liegt Δx {dx} · Δy {dy} mm neben dem Eingang des ersten Teils.', 'Loop almost closed: the end is Δx {dx} · Δy {dy} mm off the entrance of the first part.'],
  tunnelLanesHint: ['Darunter ist Platz für einen 32-mm-Quertunnel: Fahrspuren bei {xs} mm (im 3D am Boden markiert). Zufahrt im Raster, z. B. mit „Verbinden“.', 'There is room for a 32 mm cross tunnel below: lanes at {xs} mm (marked on the floor in 3D). Approach on the grid, e.g. with “Connect”.'],
  btnConnect: ['Verbinden …', 'Connect …'],
  connectTitle: ['Verbinden: offenes Ende an ein Ziel führen', 'Connect: lead the open end to a target'],
  connectIntro: ['Kürzeste Teilefolgen aus Geraden, Distanzstücken, Kurven und Rutschen, die genau am Ziel ankommen (geprüft auf Kollisionen). Danach den Kugel-Check ansehen.', 'Shortest part sequences of straights, spacers, curves and slides that arrive exactly at the target (checked for collisions). Check the ball run afterwards.'],
  connectRing: ['Rundkurs: zurück in den Eingang von 1. {name}', 'Loop: back into the entrance of 1. {name}'],
  connectMerge: ['Freier Eingang von {n}. {name}', 'Free inlet of {n}. {name}'],
  connectLane: ['Freie Querspur von {n}. {name}', 'Free cross lane of {n}. {name}'],
  connectTunnel: ['Quertunnel unter {n}. {name} (Ebene {z})', 'Cross tunnel under {n}. {name} (level {z})'],
  connectNoTargets: ['Kein Ziel: Rundkurs braucht ein erstes Teil mit Eingang (z. B. Lift), sonst eine freie Querspur oder einen 120er/95er-Adapter tiefer als das offene Ende.', 'No target: a loop needs a first part with an entrance (e.g. a lift), otherwise a free cross lane or a 120/95 adapter below the open end.'],
  connectSearching: ['Suche …', 'Searching …'],
  connectNone: ['Keine Teilefolge gefunden (bis {n} Teile). Liegt das Ende neben dem Raster, zuerst mit Distanz65, Gerade80 oder Gerade100 ausgleichen.', 'No part sequence found (up to {n} parts). If the end is off the grid, compensate first with Distanz65, Gerade80 or Gerade100.'],
  connectApply: ['Einbauen', 'Add'],
  connectDone: ['{n} Teile eingebaut.', '{n} parts added.'],
  connectDoneTunnel: ['{n} Teile und {tunnel} eingebaut.', '{n} parts and {tunnel} added.'],
  connectStops: ['Achtung: im Kugel-Check bleibt die Kugel stehen – mehr Gefälle einplanen.', 'Note: in the ball check the ball stops – plan more drop.'],
  connectParts: ['{n} Teile', '{n} parts'],
  strandMain: ['Hauptstrang', 'Main strand'], strandBranch: ['Abzweig {k} · ab {n}. {name}', 'Branch {k} · from {n}. {name}'],
  portCross: ['Ausgang der Querspur', 'exit of the cross lane'], portSecond: ['zweiter Ausgang ({side})', 'second exit ({side})'],
  modeChoose: ['{name}: Richtung im 3D wählen (Schatten anklicken)', '{name}: choose the direction in 3D (click a shadow)'],
  modeContinue: ['Weiterbauen am Ende: {strand}', 'Continuing at the end: {strand}'],
  modeBranch: ['Neuer Abzweig an {n}. {name} – {port}', 'New branch at {n}. {name} – {port}'],
  chooseDir: ['Richtung:', 'Direction:'], dirAuto: ['Richtung {dir} – nur dort ist Platz.', 'Direction {dir} – the only one with room.'],
  dirSwitch: ['Richtung wechseln', 'Switch direction'],
  branchRemoved: ['{n} Teile im Abzweig mit entfernt (Rückgängig holt sie zurück).', '{n} parts of the branch removed as well (Undo brings them back).'],
  continueStrand: ['weiterbauen', 'continue'], viaShort: ['durch {n}.', 'through {n}.'], mergeShort: ['mündet in {n}.', 'flows into {n}.'],
  gotoBranch: ['Zum Abzweig {k}', 'Go to branch {k}'], buildBranch: ['Abzweig bauen: {port}', 'Build branch: {port}'],
  laneUsed: ['Querspur: befahren von {n}. {name}', 'Cross lane: used by {n}. {name}'],
  mergeUsed: ['Freier Eingang: hier mündet {n}. {name}', 'Free inlet: {n}. {name} flows in here'],
  mergeFree: ['Zweiter Eingang frei – ein anderer Strang kann hier münden (genau hineinstecken: 32 mm neben der Bahn, gleiche Richtung, gleicher Rand).', 'Second inlet free – another strand can flow in here (plug in exactly: 32 mm beside the track, same direction, same rim).'],
  mergeIn: ['Mündet in den freien Eingang von {n}. {name}.', 'Flows into the free inlet of {n}. {name}.'],
  mergeFast: ['Mündet mit {v} mm/s in {n}. (Y-Merge) – gerechnet bis {max} mm/s.', 'Flows into {n}. (Y merge) at {v} mm/s – calculated up to {max} mm/s.'],
  mergeBall: ['Kugel aus dem Zulauf von {n}.: {msg}', 'Ball from the feed at {n}.: {msg}'],
  laneFree: ['Querspur frei – ein anderer Strang kann hindurchfahren (genau in ihren Eingang stecken).', 'Cross lane free – another strand can run through (plug exactly into its entrance).'],
  branchLost: ['Abzweig ohne Anschluss: das Teil, an dem er beginnt, fehlt oder hat dort keinen freien Ausgang.', 'Branch without connection: the part it starts at is missing or has no free exit there.'],
  passThrough: ['Fährt durch die Querspur von {n}. {name}.', 'Runs through the cross lane of {n}. {name}.'],
  laneRim: ['Steckt in der Querspur von {n}., aber der Rand passt nicht (braucht {need}, kommt {have}).', 'Plugs into the cross lane of {n}., but the rim does not fit (needs {need}, has {have}).'],
  laneNoFeed: ['Diese Spur hat keinen Zulauf – gerechnet mit dem Anschubs.', 'This lane has no feed – calculated with the push.'],
  laneStops: ['Die Kugel bleibt in der Querspur von {n}. liegen.', 'The ball stops in the cross lane of {n}.'],
  paletteEnded: ['Die Bahn endet mit einer EndSchale. Zum Weiterbauen die EndSchale löschen oder ein Teil markieren und „Danach einfügen“ wählen.', 'The track ends with an EndCup. Delete it or select a part and choose “Insert after” to continue building.'],
  paletteNone: ['Kein Teil passt an das offene Ende (Randhöhe) – oder der Filter blendet es aus. „nur passende“ abschalten oder den Chip „Alle“ wählen.', 'No part fits the open end (rim height) – or the filter hides it. Untick “compatible only” or choose the “All” chip.'],
};
const LANG_KEY = 'kb16-lang';
function initialLang(): Lang {
  try { const s = localStorage.getItem(LANG_KEY); if (s === 'de' || s === 'en') return s; } catch { /* no storage */ }
  return 'en';
}
let lang: Lang = initialLang();
/** Sets the language; remembered in localStorage when possible. */
export function setLang(l: Lang) { lang = l; try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } }
export function getLang(): Lang { return lang; }
/** All text keys (for tests). */
export const T_KEYS: string[] = Object.keys(T);
export function t(key: string): string { const e = T[key]; return e ? (lang === 'de' ? e[0] : e[1]) : key; }
export function tf(key: string, params: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(params)) s = s.split('{' + k + '}').join(String(v));
  return s;
}
/** Part name in the active language: the catalog ID in German, the published name in English. */
export function partName(p: Part | { id: string; nameEn?: string }): string { return lang === 'en' && p.nameEn ? p.nameEn : p.id; }
/** Display name of a lift: "Lift +2 · straight on" (height in levels, exit direction). */
export function liftName(p: Part): string { return p.lift ? tf('liftName', { n: p.lift.n, dir: t('liftDir_' + p.lift.dir) }) : partName(p); }
/** Number with a decimal comma (de) or point (en). */
export function num(v: number, d = 1): string { const s = v.toFixed(d); return lang === 'de' ? s.replace('.', ',') : s; }
/** Picks the text of the active language from a bilingual field (de/en). */
export function pick(de: string | undefined, en: string | undefined): string { return (lang === 'de' ? de : en) || de || en || ''; }
