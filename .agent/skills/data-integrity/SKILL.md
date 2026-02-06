# SKILL: Data Integrity (Drivers/Constructors/Races)
## Goal
Garantire coerenza tra liste e formati date/utc.
## Regole non negoziabili
- Ogni Driver.constructorId deve matchare un Constructor.id esistente.
- Driver.id / Constructor.id / Race.id devono essere unici.
- Race.date formato YYYY-MM-DD.
- Campi UTC se presenti devono essere ISO con 'Z'.
## Regole sprint
- Se isSprint true: sprintQualifyingUtc e sprintUtc dovrebbero essere valorizzati.
- Se isSprint false: sprintQualifyingUtc e sprintUtc devono restare null (o non usati).
## Output richiesto
- integrity checks + conferma “no breaking changes” per App.tsx.
