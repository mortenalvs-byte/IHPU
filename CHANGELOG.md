# Changelog

All notable changes to IHPU TrykkAnalyse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions and tags begin from `v0.1.0` once the first installer release ships
(roadmap item 12).

---

## [Unreleased]

### Added

- Operator user guide (`docs/operator-user-guide.md`).
- Operator QA checklist (`docs/operator-qa-checklist.md`).
- Release-candidate checklist (`docs/release-candidate-checklist.md`).
- `hold-narrative` element under PASS/FAIL/UNKNOWN badge with concrete
  status-specific explanation. Reads only existing `HoldPeriodResult` —
  no domain re-derivation.
- `full-log-summary` row in the chart card showing total log range and
  duration alongside the operator's selected period.
- Selected-period summary now appends `(D.D min, P % av loggen)` when
  the operator has narrowed the range.
- `needs-file` CSS hint on the upload card after a file-mode session
  is restored without raw bytes — visually nudges the operator toward
  reselecting the source file.

### Changed

- Empty-state messages now include action hints:
  - File status: "Ingen data lastet — velg .txt/.csv/.dat/.tsv/.log,
    eller bruk Manuell registrering."
  - Chart status (no data): "Venter på data — last opp en logg eller
    bruk manuelle rader."
  - Manual entry: "Ingen rader registrert. Skriv inn én rad over,
    eller bruk «Lim inn fra paste»."
  - Overlay: "Ingen sammenligningsfiler. Last opp én eller flere
    logger for å sammenligne mot aktiv analyse."
- Report-readiness messaging is advisory, never blocking. Buttons
  remain enabled whenever trykktest-data exists. Missing customer
  metadata produces "Klar — kundenavn anbefalt før eksport"; UNKNOWN
  verdict produces "Klar for eksport (resultat: UNKNOWN — sjekk
  meldinger nederst)."
- Error messages adopt direct operator tone (e.g. "Velg en gyldig
  fil." over "Vennligst velg en gyldig fil."), and surface concrete
  next steps where applicable.

### Fixed

- (no fixes in this release window — fix entries land per-PR going
  forward.)
