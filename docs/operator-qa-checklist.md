# Operatør-QA-sjekkliste

Sjekkliste å gå igjennom før hver kunderapport-leveranse, eller som
generell smoke-test etter en ny program-versjon. Hver seksjon dekker
én operatør-flow.

> **Bruk:** kopier denne fila til en arbeidskopi (f.eks.
> `qa-runs/<dato>.md`) og huk av `[ ]` etter hvert som du går
> igjennom. Du skal ALDRI redigere kilde-fila i `docs/`.

> **Forutsetning:** programmet er åpnet via `Start IHPU.bat` eller
> installer-snarvei, og vinduet viser "Bootstrap OK" øverst.

---

## Pre-flight

- [ ] Klikk **"Ny test"** i Test-økt-kortet
- [ ] Bekreft at meldingen viser "Ny test startet — alle felt er tilbakestilt."
- [ ] Bekreft at filsammendrag viser `—` for alle felt
- [ ] Bekreft at "Antall rader" under Manuell registrering viser `0`
- [ ] Bekreft at "Sammenlign tester"-tabellen er tom

---

## 1. File upload

Mål: verifisere at en kanonisk trykktest-logg parses korrekt og fyller
inn alle dashboard-felt.

- [ ] Klikk fil-input i Datakilde-kortet
- [ ] Velg `test-data/Dekk test Seal T.2`
- [ ] Etter ~1 sekund:
  - [ ] Filsammendrag → "Antall rader" = **461**
  - [ ] Filsammendrag → "Warnings" = **0** (eller dokumentert avvik)
  - [ ] Filsammendrag → "Errors" = **0**
  - [ ] T1 og T2 = "tilstede"
  - [ ] "Hele logg" viser tidsspenn med varighet (≈ 69.4 min)
  - [ ] Trykksammendrag → "Trykkfall" = **15.108 bar** (T2 default)
  - [ ] Hold-resultat = **PASS**
  - [ ] hold-narrative viser "PASS — trykkfall 4.81 % er under maks tillatt 5.00 % …"
  - [ ] Chart-status = "Klar"

---

## 2. Manual entry

Mål: verifisere at manuell registrering produserer samme analyse-flyt
som file upload.

- [ ] Klikk **"Ny test"**
- [ ] Velg radio **"Manuell registrering"**
- [ ] Skriv inn 3 rader:
  - `21.02.2026 / 13:00:00 / -2.96 / 320.00`
  - `21.02.2026 / 13:30:00 / -2.95 / 305.00`
  - `21.02.2026 / 14:00:00 / -2.94 / 290.00`
- [ ] "Antall rader" = **3**
- [ ] Klikk **"Bruk manuelle rader"**
- [ ] Bekreft:
  - [ ] Trykksammendrag → "Trykkfall" = **30.000 bar**
  - [ ] Periode-varighet = **60.0 min**
  - [ ] Hold-resultat enten PASS eller FAIL avhengig av kriterier
  - [ ] Filnavn-banner viser "Manual entry"
- [ ] Slett én rad via "Slett"-knappen
- [ ] "Antall rader" = **2**
- [ ] Klikk "Tøm manuelle rader"
- [ ] "Antall rader" = **0**
- [ ] Trykksammendrag-felt er nullstilte

---

## 3. Period selection

Mål: verifisere at både drag-i-chart og typed input filtrerer analysen
korrekt.

- [ ] Last fixture på nytt (`Dekk test Seal T.2`)
- [ ] Skriv `13:30:00` i "Fra" og `14:00:00` i "Til"
- [ ] Bekreft:
  - [ ] "Valgt periode" = "13:30:00 → 14:00:00 (30.0 min, ~43 % av loggen)"
  - [ ] Trykksammendrag oppdaterer seg
- [ ] Klikk "Tilbakestill periode"
- [ ] "Valgt periode" = "Hele loggen (...)"
- [ ] Klikk og dra horisontalt i chartet
- [ ] Felter fylles automatisk; markert område synlig som grønn rektangel

---

## 4. Criteria changes

Mål: verifisere at kanal/maxDropPct/targetPressure-endringer reflekteres
overalt umiddelbart.

- [ ] Endre Max drop % fra 5 til 4
- [ ] Hold-resultat = **FAIL**
- [ ] hold-narrative viser overskudd-tekst
- [ ] Endre tilbake til 5 → PASS
- [ ] Endre kanal til T1 → resultat oppdaterer (T1 stiger, så fortsatt PASS)
- [ ] Sett Target pressure = 315 → drop % blir litt lavere
- [ ] Tøm Target pressure → drop % tilbake til original

---

## 5. Comparison entries

Mål: verifisere multi-file overlay og at hovedanalyse ikke påvirkes.

- [ ] Med fixture lastet som hoved-kilde
- [ ] Klikk fil-input under "Sammenlign tester"
- [ ] Velg samme fixture
- [ ] Comparison-tabell viser én rad med 461 rader / 15.108 bar / PASS
- [ ] Hovedanalyse i Trykksammendrag uendret
- [ ] Last samme fil to ganger — to rader i tabellen
- [ ] Klikk "Fjern" på første rad → en rad igjen, hovedanalyse uendret
- [ ] Klikk "Tøm sammenligning" → tabell tom, hovedanalyse uendret

