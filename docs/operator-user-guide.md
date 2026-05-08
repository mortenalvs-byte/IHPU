# IHPU TrykkAnalyse — operatør-håndbok

Plain-markdown bruksanvisning for operatøren i felt. Skrevet for å kunne
printes ut og leses uten internett-tilgang.

> **Status:** Skjermbilder kan legges til i en senere dokumentasjons-PR.
> Per i dag er guiden tekst-basert.

<!-- Screenshot TODO: hovedvinduet ved oppstart -->

---

## 1. Hva er IHPU TrykkAnalyse?

IHPU TrykkAnalyse er et Windows-skrivebordsprogram for å analysere
trykktest-logger fra IHPU-systemet og produsere kunderapporter (CSV
og PDF). Programmet:

- Leser trykktest-logger (`.txt`, `.csv`, `.dat`, `.tsv`, `.log`)
- Lar operatøren også registrere data manuelt
- Beregner trykkfall og evaluerer hold-perioden mot en grense
  (`maxDropPct`)
- Tegner trykkforløp-graf med markert analyse-periode
- Eksporterer maskinlesbar CSV og kunde-vennlig PDF
- Lagrer arbeidsstatus automatisk på tvers av omstart

Programmet er *frittstående* — det krever ikke internett, ingen
innlogging og ingen ekstern lagring. All data ligger lokalt.

---

## 2. Systemkrav

- Windows 10 eller Windows 11
- ~200 MB ledig diskplass
- Tastatur + mus (full skjermflate, helst 1280×800 eller mer)

---

## 3. Slik starter du programmet

1. Dobbeltklikk på **`Start IHPU.bat`** på skrivebordet, eller
2. Etter installer (kommer i en fremtidig versjon): bruk Start-menyen.

Vinduet åpner seg med tittelen **"IHPU TrykkAnalyse"**.
"Bootstrap OK" øverst er et stabilitetsmerke som bekrefter at programmet
har lastet ferdig.

<!-- Screenshot TODO: oppstart med "Bootstrap OK" + tomme cards -->

---

## 4. Datakilde — fil-opplasting vs manuell registrering

I "Datakilde"-kortet velger du mellom to kilder:

### Fil-opplasting (standard)

Klikk "Velg fil" og pek på trykktest-loggen din. Programmet leser
filen, kjører parser og fyller inn:

- Antall rader, advarsler og feil
- Første og siste tidspunkt
- Logg-varighet
- Hvilke kanaler (T1 og T2) som er tilstede

**Tomtilstand:** "Ingen data lastet — velg .txt/.csv/.dat/.tsv/.log,
eller bruk Manuell registrering."

### Manuell registrering

Hvis du ikke har en hel logg-fil — for eksempel hvis du bare har
noen få avlesninger på papir — bruk "Manuell registrering". Du kan:

- Legge til én rad om gangen (Dato / Tid / T1 / T2)
- Lime inn tabbsep-tabell (DD.MM.YYYY HH:MM:SS\<TAB\>T1\<TAB\>T2)
- Slette eller redigere rader i tabellen
- Klikke **"Bruk manuelle rader"** for å gjøre den manuelle datasettet
  til aktiv kilde

Manuelle rader følger nøyaktig samme analyse-pipeline som fil-data —
det finnes ingen separat "manuell"-motor.

<!-- Screenshot TODO: manuell registrering med 3 rader -->

---

## 5. Forstå filsammendraget

Etter at en logg er lastet vises:

| Felt | Hva betyr det? |
|---|---|
| Filnavn | Navn på lastet fil |
| Antall rader | Hvor mange gyldige målepunkter |
| Warnings | Mindre avvik som ikke stoppet parsingen (kommer i Meldinger-kortet) |
| Errors | Alvorlige feil — sjekk loggfilen |
| Første / siste tidspunkt | Tidsspenn loggen dekker |
| Varighet | Total logg-varighet i minutter |
| T1 / T2 | "tilstede" hvis kanalen har gyldige data, ellers "mangler" |

---

## 6. Velg analyseperiode

For trykktest gir det sjelden mening å analysere *hele* loggen — ramp-up
og depressurisering forskyver gjennomsnittet. Du må fortelle programmet
hvilket tidsspenn som er den faktiske hold-perioden.

To måter:

### Klikk og dra i grafen

Hold venstre museknapp og dra horisontalt over det området du vil
analysere. Bakgrunnen markeres grønn. Slipp musen og periode-felter
oppdateres automatisk.

### Skriv tidspunkter

Bruk feltene **"Fra"** og **"Til"** under grafen. Format `HH:MM:SS`
eller `HH:MM`. Eksempel: `13:10:37`. La feltet stå tomt for å bruke
logg-start eller logg-slutt.

### Tilbakestill

