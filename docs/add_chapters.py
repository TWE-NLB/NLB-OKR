# -*- coding: utf-8 -*-
"""Fügt zwei Kapitel in die (vom Nutzer bearbeitete) Dokumentation ein, ohne den Rest zu verändern."""
import sys, copy
import xml.etree.ElementTree as ET
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

PATH, XML = sys.argv[1], sys.argv[2]
INK2 = RGBColor(0x4E, 0x5A, 0x62)
doc = Document(PATH)
body = doc.element.body

# ---------------- neue Literatur aus PubMed-XML (Nr. 40 ff.)
NEW = ["33261980", "42083826", "3364526", "35094959", "2928068", "34430740", "1641224", "19224351",
       "25846907", "17572783", "1477052", "9183269", "28815321", "15090875", "21842408", "26998716"]
root = ET.parse(XML).getroot()
info = {}
for art in root.findall(".//PubmedArticle"):
    pmid = art.findtext(".//PMID"); a = art.find(".//Article")
    au = [(x.findtext("LastName") or "") + " " + (x.findtext("Initials") or "") for x in a.findall("AuthorList/Author")]
    au = ", ".join(au[:3]) + (" et al." if len(au) > 3 else "")
    yr = a.findtext("Journal/JournalIssue/PubDate/Year") or (a.findtext("Journal/JournalIssue/PubDate/MedlineDate") or "")[:4]
    title = "".join(a.find("ArticleTitle").itertext()).strip()
    j = a.findtext("Journal/ISOAbbreviation"); vol = a.findtext("Journal/JournalIssue/Volume") or ""
    iss = a.findtext("Journal/JournalIssue/Issue"); pg = a.findtext("Pagination/MedlinePgn") or ""
    src = f"{j} {vol}" + (f"({iss})" if iss else "") + (f":{pg}" if pg else "")
    ids = {x.get("IdType"): x.text for x in art.findall(".//PubmedData/ArticleIdList/ArticleId")}
    info[pmid] = (f"{au} ({yr}). {title} {src}.", ids.get("doi"), ids.get("pmc"))
NUM = {p: 40 + i for i, p in enumerate(NEW)}
# Bestehende Literatur (Nr. 1–39), die in den neuen Kapiteln zitiert wird
OLD = {"18235002": 2, "15864563": 3, "15548816": 9, "16122840": 11}


def R(pmid, sec="Abstract"):
    return f"[{NUM.get(pmid) or OLD[pmid]}, {sec}]"


# ---------------- Bausteine (am Dokumentende erzeugen, danach verschieben)
LIST = {"id": None}


def new_num_id():
    numbering = doc.part.numbering_part.numbering_definitions._numbering
    num_id = doc.styles["List Number"].element.pPr.numPr.numId.val
    abstract_id = numbering.num_having_numId(num_id).abstractNumId.val
    num = numbering.add_num(abstract_id)
    num.add_lvlOverride(ilvl=0).add_startOverride(1)
    return num.numId


def H(text, level):
    LIST["id"] = None
    doc.add_heading(text, level=level)


def P(text, lead=None):
    p = doc.add_paragraph()
    if lead:
        p.add_run(lead).bold = True
    p.add_run(text)


def B(text, lead=None):
    p = doc.add_paragraph(style="List Bullet")
    if lead:
        p.add_run(lead).bold = True
    p.add_run(text)
    p.paragraph_format.space_after = Pt(3)


def N(text, lead=None):
    p = doc.add_paragraph(style="List Number")
    if LIST["id"] is None:
        LIST["id"] = new_num_id()
    numPr = p._p.get_or_add_pPr().get_or_add_numPr()
    numPr.get_or_add_ilvl().val = 0
    numPr.get_or_add_numId().val = LIST["id"]
    if lead:
        p.add_run(lead).bold = True
    p.add_run(text)
    p.paragraph_format.space_after = Pt(3)


