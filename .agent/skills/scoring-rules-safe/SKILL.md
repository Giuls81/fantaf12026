# SKILL: Scoring Rules Safety (Admin UI)

## Goal

Evitare NaN e array di lunghezza sbagliata nelle scoring rules.

## Regole non negoziabili

- racePositionPoints deve avere 10 numeri validi.
- sprintPositionPoints deve avere 8 numeri validi.
- Mai permettere NaN dentro data.rules.

## Nota

L’Admin UI attuale fa split(',').map(Number) e può produrre NaN: se si tocca quella parte, aggiungere validazione/fallback.

## Output richiesto

- esempio input valido/invalid + comportamento (errore UI o ripristino default).