Klikk **"Tilbakestill periode"** for å gå tilbake til hele loggen.

### Det du ser

- **Hele logg:** total tidsspenn + varighet
- **Valgt periode:** valgt tidsspenn + varighet + prosent av loggen
  (f.eks. "30.0 min, 43 % av loggen")

<!-- Screenshot TODO: chart med markert område + period-felter -->

---

## 7. Sett kriterier

I "Analyse-kontroller" velger du:

| Kriterium | Hva |
|---|---|
| Kanal | Hvilken sensor som evalueres (T2 er standard for trykktest) |
| Max drop % | Maks tillatt trykkfall i prosentpoeng. 5 = "fail hvis drop > 5 %" |
| Target pressure (valgfri) | Referansetrykk for prosent-utregning. La stå tomt for å bruke starttrykk i valgt periode |

Endrer du noe her, oppdateres alle nedstrøms-felt umiddelbart.

---

## 8. Forstå PASS / FAIL / UNKNOWN

Resultat-kortet "Holdperiode-resultat" gir én av tre verdier:

- **PASS** — trykkfallet er under maks tillatt grense
- **FAIL** — trykkfallet overstiger grensen
- **UNKNOWN** — programmet kan ikke evaluere

Under hovedstatusen er en kort forklaring:

| Status | Eksempel-tekst |
|---|---|
| PASS | "Trykkfall 4.81 % er under maks tillatt 5.00 % (margin 0.19 %p)" |
| FAIL | "Trykkfall 6.20 % overstiger maks tillatt 5.00 % (overskudd 1.20 %p)" |
| UNKNOWN | "UNKNOWN — mangler maxDropPct. Sett kriteriet i Analyse-kontroller." |

UNKNOWN har alltid en konkret årsak. Vanligste årsaker:

- `MISSING_CRITERIA` — du har ikke satt `maxDropPct`
- `EMPTY_RANGE` — valgt periode inneholder ingen rader
- `INSUFFICIENT_POINTS` — trenger minst 2 målepunkter
- `ZERO_DURATION` — start- og sluttidspunkt er like
- `CHANNEL_NOT_PRESENT` — valgt kanal mangler i datasettet

---

## 9. Sammenligne flere tester

I "Sammenlign tester"-kortet kan du laste opp flere logger som
**sammenligning** ved siden av hovedanalysen. Sammenligningssettet
påvirker *ikke* hovedanalysen — det er bare en oversiktstabell.

For hver lastet fil vises:

- Filnavn, antall rader, varighet
- T2 start / slutt / drop bar / drop %
- T2-verdikt og T1-verdikt
- Når den ble lagt til
- "Fjern"-knapp

Den **beste** og **dårligste** T2-drop-prosenten er fargemarkert.
"Tøm sammenligning" tømmer hele tabellen.

Sammenligningstabellen er kun side-by-side numerisk — chart-overlay og
inkludering i kunde-PDF er separate fremtidige funksjoner.

<!-- Screenshot TODO: comparison-tabell med 2-3 entries og best/worst-marker -->

---

## 10. Eksporter rapport

I "Kunderapport"-kortet fyller du inn:

- Kundenavn (anbefalt — vises i PDF-tittel og filnavn)
- Prosjektnummer (anbefalt — brukes i filnavn)
- Lokasjon
- Test-dato
- IHPU-serienummer
- ROV-system
- Operatør
- Kommentar / merknad

> **Eksport blokkeres ikke når disse feltene er tomme.** Så lenge
> du har trykktest-data kan du eksportere. Manglende felt vises bare
> som rådgivning ("Klar — kundenavn anbefalt før eksport"), aldri som
> en sperre. Operatøren skal alltid kunne få ut en rapport i felt.

### CSV-eksport

Klikk **"Eksporter CSV"**. Filen lagres i nedlastings-mappen din
(typisk `C:\Users\<deg>\Downloads`). Filnavn:
`IHPU_<prosjekt>_<dato>_<status>.csv`.

CSV-en inneholder:

- Metadata (kunde, prosjekt, etc.)
- Parser-sammendrag
- Valgt periode
- Analyse-tall
- Kriterier
- Hold-resultat
- **Rådata-rader** for valgt periode (én rad per måling)

CSV bruker punktum som desimal-separator og CRLF linje-skift —
kompatibelt med Excel og maskin-lesere uten regional-konfigurasjon.

### PDF-eksport

Klikk **"Eksporter PDF"**. Filnavn-mønster: `IHPU_<prosjekt>_<dato>_<status>.pdf`.

PDF-en inneholder, i rekkefølge:

1. Tittel og generert-tidspunkt
2. Prosjekt-metadata
3. Valgt periode
4. Kriterier
5. **PASS / FAIL / UNKNOWN-badge** (full bredde, fargekodet)
6. **Trykkforløp** — chart-bilde med markert område (full bredde, max ~90 mm)
7. Holdperiode-detaljer
8. Trykkfallanalyse
9. **Rådata** — tabell med alle målerader for valgt periode (paginert)
10. Parser-sammendrag
11. Meldinger
12. Kommentar fra operatør

Ved store datasett (over 1000 rader) blir Rådata-tabellen klippet til
første 500 + siste 500 rader, med markøren `… N rader utelatt …`
mellom.

<!-- Screenshot TODO: PDF side 1 med badge + Trykkforløp -->
<!-- Screenshot TODO: PDF Rådata-side med header-repeat -->

---

## 11. Lagre / gjenopprette test-økt

Programmet **autosaver** alle dine inntastede felter (kanal, kriterier,
metadata, manuelle rader, etc.) automatisk hver gang du endrer noe.
Status vises i "Test-økt"-kortet:

- **Sist lagret kl HH:MM:SS** — siste autosave
- **Synkronisert** / **Lagring feilet** / **Autosave deaktivert** —
  helsetilstand

### Etter omstart

Du får tilbake:

- Manuelle rader (helt og fullstendig — analysen kjører automatisk)
- Metadata, kanal, kriterier, periode-valg

Du må selv velge filen på nytt hvis du brukte fil-opplasting.
Programmet viser:

> "Sist økt gjenopprettet — velg «<filnavn>» på nytt for å fortsette
> analysen."

Fil-kortet får en **dempet aksent-ramme** med teksten "↓ Velg filen
som ble brukt sist for å fortsette analysen" når du må velge fil
på nytt.

### Eksporter / importer test-økt

- **Eksporter session** lagrer en `.json` du kan sende på e-post,
  arkivere, eller flytte til en annen maskin.
- **Importer session** validerer en `.json` og setter opp programmet
  med samme settings + manuelle rader. Råe filbytes overføres ikke;
  for fil-mode må du velge filen på nytt.

### Ny test

Klikk **"Ny test"** for å nullstille alt og starte friskt. Bekrefter
ingenting — knappen tømmer felt + autosave-slot umiddelbart.

---

## 12. Vanlige feil og hva de betyr

| Melding | Hva det betyr | Hva du gjør |
|---|---|---|
| `Kunne ikke lese «<fil>»: <feil>. Sjekk at filen ikke er åpen i et annet program.` | Filen er låst (vanligvis åpen i Notepad/Excel) eller har feil rettigheter | Lukk filen i andre programmer og last på nytt |
| `Parser feilet på «<fil>»: <feil>. Verifiser at filen er en gyldig IHPU-trykktest-logg.` | Filen ble lest, men formatet kunne ikke parses | Åpne filen i Notepad og verifiser at første linje har `<dato> <tid>\t<T1>\t<T2>` |
| `Ugyldig fra-tid «<X>». Eksempel: 13:10:37 eller 13:10. La feltet stå tomt for å bruke logg-start.` | Tidsverdien matcher ikke `HH:MM:SS` eller `HH:MM` | Skriv tiden i riktig format |
| `Ugyldig session-fil: <kode> — <melding>. Forventet schema-versjon: 1.` | Session-JSON er korrupt eller fra feil versjon | Bruk en eksportert session fra samme programversjon |
| `UNKNOWN — mangler maxDropPct. Sett kriteriet i Analyse-kontroller.` | Du har slettet eller blanket ut max-drop-feltet | Skriv inn et tall (5 er standard) |
| `Mangler trykktest-data — last opp fil eller registrer manuelt.` | Du forsøker å eksportere uten å ha lastet data | Last fil eller skriv inn manuelle rader først |

---

## 13. Begrensninger og forutsetninger

- **Tids-format:** Loggen forventes å bruke `DD.MM.YYYY HH:MM:SS` eller
  whitespace-separert tid. Andre tidsformater må preprosesseres.
- **Tabseparert:** Tab er primær separator; whitespace er fallback.
- **Negative trykkverdier preserveres** (f.eks. T1 i kanonisk fixture
  ligger på ~-2.96 bar).
- **Drop-prosent rapporteres i prosentpoeng** (5 = 5 %, ikke 0.05).
- Tegn etter `;` regnes ikke som kommentar — alle rader leses bokstavelig.
- Programmet logger **ikke** noen ekstern data — alt blir på din maskin.
- Råe filbytes blir **aldri** lagret i autosave; bare filnavn + parser-sammendrag.

---

## 14. Versjonshistorikk

Se `CHANGELOG.md` i programmappen for full liste over endringer.

For utviklere og release-engineering: se `docs/release-candidate-checklist.md`.

For kvalitetssikring før hver leveranse: se `docs/operator-qa-checklist.md`.