def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def T(header, rows, widths):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER; t.autofit = False
    for i, h in enumerate(header):
        c = t.rows[0].cells[i]; c.text = ""
        r = c.paragraphs[0].add_run(h); r.bold = True; r.font.size = Pt(9.5); r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        shade(c, "1E5A7A")
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            para = cells[i].paragraphs[0]
            if i == 0:
                rr = para.add_run(v); rr.bold = True
            else:
                rr = para.add_run(v)
            rr.font.size = Pt(9.5)
            para.paragraph_format.space_after = Pt(0)
            if ri % 2 == 1:
                shade(cells[i], "EEF3F5")
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
    trPr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement("w:tblHeader"); th.set(qn("w:val"), "true"); trPr.append(th)
    doc.add_paragraph()


def note(text, lead):
    t = doc.add_table(rows=1, cols=1); t.style = "Table Grid"
    c = t.rows[0].cells[0]; shade(c, "FFF4DC"); c.text = ""
    p = c.paragraphs[0]
    r = p.add_run(lead); r.bold = True; r.font.size = Pt(10)
    r2 = p.add_run(text); r2.font.size = Pt(10)
    c.width = Cm(16.6)
    doc.add_paragraph()


# ---------------- Anker: Überschrift „8 Literatur“
anchor = next(p for p in doc.paragraphs if p.style.name == "Heading 1" and p.text.strip().endswith("Literatur"))
before = list(body)

# ================= Kapitel 8: Vorher-nachher-Messung
H("8 Vorher-nachher-Messung bei einem Training", 1)
P("Eine Messung vor und nach einem Augentraining bei derselben Person ist die sinnvollste Anwendung der App. Das gilt für Kinder und Erwachsene. "
  "Jede Person ist dabei ihre eigene Vergleichsgröße, und die großen Unterschiede zwischen Personen spielen keine Rolle. "
  "Damit eine Veränderung etwas bedeutet, sind die folgenden Punkte wichtig.")

H("8.1 Die persönliche Schwankung kennen", 2)
P("Werte schwanken auch ohne Training von Tag zu Tag, besonders bei Kindern. Wie stark das bei der App ist, wurde noch nicht untersucht.")
N("Vor dem Training 2–3 Ausgangsmessungen an verschiedenen Tagen machen, z. B. innerhalb von 1–2 Wochen. Diese Messungen zeigen die normale Schwankung der Person.", "Ausgangsmessungen: ")
N("Eine Veränderung nach dem Training zählt erst, wenn sie deutlich größer ist als diese Schwankung. "
  "Praktische Faustregel: mehr als das Doppelte der Spanne der Ausgangsmessungen. Das ist eine Empfehlung, kein Literaturwert.", "Schwelle: ")
N("Nach dem Training ebenfalls 2 Messungen machen. Eine einzelne Messung kann ein Ausreißer sein.", "Nachmessungen: ")
T(["Zeitpunkt", "Messungen", "Zweck"], [
    ["Woche 1–2, vor dem Training", "2–3, an verschiedenen Tagen", "persönliche Ausgangsschwankung bestimmen"],
    ["Trainingsphase", "optional 1 Zwischenmessung", "Verlauf erkennen"],
    ["Nach dem Training", "2, an verschiedenen Tagen", "Veränderung gegen die Ausgangsschwankung prüfen"],
    ["Einige Wochen später (optional)", "1–2", "prüfen, ob eine Veränderung anhält"],
], [5.0, 4.6, 7.0])

H("8.2 Alles gleich halten", 2)
B("Gerät, Abstand, Ständer, Licht und Tageszeit.", "Aufbau: ")
B("Streifenbreite, Geschwindigkeiten, Blockdauer und Reihenfolge.", "Einstellungen: ")
B("wörtlich gleich. Bei Kindern ist das der größte Störfaktor: Ein Kind, das beim zweiten Mal besser hinschaut, hat einen höheren Gain, "
  "ohne dass sich im Gehirn etwas verändert hat. Look-OKN hat einen höheren Gain als Stare-OKN " + R("18235002", "Purpose") + ".", "Anweisung: ")

