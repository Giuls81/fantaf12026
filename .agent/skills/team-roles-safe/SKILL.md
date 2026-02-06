# SKILL: Team Roles Invariants (Captain/Reserve)

## Goal

Non permettere stati team invalidi e preservare sanitizeTeamRoles.

## Invarianti obbligatori

- captainId ∈ driverIds oppure null
- reserveDriverId ∈ driverIds oppure null
- captainId != reserveDriverId
- se driverIds.length < 2 => reserveDriverId = null
- se driverIds.length > 0 e captainId mancante => auto-assign
- se driverIds.length === 5 e reserve mancante => auto-assign (non uguale captain)

## Regole non negoziabili

- Ogni modifica a driverIds (buy/swap/remove) deve passare per sanitizeTeamRoles.
- Non introdurre nuove strade che aggiornano team senza sanitizzazione.

## Output richiesto

- invarianti confermati + 2 esempi prima/dopo (swap con captain, swap con reserve).
