# SKILL: Deploy Safe (Release without chaos)

## Goal

Deploy prevedibili e reversibili.

## Regole non negoziabili

- Segreti solo via env vars, mai nel repo.
- Migrazioni DB solo con piano chiaro + rollback.
- Sempre smoke test post-deploy.

## Output richiesto

- Preflight, deploy steps, migration steps, smoke tests, rollback.
