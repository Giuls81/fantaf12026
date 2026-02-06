# SKILL: Time & Lock Logic Safe (UTC + Lineup Lock)

## Goal

Preservare la logica di lock lineup basata su orari UTC.

## Regole non negoziabili

- Orari sessione: stringhe ISO UTC con Z (es. 2026-03-07T05:00:00Z).
- Scelta sessione target:
  - se race.isSprint === true usare sprintQualifyingUtc
  - altrimenti usare qualifyingUtc
- Lock = target - 5 minuti.
- Stati: unconfigured/open/closing_soon/locked.
- closing_soon quando mancano <= 30 minuti al lock.

## Da NON fare

- NON calcolare lock in timezone locale.
- NON cambiare soglie (5 min / 30 min) senza richiesta.

## Output richiesto

- casi limite + 3 test manuali: open (2h), closing_soon (10m), locked (passato).
