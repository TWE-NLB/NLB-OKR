# -*- coding: utf-8 -*-
"""Ergänzt Brodmann-Areale bzw. Pons/Medulla/Mesencephalon/Cerebellum bei Hirnbereichen.
Die vom Nutzer bearbeiteten Absätze in Kapitel 3 (Großhirnrinde, Vestibulariskerne, Sakkaden-Generatoren,
Augenmuskelkerne) werden nicht verändert."""
import sys
from docx import Document

PATH = sys.argv[1]
doc = Document(PATH)
P = doc.paragraphs
T = doc.tables
MES, PON, CER = "Mesencephalon", "Pons", "Cerebellum"

# (Absatz-Startstext zur Sicherheit, alt, neu)
PARA = [
    ("Look-OKN aktiviert", "mehr Hirnrinde als", "mehr Hirnrinde (v. a. Scheitel-, Schläfen- und Hinterhauptslappen: BA7, BA19, BA21, BA39/40) als"),
    ("Look-OKN aktiviert", "von Hirnstamm und Kleinhirn gesteuert", f"von Hirnstamm ({MES}, {PON}, Medulla) und Kleinhirn ({CER}) gesteuert"),
    ("Prätektum (NOT/DTN)", "im Prätektum, am Übergang", f"im Prätektum ({MES}), am Übergang"),
    ("Kleinhirn: Flocculus", "Kleinhirn:", f"Kleinhirn ({CER}):"),
    ("waagerecht in der paramedianen", "der Brücke", f"der Brücke ({PON})"),
    ("senkrecht im rostralen", "im Mittelhirn", f"im Mittelhirn ({MES})"),
    ("Laufen die Streifen nach rechts", "von der PPRF auf", f"von der PPRF ({PON}) auf"),
    ("Eingang:", "NOT/DTN [", f"NOT/DTN ({MES}) ["),
    ("Eingang:", "MT/MST [", "MT/MST (BA19/37) ["),
    ("Verarbeitung:", "Vestibulariskerne und Geschwindigkeitsspeicher [", f"Vestibulariskerne (Medulla, {PON}) und Geschwindigkeitsspeicher (Medulla, {PON}, {CER}) ["),
    ("Verarbeitung:", "Kleinhirn (Uvula, Pyramis, Flocculus)", f"Kleinhirn ({CER}: Uvula, Pyramis, Flocculus)"),
    ("Kleinhirn: Patienten", "Kleinhirn:", f"Kleinhirn ({CER}):"),
    ("Kleinhirndegeneration:", "Kleinhirndegeneration:", f"Kleinhirndegeneration ({CER}):"),
    ("Gleiche Person: Sinkt der Gain", "(Kleinhirn, Alter)", f"(Kleinhirn/{CER}, Alter)"),
    ("Beteiligt: Vor allem das schnelle", "kortikale Bewegungsareale, Brückenkerne und Flocculus", f"kortikale Bewegungsareale (BA19/37), Brückenkerne ({PON}) und Flocculus ({CER})"),
    ("Messung beim Menschen:", "in der Brücke (NRTP, PPRF)", f"in der Brücke ({PON}: NRTP, PPRF)"),
    ("Messung beim Menschen:", "Kleinhirntonsillen", f"Kleinhirntonsillen ({CER})"),
    ("Waagerechte Rücksprünge:", "PPRF in der Brücke", f"PPRF in der Brücke ({PON})"),
    ("Senkrechte Rücksprünge:", "riMLF im Mittelhirn.", f"riMLF im Mittelhirn ({MES})."),
    ("Neglect:", "nach Schäden der rechten Hirnhälfte", "nach Schäden der rechten Hirnhälfte (Neglect entsteht typischerweise bei Schäden im rechten unteren Scheitellappen, BA39/40)"),
    ("Beteiligt: Sakkaden-Generatoren", "Sakkaden-Generatoren (PPRF, riMLF) und Augenmuskelkerne", f"Sakkaden-Generatoren (PPRF: {PON}; riMLF: {MES}) und Augenmuskelkerne (III, IV: {MES}; VI: {PON})"),
    ("Schlagfeld:", "der Sehrinde", "der Sehrinde (BA17/18)"),
    ("Prätektum: Nach Schäden", "Prätektum:", f"Prätektum ({MES}):"),
    ("Großhirnrinde: Nach Schäden", "des frontalen Augenfelds und des hinteren Scheitellappens", "des frontalen Augenfelds (BA8, Übergang zu BA6) und des hinteren Scheitellappens (BA7, BA39/40)"),
    ("Hirnhälfte: Bei Schäden der ganzen", "reinen Scheitellappen-Läsionen", "reinen Scheitellappen-Läsionen (BA7, BA39/40)"),
    ("Internukleäre Ophthalmoplegie:", "des medialen Längsbündels", f"des medialen Längsbündels (MLF; {PON}/{MES})"),
    ("Senkrechte Blickzentren:", "im Mittelhirn [", f"im Mittelhirn ({MES}) ["),
    ("PSP: Der senkrechte Gain", "auf das Mittelhirn hin", f"auf das Mittelhirn ({MES}) hin"),
    ("riMLF: Schon", "riMLF:", f"riMLF ({MES}):"),
    ("Nach Ende der Streifenbewegung", "in Vestibulariskernen und Kleinhirn", f"in Vestibulariskernen (Medulla, {PON}) und Kleinhirn ({CER})"),
    ("Nach Ende der Streifenbewegung", "an NOT/DTN war", f"an NOT/DTN ({MES}) war"),
    ("Hirnstamm und Kleinhirn intakt:", "nicht in Hirnstamm oder Kleinhirn", f"nicht in Hirnstamm ({PON}, Medulla) oder Kleinhirn ({CER})"),
    ("Bestätigung:", "das Kleinhirn als Ursache", f"das Kleinhirn ({CER}) als Ursache"),
]