H("8.3 Was die Messung nicht beweisen kann", 2)
P("Ändert sich ein Wert, kann das viele Gründe haben, nicht nur das Training:")
B("Die Person kennt den Ablauf und ist entspannter.", "Gewöhnung an den Test: ")
B("Tagesform, Müdigkeit, Interesse.", "Aufmerksamkeit und Motivation: ")
B("Der OKN-Gain steigt in den ersten Lebensjahren und bleibt dann bis etwa 50 Jahre stabil " + R("15548816", "Results") + ". "
  "Bei 7–14-Jährigen wurde der OKN als stabil beschrieben " + R("17572783", "Conclusion") + ". In wenigen Wochen ist der Entwicklungseffekt daher eher gering.", "Normale Entwicklung bei Kindern: ")
B("Wer bei der ersten Messung zufällig schlecht war, ist beim nächsten Mal oft besser, auch ohne Training.", "Zufällige Rückkehr zum Durchschnitt: ")
B("Ähnelt das Augentraining dem Streifenband, wird möglicherweise vor allem die Testaufgabe geübt. Eine allgemeine Verbesserung ist dann nicht belegt.", "Trainingsübertragung: ")
note("Die Messung kann zeigen, dass sich bei dieser Person etwas verändert hat. Dass das Training die Ursache war, beweist sie allein nicht. "
     "Dafür bräuchte es eine Vergleichsgruppe ohne Training oder ein Einzelfall-Design: Das Training beginnt bei mehreren Personen zu "
     "unterschiedlichen Zeitpunkten. Verbessern sich die Werte jeweils erst nach Trainingsbeginn, spricht das deutlich stärker für das Training.", "Wichtig: ")

H("8.4 Welche Messwerte am aussagekräftigsten sind", 2)
B("Veränderungen der Asymmetrie (rechts/links, oben/unten) und des Gains bei 30 °/s. Sie hängen weniger von der Aufmerksamkeit ab als der Gesamt-Gain.", "Am besten geeignet: ")
B("Schlagfrequenz und Amplitude ändern sich oft schon, wenn die Person anders hinschaut " + R("15864563") + ". Sie eignen sich weniger als Erfolgsmaß.", "Weniger geeignet: ")
B("Bei jeder Messung „Augen erkannt“ und „Wackeln“ prüfen. Nur Blöcke mit guter Qualität vergleichen.", "Qualität: ")

H("8.5 Rahmen", 2)
B("Bei Kindern ist die Einwilligung der Eltern nötig. Nur Pseudonyme verwenden. Die Daten bleiben auf dem Gerät.", "Einwilligung und Datenschutz: ")
B("Ergebnisse vorsichtig formulieren, besonders bei Veröffentlichungen. Passend: „Bei Person X stieg der Gain nach dem Training über die eigene "
  "Ausgangsschwankung.“ Nicht passend: „Das Training verbessert den OKN.“", "Formulierung: ")

# ================= Kapitel 9: Entwicklungsstörungen
H("9 Studienlage: neurologische Entwicklungsstörungen", 1)
P("Gesucht wurde in PubMed nach OKN in Verbindung mit ADHS, Autismus, Dyslexie, Tics/Tourette, Koordinationsstörungen und genetischen "
  "Syndromen (Stand Oktober 2026). Ausgewertet wurden die Abstracts. Die Zahlen „n = … vs. …“ nennen die Größe der Patienten- und Vergleichsgruppen.")
note("Für keine dieser Störungen gibt es ein etabliertes OKN-Merkmal. Die Befunde stammen aus wenigen, kleinen und teils alten Studien. "
     "Die App kann daher keine Zuordnung zu einer Diagnose leisten. Geeignet ist sie für den Verlauf bei derselben Person (Kapitel 8).", "Kernaussage: ")