---

## 6. CSV export

Mål: verifisere at CSV-en er maskinlesbar og inneholder rådata for
valgt periode.

- [ ] Med fixture lastet og fullt fylt metadata
- [ ] Klikk "Eksporter CSV"
- [ ] Status: "CSV exported: IHPU_<prosjekt>_<dato>_PASS.csv (... bytes)"
- [ ] Åpne CSV i Notepad
- [ ] Bekreft:
  - [ ] CRLF linje-skift
  - [ ] Punktum desimal-separator
  - [ ] Seksjoner: metadata / parser / periode / analyse / kriterier / hold / rader
  - [ ] Ca 461 rader i `# Rader`-seksjonen
  - [ ] Header `index,sourceLine,localIso,tMinutes,p1,p2`

---

## 7. PDF export

Mål: verifisere at PDF-en inneholder chart, rådata og er kunde-klar.

- [ ] Klikk "Eksporter PDF"
- [ ] Status: "PDF exported: IHPU_<prosjekt>_<dato>_PASS.pdf (... bytes)"
- [ ] Filstørrelse > 30 kB (med chart + rådata vanligvis 100 kB–5 MB)
- [ ] Åpne PDF i standard PDF-leser
- [ ] **Side 1:**
  - [ ] Tittel "IHPU TrykkAnalyse — kunderapport"
  - [ ] Generert-timestamp + filnavn
  - [ ] Prosjekt-metadata fyller riktig
  - [ ] Valgt periode korrekt
  - [ ] Kriterier viser maxDropPct + target
  - [ ] **PASS-badge** i full bredde, grønn
- [ ] **Trykkforløp-seksjon:**
  - [ ] Chart vises i full bredde, ikke kuttet
  - [ ] Caption "Markert område viser valgt analyse-periode (når satt)" i kursiv
  - [ ] Aspect ratio ser riktig ut (ikke strukket)
- [ ] **Holdperiode-detaljer:** Brukt / Tillatt / Margin riktig
- [ ] **Trykkfallanalyse:** Start / Slutt / Drop / Rate riktig
- [ ] **Rådata-seksjon:**
  - [ ] Header `# / localIso / tMinutes / p1 / p2`
  - [ ] tMinutes har 3 desimaler (0.000 / 0.117 / 0.233 …) — ingen overlapp med p1
  - [ ] p1, p2 har sensor-presisjon (~6 desimaler)
  - [ ] 461 rader for fixture (ingen "rader utelatt"-marker)
  - [ ] Header gjentas på nye sider
- [ ] **Footer** "IHPU TrykkAnalyse · generert ..." på hver side
- [ ] Ingen sidebrudd midt i overskrifter

---

## 8. Session export / import

Mål: verifisere persistens på tvers av program-omstart.

- [ ] Med fixture + metadata + criteria satt
- [ ] Klikk "Eksporter session"
- [ ] `IHPU_session_*.json` lagres til Downloads
- [ ] Lukk programmet helt
- [ ] Start på nytt
- [ ] Test-økt-kortet viser "Sist økt gjenopprettet — velg «Dekk test Seal T.2» på nytt …"
- [ ] Upload-section får dempet ramme + pil-tekst
- [ ] Manuelle rader (hvis de var aktive) er gjenopprettet i tabellen
- [ ] Klikk "Importer session" med .json-en fra steg 3
- [ ] Bekreft at felt + criteria er gjenopprettet

---

## 9. Electron smoke

Mål: kjøre den automatiserte smoke-suiten lokalt.

- [ ] Åpne PowerShell i prosjekt-mappen
- [ ] `npm run verify`
- [ ] Forventet output:
  - [ ] `npm run build` PASS
  - [ ] `npm test` PASS — 213+ unit-tester, 0 skipped
  - [ ] `npm run smoke:fixture` PASS — fixture sha256 uendret
  - [ ] `npm run smoke:web` PASS
  - [ ] `npm run smoke:prod` PASS
  - [ ] `npm run smoke:electron` PASS — file / manual / overlay / session

Hvis ett av disse feiler: **ikke release**.

---

## 10. Visual PDF check

Mål: se på en faktisk eksportert PDF i full skjermstørrelse — auto-tester
fanger ikke layout-problemer som mennesker ser umiddelbart.

- [ ] Eksporter PDF for fixture som beskrevet over
- [ ] Åpne PDF-en i standard PDF-leser
- [ ] Scroll igjennom alle sider i full størrelse
- [ ] Sjekk:
  - [ ] Ingen kolonne-overlapp i Rådata
  - [ ] Chart-bilde lesbart i print-størrelse
  - [ ] Ingen sidebrudd midt i overskrift / midt i tabell-rad
  - [ ] Footer på hver side
  - [ ] Tegn ikke kuttet av margene

---

## Avslutning

- [ ] Lukk programmet
- [ ] Arkiver QA-arbeidskopien (denne fila) med dato
- [ ] Hvis ALT er huket av: rapporten kan leveres til kunde

---

## Eskalering

Hvis ett eller flere steg feiler:

1. Legg ved skjermbilde + dato/versjon i `qa-runs/<dato>.md`
2. Ikke lever rapporten
3. Eskaler til utvikler-ansvarlig — se `docs/release-candidate-checklist.md`