# (Tabellenkopf erste Zelle, Zeile, Spalte, alt, neu)
CELL = [
    ("Augenbewegung", 1, 2, "rechts VI, links III", f"rechts VI ({PON}), links III ({MES})"),
    ("Augenbewegung", 2, 2, "links VI, rechts III", f"links VI ({PON}), rechts III ({MES})"),
    ("Augenbewegung", 3, 2, "III", f"III ({MES})"),
    ("Augenbewegung", 4, 2, "III und IV", f"III und IV ({MES})"),
    ("Augenbewegung", 1, 3, "Abducens-Interneurone über", f"Abducens-Interneurone ({PON}) über"),
    ("Augenbewegung", 3, 3, "Nucleus interstitialis Cajal", f"Nucleus interstitialis Cajal ({MES})"),
    ("Augenbewegung", 4, 3, "riMLF [", f"riMLF ({MES}) ["),
    ("Muster im Vergleich", 1, 2, "Kleinhirn (Uvula, Pyramis)", f"Kleinhirn ({CER}: Uvula, Pyramis)"),
    ("Muster im Vergleich", 2, 2, "NOT/DTN der Seite", f"NOT/DTN ({MES}) der Seite"),
    ("Muster im Vergleich", 2, 2, "frontales Augenfeld / hinterer Scheitellappen", "frontales Augenfeld (BA8/6) / hinterer Scheitellappen (BA7, BA39/40)"),
    ("Muster im Vergleich", 3, 2, "Basalganglien-Einfluss", f"Basalganglien-Einfluss (subkortikal; Substantia nigra im {MES})"),
    ("Muster im Vergleich", 4, 2, "Mittelhirn: riMLF", f"Mittelhirn ({MES}): riMLF"),
    ("Muster im Vergleich", 5, 2, "Brücke: PPRF", f"Brücke ({PON}): PPRF"),
    ("Muster im Vergleich", 6, 2, "kortikale Augenfelder bei", "kortikale Augenfelder (BA8/6, BA7/40) bei"),
    ("Muster im Vergleich", 7, 2, "Brückenkerne, Flocculus, Uvula", f"Brückenkerne ({PON}), Flocculus, Uvula ({CER})"),
    ("Begriff", 6, 1, "im Prätektum", f"im Prätektum ({MES})"),
    ("Begriff", 7, 1, "Bewegungsareale der Großhirnrinde", "Bewegungsareale der Großhirnrinde (BA19/37)"),
    ("Begriff", 8, 1, "(Brücke)", f"(Brücke, {PON})"),
    ("Begriff", 9, 1, "(Mittelhirn)", f"(Mittelhirn, {MES})"),
    ("Begriff", 10, 1, "verbindet Abducens- und Okulomotoriuskern", f"verbindet Abducens- ({PON}) und Okulomotoriuskern ({MES})"),
    ("Begriff", 11, 1, "Teile des Kleinhirns,", f"Teile des Kleinhirns ({CER}),"),
    ("Begriff", 12, 1, "in Vestibulariskernen und Kleinhirn", f"in Vestibulariskernen (Medulla, {PON}) und Kleinhirn ({CER})"),
]


def replace(par, old, new):
    runs = par.runs
    for r in runs:
        if old in r.text:
            r.text = r.text.replace(old, new, 1)
            return True
    # Treffer über mehrere Runs: Text im ersten Run ersetzen, Rest aus den Folge-Runs entfernen
    full = "".join(r.text for r in runs)
    pos = full.find(old)
    if pos < 0:
        return False
    end = pos + len(old)
    offset = 0
    first = True
    for r in runs:
        t = r.text
        a, b = offset, offset + len(t)
        offset = b
        if b <= pos or a >= end:
            continue
        s0, s1 = max(pos, a) - a, min(end, b) - a
        if first:
            r.text = t[:s0] + new + t[s1:]
            first = False
        else:
            r.text = t[:s0] + t[s1:]
    return True


fails = []
for start, old, new in PARA:
    hits = [p for p in P if p.text.startswith(start) and old in p.text]
    if len(hits) != 1 or not replace(hits[0], old, new):
        fails.append(("P", start, old, len(hits)))

for head, ri, ci, old, new in CELL:
    tabs = [t for t in T if t.rows[0].cells[0].text.strip() == head]
    ok = False
    if len(tabs) == 1:
        cell = tabs[0].rows[ri].cells[ci]
        for par in cell.paragraphs:
            if old in par.text and replace(par, old, new):
                ok = True
                break
    if not ok:
        fails.append(("T", head, ri, ci, old))

doc.save(PATH)
print("Ersetzungen:", len(PARA) + len(CELL) - len(fails), "Fehlgeschlagen:", fails)