T(["Störung", "Beweislage", "Befunde"], [
    ["Dyslexie", "schwach bis mäßig", "niedrigerer OKN-Gain; größerer Unterschied zwischen beiden Augen"],
    ["Autismus", "schwach, widersprüchlich", "niedrigerer Gain bei mehr autistischen Merkmalen; Hirnstamm-Reflexe intakt"],
    ["ADHS", "sehr schwach", "OKN reift langsamer"],
    ["Tics / Tourette", "nur Fallberichte", "OKN einmal normal, einmal von Sakkaden unterbrochen"],
    ["Down-Syndrom (zum Vergleich)", "mäßig", "Gain abhängig von der Geschwindigkeit vermindert, weniger Schläge"],
], [4.4, 3.6, 8.6])

H("9.1 Dyslexie", 2)
B("Kinder mit Dyslexie hatten einen niedrigeren Gain bei Folgebewegung und OKN (n = 30 vs. 20, Video-Okulographie) " + R("33261980", "Results") + ".", "Niedrigerer Gain: ")
B("Nur am rechten Auge war die OKR vermindert, der Unterschied zwischen den Augen dadurch größer. Sakkaden waren deutlich langsamer und ungenauer "
  "(n = 40 vs. 40) " + R("42083826", "Results") + ". Die Autoren betonen, dass der Zusammenhang nicht ursächlich belegt ist " + R("42083826", "Conclusions") + ".", "Unterschied zwischen den Augen: ")
B("Vor einem bewegten optokinetischen Hintergrund wurde der Blick stärker instabil als bei Kontrollen " + R("3364526") + ".", "Unruhiger Blick: ")
B("Eine Metaanalyse fand vor allem längere Fixationen und weniger Sakkaden, keine OKN-Unterschiede " + R("35094959", "Conclusion") + ".", "Metaanalyse: ")
B("Studien zu einer „zerebellär-vestibulären Störung“ stammen von einem einzelnen Autor. Sie fordern selbst eine unabhängige Bestätigung " + R("2928068") + ".", "Vorsicht: ")

H("9.2 Autismus", 2)
B("Bei gesunden Erwachsenen war der Gain der langsamen Phase umso niedriger, je höher der Autismus-Wert (Autism-spectrum Quotient) war. "
  "Für die schnellen Phasen gab es keinen Zusammenhang " + R("34430740") + ". Untersucht wurden Personen ohne Autismus-Diagnose.", "Gain und autistische Merkmale: ")
B("Bei 31 von 34 Kindern mit Autismus war der OKN auffällig: verzögerter Beginn, kurze Dauer, Wegschauen " + R("1641224") + ". "
  "Das betrifft vor allem Aufmerksamkeit und Blickvermeidung, nicht den Reflex selbst.", "Auffälliges Verhalten beim Test: ")
B("Eine größere Sehprüfung (n = 51 vs. 44) berichtete keine klaren OKN-Unterschiede. Nur die Konvergenz fiel auf " + R("19224351") + ".", "Kein Unterschied: ")
B("Reflexe des Gleichgewichtssystems und Sakkadengeschwindigkeit waren normal, die Folgebewegung zeigte nur einen Trend zu niedrigerem Gain "
  "(n = 79 vs. 62). Die Autoren sehen die Unterschiede in der Großhirnrinde, nicht in Hirnstamm oder Kleinhirn " + R("25846907") + ".", "Hirnstamm und Kleinhirn intakt: ")

H("9.3 ADHS", 2)
B("Bei 148 vs. 148 Jungen (7–14 Jahre) war die Geschwindigkeit der langsamen OKN-Phase niedriger und ihre Entwicklung verzögert "
  + R("17572783", "Results") + ". Nur das Abstract ist englisch, einige Zahlen darin wirken unplausibel.", "Langsamere Reifung: ")
B("Unaufmerksamkeit senkt den Gain unabhängig von einer Hirnbesonderheit. Bei ADHS lässt sich beides kaum trennen.", "Größtes Problem: ")

