# SKILL: DB Guardian (Safe Database Changes)

## Goal

Evitare azioni distruttive sul DB e imporre cambi via migrazioni.

## Regole non negoziabili

- MAI eseguire DROP TABLE, TRUNCATE, reset DB, o DELETE senza WHERE.
- Tutte le modifiche schema solo via migrations.
- Preferire cambi additivi (colonne nullable -> backfill -> constraint).

## Workflow richiesto

- ispeziona schema -> piano -> migrazioni -> validazione -> rollback plan.

## Output richiesto

- Plan, migration files, comandi, rollback, validation.
