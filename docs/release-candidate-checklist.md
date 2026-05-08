# Release-candidate-sjekkliste

Engineering-gate før vi tagger en release og bygger Windows-installer.
Komplementerer `operator-qa-checklist.md` (operatør-fokusert) — denne
fila er for utvikleren / release-engineer.

> **Bruk:** kopier til `release-runs/v0.X.0.md` og huk av `[ ]`. Ikke
> rediger denne kilde-fila.

---

## Forutsetninger

- [ ] Du står på `main` lokalt
- [ ] `git status` er ren (intet ucommitted)
- [ ] `git pull` har fanget alle merget endringer

---

## 1. PR-status

- [ ] Alle PR-er som skal være med i denne release-en er merget
- [ ] `git log --oneline main` viser forventede squash-commits
- [ ] Ingen åpne PR-er som blokkerer (sjekk `gh pr list`)

---

## 2. Lokal verify

- [ ] `npm run verify` PASS (alle 6 stegene grønne)
- [ ] Forventet output:
  - [ ] `npm run build` PASS — `dist/` + `dist-electron/` regenerert
  - [ ] `npm test` PASS — alle unit-tester, 0 skipped
  - [ ] `npm run smoke:fixture` PASS — fixture sha256 uendret
  - [ ] `npm run smoke:web` PASS
  - [ ] `npm run smoke:prod` PASS
  - [ ] `npm run smoke:electron` PASS — alle Electron-flows

---

## 3. CI-status

- [ ] GitHub Actions `verify` PASS på siste main-commit
- [ ] Ingen røde kryss i siste workflow-run

---

## 4. Integrity audit

- [ ] Fixture sha256 fortsatt `8e44d28b0a295b9dbb8fecb202c8e899f8f3b6291a886128b9b22f6e6b12ca22`
  - PowerShell: `Get-FileHash -Algorithm SHA256 "test-data\Dekk test Seal T.2"`
  - Bash: `sha256sum "test-data/Dekk test Seal T.2"`
- [ ] Legacy HTML uendret (kvitter sha256)
- [ ] `package.json` versjons-bump er bevisst (skal matche tag)
- [ ] `package-lock.json` regenerert hvis `package.json` endret

---

## 5. Operator QA

- [ ] `docs/operator-qa-checklist.md` gått igjennom på en arbeidskopi
- [ ] Visual PDF-check OK
- [ ] Manuell desktop-test av `Start IHPU.bat` OK på minst én Windows-maskin

---

## 6. Versjon og changelog

- [ ] Bumpe `package.json` `version`-felt (semver):
  - **patch** (0.0.X) for bug-fixes
  - **minor** (0.X.0) for nye features uten breaking changes
  - **major** (X.0.0) for breaking changes
- [ ] Oppdater `CHANGELOG.md`:
  - [ ] Flytt innhold fra `## [Unreleased]` til ny `## [vX.Y.Z] — YYYY-MM-DD`-seksjon
  - [ ] Behold strukturen: Added / Changed / Fixed / Removed / Deprecated / Security
  - [ ] Tom `## [Unreleased]`-stub i toppen for neste runde
- [ ] Commit endringene: `chore: bump version to vX.Y.Z`

---

## 7. Tag

- [ ] `git tag -a vX.Y.Z -m "vX.Y.Z"`
- [ ] `git push origin vX.Y.Z`
- [ ] Verifiser at taggen er synlig på GitHub Releases

> **Aldri** tag før alt over er huket av. Tagger kan ikke overskrives
> uten å bryte etterfølgende installasjoner — nye tester skal gå i
> en ny patch-versjon.

---

## 8. Installer (PR #12 territory)

> **Status (ved PR #11):** Installer-arbeidet er IKKE gjort enda.
> Dette punktet aktiveres etter PR #12 lander.

- [ ] `npm run dist` produserer `release/IHPU TrykkAnalyse Setup vX.Y.Z.exe`
- [ ] Installer-størrelse rimelig (~80–150 MB for Electron-app)
- [ ] Installer kjører fra start til slutt på en ren Windows 10/11-VM
- [ ] Snarvei på skrivebordet + Start-meny opprettet
- [ ] Programmet starter via snarvei
- [ ] Avinstaller fungerer (Apper og Funksjoner i Windows)
- [ ] App-icon (.ico) viser korrekt i:
  - [ ] Start-meny
  - [ ] Skrivebordsnarvei
  - [ ] Vindu-tittellinje
  - [ ] Oppgavelinjen
  - [ ] Apper og Funksjoner-listen

---

## 9. Code-signing

> **Status:** ikke vedtatt enda. Diskuteres i PR #12-planen.

- [ ] Hvis sertifikat finnes: `electron-builder` konfigurert med
      `win.certificateFile` + `win.certificatePassword`
- [ ] Signaturer verifisert med `signtool verify /pa file.exe`
- [ ] Hvis usignert: SmartScreen-advarsel dokumentert i release notes

---

## 10. Release notes

- [ ] Opprett GitHub Release på taggen
- [ ] Lim inn relevant CHANGELOG-seksjon
- [ ] Last opp installer (.exe) som release-asset
- [ ] Hvis usignert: legg ved tekst om SmartScreen
- [ ] Kort beskrivelse av hovedendringer

---

## 11. Distribuér til operatør

- [ ] Send installer-link eller .exe direkte til operatøren
- [ ] Send med oppdatert `docs/operator-user-guide.md`
- [ ] Send med oppdatert `docs/operator-qa-checklist.md`
- [ ] Be operatør verifisere første kjøring + en kanonisk test

---

## Hvis noe feiler

1. **Ikke release.** Tagg-en er ikke laget enda — så det er ingen "rollback".
2. Diagnostiser feilen.
3. Fix på en feature-branch + ny PR.
4. Etter merge: kjør hele denne sjekklisten på nytt fra steg 1.

---

## Etter release

- [ ] Lukk eventuelle PR-er som lå i kø for denne versjonen
- [ ] Oppdater eventuelle README-versjons-referanser
- [ ] Arkiver release-arbeidskopien
