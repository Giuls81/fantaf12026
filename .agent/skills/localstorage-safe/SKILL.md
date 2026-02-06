# SKILL: LocalStorage Safe (FantaF1)

## Goal

Non rompere i dati salvati in localStorage e mantenere compatibilità tra versioni.

## Storage keys ufficiali

- fantaF1Data
- fantaF1Races
- fantaF1Lang

## Regole non negoziabili

- NON cambiare il nome delle chiavi localStorage.
- NON cambiare la forma di AppData/UserTeam/Race/User/ScoringRules senza fare migrazione in lettura.
- Se aggiungi un campo nuovo, deve avere un default e funzionare con dati vecchi.
- Mai crashare su JSON corrotto: fallback a INITIAL_DATA.
- Mai salvare fantaF1Data se non c’è user (coerente col codice attuale).

## Pattern richiesto

- In lettura: parse -> validate -> patch defaults -> setData.

## Output richiesto quando modifichi storage

- elenco campi nuovi/modificati, snippet migrazione, test manuale (carica dati vecchi e verifica).
