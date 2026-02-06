# SKILL: Tabs & Admin Gate Safe (Layout + Navigation)
## Goal
Mantenere stabile la navigazione e proteggere l’accesso ad Admin.
## Regole non negoziabili
- Tab Admin visibile SOLO se showAdmin === true.
- Non “mostrare ma disabilitare”: deve essere proprio nascosto.
- Non cambiare Tab enum/ids/ordine senza aggiornare tutto il progetto.
## UI invariants
- Bottom nav fixed; contenuto deve avere padding bottom sufficiente per non finire sotto la nav.
## Output richiesto
- elenco tab visibili (admin vs non-admin) + conferma che ADMIN non appare quando showAdmin=false.
