# SKILL: Constants = Source of Truth (FantaF1)

## Goal

Trattare constants.ts come fonte dati principale senza modifiche casuali.

## Regole non negoziabili

- Non cambiare ID (driver.id / constructor.id / race.id) se non richiesto esplicitamente.
- Non cambiare prezzi/multipliers/nomi/date senza richiesta esplicita.
- Non “ripulire/normalizzare” i dati per gusto personale.

## Output richiesto

- lista modifiche (prima->dopo), motivazione, check coerenza (vedi Data Integrity).