H("9.4 Tics und Tourette-Syndrom", 2)
B("Ein Mädchen mit Augen-Tics hatte normalen OKN " + R("1477052") + ".", "Fallbericht 1: ")
B("Bei einem Patienten mit Tourette-Syndrom unterbrachen eingestreute Sakkaden Folgebewegung und OKN " + R("9183269") + ".", "Fallbericht 2: ")
B("Studien zum Tourette-Syndrom untersuchen vor allem Sakkaden und Fixation, zum Beispiel weniger und kleinere Mikrosakkaden " + R("28815321") + ". "
  "Eine Übersichtsarbeit beschreibt unterschiedliche Augenbewegungsmuster bei Autismus, ADHS und Tourette, vor allem bei Sakkaden " + R("15090875", "Recent Findings") + ".", "Forschungsschwerpunkt: ")

H("9.5 Zum Vergleich: Down-Syndrom", 2)
B("Der OKN-Gain fiel mit steigender Geschwindigkeit stärker ab als bei Kontrollen, und es gab weniger Nystagmus-Schläge (n = 32 vs. 32) " + R("21842408") + ".", "Deutlichster Befund: ")
B("Alle untersuchten Kinder hatten in mindestens einem Test auffällige Gain-Werte. Vermutet wird das Kleinhirn als Ursache " + R("26998716", "Conclusions") + ".", "Bestätigung: ")

H("9.6 Bedeutung für die App", 2)
N("Keine Studie zeigt ein OKN-Merkmal, das zuverlässig genug für eine Zuordnung zu einer Diagnose wäre.", "Keine Diagnose: ")
N("Möglich, aber nur mit Kontrollen gleichen Alters und gleicher Anweisung. Bei Kindern bestimmt die Aufmerksamkeit das Ergebnis stark.", "Gruppenvergleiche: ")
N("Der Dyslexie-Befund eines Unterschieds zwischen den Augen " + R("42083826", "Results") + " ist mit der aktuellen App nicht messbar, weil sie beide Augen mittelt.", "Unterschied zwischen den Augen: ")
N("Für die Autismus-Fragestellung wäre der Gain bei Stare-Anweisung („nur geradeaus schauen, nicht folgen“) die passende Messgröße " + R("34430740") + ".", "Autismus: ")

new_elems = [e for e in body if e not in before and e.tag != qn("w:sectPr")]
for e in new_elems:
    anchor._p.addprevious(e)

# ---------------- Literatur umbenennen und ergänzen
for r in anchor.runs:
    if "Literatur" in r.text:
        r.text = r.text.replace("8 Literatur", "10 Literatur")
if not anchor.text.startswith("10"):
    anchor.text = "10 Literatur"
last_ref = [p for p in doc.paragraphs if p.text.startswith("[39]")][0]
prev = last_ref._p
for pmid in NEW:
    cit, doi, pmc = info[pmid]
    p = copy.deepcopy(last_ref._p)
    for r in list(p.findall(qn("w:r"))):
        p.remove(r)
    prev.addnext(p); prev = p
    from docx.text.paragraph import Paragraph
    para = Paragraph(p, last_ref._parent)
    r = para.add_run(f"[{NUM[pmid]}]\t"); r.bold = True; r.font.size = Pt(9.5)
    r = para.add_run(cit + " "); r.font.size = Pt(9.5)
    r = para.add_run(f"PMID {pmid}" + (f" · doi:{doi}" if doi else "") + (f" · {pmc} (frei verfügbar)" if pmc else ""))
    r.font.size = Pt(9); r.font.color.rgb = INK2

# Inhaltsverzeichnis beim Öffnen aktualisieren lassen
s = doc.settings.element
if s.find(qn("w:updateFields")) is None:
    uf = OxmlElement("w:updateFields"); uf.set(qn("w:val"), "true"); s.append(uf)

doc.save(PATH)
print("ok, neue Quellen:", len(NEW))
