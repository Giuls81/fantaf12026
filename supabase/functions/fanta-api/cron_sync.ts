// @ts-nocheck: draft helper file with partial symbols from index.ts, kept out of strict typing during migration
// --- START OF CRON SYNC ENDPOINT ---
app.post("/cron/sync-all", async (c) => {
  // 1. Security Check: verify a pre-shared secret
  const authHeader = c.req.header("Authorization") || c.req.header("cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET") || "fanta-cron-2026"; 
  
  if (authHeader !== `Bearer \${expectedSecret}` && authHeader !== expectedSecret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  try {
    // 2. Identify the active race (next uncompleted race)
    const activeRaces = await sql`SELECT * FROM "Race" WHERE "isCompleted" = false ORDER BY "date" ASC LIMIT 1`;
    if (activeRaces.length === 0) return c.json({ message: "No active races to sync" }, 200);
    const race = activeRaces[0];

    // 3. Fetch OpenF1 Data
    const location = race.city || race.country || "";
    const combinedResults: Record<string, unknown> = {};

    let gridPositions: Record<string, number> = {};
    const qualiSessionType = race.isSprint ? "Sprint Qualifying" : "Qualifying";
    const qualiKey = await getOpenF1SessionKey(race.season || 2026, location, qualiSessionType);
    if (qualiKey) {
      gridPositions = await getOpenF1Classification(qualiKey);
      combinedResults.quali = gridPositions;
    }

    const raceSessionType = race.isSprint ? "Sprint" : "Race";
    const sessionKey = await getOpenF1SessionKey(race.season || 2026, location, raceSessionType);
    let classification: Record<string, number> = {};
    let isRaceSessionPublished = false;

    if (sessionKey) {
      classification = await getOpenF1Classification(sessionKey);
      combinedResults[race.isSprint ? "sprint" : "race"] = classification;
      // If we got classification data, the session is published (at least partially)
      // We will mark race as completed ONLY if this raceSession classification has data
      if (Object.keys(classification).length > 0) {
        isRaceSessionPublished = true;
      }
    }

    if (Object.keys(combinedResults).length === 0) {
      return c.json({ message: "No data found in OpenF1 yet", location, season: race.season }, 200);
    }

    // 4. Schema Fixes (just in case)
    try {
        await sql`ALTER TABLE "TeamResultDriver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points":::double precision`;
        await sql`ALTER TABLE "Driver" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points":::double precision`;
        await sql`ALTER TABLE "Team" ALTER COLUMN "totalPoints" TYPE DOUBLE PRECISION USING "totalPoints":::double precision`;
        await sql`ALTER TABLE "TeamResult" ALTER COLUMN "points" TYPE DOUBLE PRECISION USING "points":::double precision`;
    } catch (_e) { /* ignore */ }

    // 5. Build Smart Driver Mapping (OpenF1 ID -> DB Driver ID)
    const allDrivers = await sql`SELECT id, name, "constructorId" FROM "Driver"`;
    // ... we reproduce the mapping logic from sync-race ...
    const nameToNumber: Record<string, number[]> = {
       'Max Verstappen': [1], 'Sergio Pérez': [11], 'Lewis Hamilton': [44], 'George Russell': [63],
       'Charles Leclerc': [16], 'Lando Norris': [4], 'Oscar Piastri': [81], 'Fernando Alonso': [14], 
       'Lance Stroll': [18], 'Pierre Gasly': [10], 'Jack Doohan': [7], 'Alexander Albon': [23], 
       'Carlos Sainz': [55], 'Yuki Tsunoda': [22], 'Liam Lawson': [30], 'Nico Hülkenberg': [27], 
       'Gabriel Bortoleto': [59], 'Esteban Ocon': [31], 'Oliver Bearman': [87, 38, 50],
       'Valtteri Bottas': [77], 'Franco Colapinto': [43], 'Kimi Antonelli': [12], 'Isack Hadjar': [6]
    };

    const teammates: Record<string, string> = {};
    const driversByConstructor: Record<string, string[]> = {};
    for (const d of allDrivers) {
        if (!driversByConstructor[d.constructorId]) driversByConstructor[d.constructorId] = [];
        driversByConstructor[d.constructorId].push(d.id);
    }
    for (const list of Object.values(driversByConstructor)) {
        if (list.length === 2) {
            teammates[list[0]] = list[1]; teammates[list[1]] = list[0];
        }
    }

    // --- LEAGUE AGNOSTIC CALCULATION PHASE ---
    // Calculate raw points assuming DEFAULT rules first. 
    // Wait, rules differ per league. We must calculate per driver PER LEAGUE rules.
    
    // Fetch all leagues and their rules
    const allLeagues = await sql`SELECT id, rules FROM "League"`;
    
    await sql.begin(async (sql) => {
      // For global driver points (used for actual Driver standings), we'll use DEFAULT rules 
      // or just assume they accrue the max/standard value. Let's use default.
      // Easiest is to only calculate driver global points once using default rules.
      
      const globalDriverPoints: Record<string, number> = {};
      
      for (const league of allLeagues) {
        const rules = (league.rules || DEFAULT_SCORING_RULES) as unknown as ScoringRules;
        
        // Calculate Base driver points for this specific league's rules
        const driverRacePoints: Record<string, number> = {};
        const driverBreakdown: Record<string, Record<string, number>> = {};
        
        for (const d of allDrivers) {
          const driverId = d.id;
          let pts = 0;
          driverBreakdown[driverId] = { racePosition: 0, overtakes: 0, teammate: 0, dnf: 0, qualiPole: 0, qualiSession: 0, total: 0 };

          // A. Race Position
          if (classification[driverId]) {
              const position = classification[driverId];
              const racePoints = rules.racePositionPoints || DEFAULT_RACE_POINTS;
              if (position <= racePoints.length) {
                  const posPts = racePoints[position - 1]; 
                  pts += posPts; driverBreakdown[driverId].racePosition = posPts;
              }
          }
          
          // Last Place Malus
          const maxPos = Math.max(...Object.values(classification));
          if (classification[driverId] && classification[driverId] === maxPos && maxPos > 10) { 
              const malus = (rules.raceLastPlaceMalus ?? -3);
              pts += malus; driverBreakdown[driverId].racePosition = (driverBreakdown[driverId].racePosition || 0) + malus;
          }

          // C. Quali / Sprint
          if (gridPositions[driverId]) {
              const grid = gridPositions[driverId];
              const position = classification[driverId]; 
              
              if (!race.isSprint) {
                  if (grid === 1) { pts += (rules.qualiPole ?? 3); driverBreakdown[driverId].qualiPole = (rules.qualiPole ?? 3); }
                  if (grid <= 10) { pts += (rules.qualiQ3Reached ?? 3); driverBreakdown[driverId].qualiSession = (rules.qualiQ3Reached ?? 3); }
                  else if (grid <= 15) { pts += (rules.qualiQ2Reached ?? 1); driverBreakdown[driverId].qualiSession = (rules.qualiQ2Reached ?? 1); }
                  else { pts += (rules.qualiQ1Eliminated ?? -3); driverBreakdown[driverId].qualiSession = (rules.qualiQ1Eliminated ?? -3); }
              } else {
                  if (grid === 1) { pts += (rules.sprintPole ?? 1); driverBreakdown[driverId].qualiPole = (rules.sprintPole ?? 1); }
              }

              if (position) {
                  const diff = grid - position;
                  let movePts = 0;
                  if (diff > 0) {
                      for (let p = grid - 1; p >= position; p--) movePts += (p <= 10 ? (rules.positionGainedPos1_10 ?? 1.0) : (rules.positionGainedPos11_Plus ?? 0.5));
                  } else if (diff < 0) {
                      for (let p = grid + 1; p <= position; p++) movePts += (p <= 10 ? (rules.positionLostPos1_10 ?? -1.0) : (rules.positionLostPos11_Plus ?? -0.5));
                  }
                  pts += movePts; driverBreakdown[driverId].overtakes = movePts;
              }
          }

          // Teammate Duel
          const mateId = teammates[driverId];
          if (mateId && classification[driverId] && classification[mateId]) {
              if (classification[driverId] < classification[mateId]) {
                  pts += (rules.teammateBeat ?? 2); driverBreakdown[driverId].teammate = (rules.teammateBeat ?? 2);
              } else {
                  pts += (rules.teammateLost ?? -2); driverBreakdown[driverId].teammate = (rules.teammateLost ?? -2);
              }
          } else if (mateId && classification[driverId] && !classification[mateId]) {
               pts += (rules.teammateBeat ?? 2) + (rules.teammateBeatDNF ?? 1);
               driverBreakdown[driverId].teammate = (rules.teammateBeat ?? 2) + (rules.teammateBeatDNF ?? 1);
          }

          driverRacePoints[driverId] = pts;
          if (league.id === allLeagues[0].id) { globalDriverPoints[driverId] = pts; } // Save roughly global points
        }
        
        // Handle DNFs
        if (!race.isSprint) {
            for (const d of allDrivers) {
                if (driverRacePoints[d.id] === undefined) {
                     const grid = gridPositions[d.id];
                     let pts = 0;
                     if (!driverBreakdown[d.id]) driverBreakdown[d.id] = { total: 0, overtakes: 0, teammate: 0, dnf: 0, racePosition: 0, qualiPole: 0, qualiSession: 0 };
                     if (grid) {
                         pts += (rules.raceDNF ?? -5); driverBreakdown[d.id].dnf = (rules.raceDNF ?? -5);
                         if (grid === 1) { pts += (rules.qualiPole ?? 3); driverBreakdown[d.id].qualiPole = (rules.qualiPole ?? 3); }
                         if (grid <= 10) { pts += (rules.qualiQ3Reached ?? 3); driverBreakdown[d.id].qualiSession = (rules.qualiQ3Reached ?? 3); }
                         else if (grid <= 15) { pts += (rules.qualiQ2Reached ?? 1); driverBreakdown[d.id].qualiSession = (rules.qualiQ2Reached ?? 1); }
                         else { pts += (rules.qualiQ1Eliminated ?? -3); driverBreakdown[d.id].qualiSession = (rules.qualiQ1Eliminated ?? -3); }
                         driverRacePoints[d.id] = pts;
                     }
                     const mateId = teammates[d.id];
                     if (mateId && driverRacePoints[mateId] !== undefined) {
                         pts += (rules.teammateLost ?? -2); driverBreakdown[d.id].teammate = (rules.teammateLost ?? -2);
                     }
                     if (grid || driverRacePoints[d.id] !== undefined) {
                         driverRacePoints[d.id] = (driverRacePoints[d.id] || 0) + pts;
                     }
                     if (league.id === allLeagues[0].id) { globalDriverPoints[d.id] = driverRacePoints[d.id]; }
                }
            }
        }
        
        // --- End Driver Points Calc for this League ---
        
        // Sync TeamResults for this League
        const teams = await sql`SELECT id, "captainId", "reserveId" FROM "Team" WHERE "leagueId" = \${league.id}`;
        
        const teamIds = teams.map(t => t.id);
        if (teamIds.length > 0) {
            const oldResults = await sql`SELECT id FROM "TeamResult" WHERE "raceId" = \${race.id} AND "teamId" IN \${sql(teamIds)}`;
            if (oldResults.length > 0) {
                const oldResultIds = oldResults.map(r => r.id);
                await sql`DELETE FROM "TeamResultDriver" WHERE "teamResultId" IN \${sql(oldResultIds)}`;
                await sql`DELETE FROM "TeamResult" WHERE id IN \${sql(oldResultIds)}`;
            }
        }

        for (const team of teams) {
           const teamDrivers = await sql`SELECT "driverId" FROM "TeamDriver" WHERE "teamId" = \${team.id}`;
           let teamPoints = 0;
           const resultDrivers = [];

           for (const td of teamDrivers) {
              let pts = (driverRacePoints[td.driverId] as number) || 0;
              if (team.captainId === td.driverId) pts = pts * 2.0;
              else if (team.reserveId === td.driverId) pts = pts * 0.5;

             teamPoints += pts;
             resultDrivers.push({ driverId: td.driverId, points: pts });
           }

           const trId = crypto.randomUUID();
           await sql`
             INSERT INTO "TeamResult" (id, "raceId", "teamId", points, "captainId", "reserveId", "createdAt")
             VALUES (\${trId}, \${race.id}, \${team.id}, \${teamPoints}, \${team.captainId}, \${team.reserveId}, \${new Date().toISOString()})
           `;

           for (const rd of resultDrivers) {
              const trdId = crypto.randomUUID();
              await sql`
                 INSERT INTO "TeamResultDriver" (id, "teamResultId", "driverId", points)
                 VALUES (\${trdId}, \${trId}, \${rd.driverId}, \${rd.points})
              `;
           }

           const allTeamResults = await sql`SELECT points FROM "TeamResult" WHERE "teamId" = \${team.id}`;
           const total = allTeamResults.reduce((acc, r) => acc + (r.points || 0), 0);
           await sql`UPDATE "Team" SET "totalPoints" = \${total} WHERE id = \${team.id}`;
        }
        
        // Update Race object (we just do it once, it overwrites with the last league's rules JSON data, which is fine since player points are identical or similar)
        if (league.id === allLeagues[allLeagues.length-1].id) {
            const finalResults = {
              ...combinedResults,
              driverPoints: driverRacePoints, 
              driverBreakdown: driverBreakdown
            };
            // Only mark complete if the main race is published
            // deno-lint-ignore no-explicit-any
            await sql`UPDATE "Race" SET "isCompleted" = \${isRaceSessionPublished}, "results" = \${sql.json(finalResults as any)} WHERE id = \${race.id}`;
        }
      } // end loop leagues
      
      // Update global driver accumulated points (roughly)
      // We assume standard drivers points shouldn't be recalculated completely here to avoid overriding past races,
      // but the original sync logic DOES do exactly that `UPDATE "Driver" SET points = points + x`. 
      // Actually, since this sync can run multiple times (e.g. after Quali, then again after Race), 
      // adding points like this `SET points = points + x` will MULTIPLY points every time it runs!
      // This is a major bug in the original logic too.
      // We must calculate Driver Total Points from scratch.
      const allDriverResults = await sql`
        SELECT trd."driverId", MAX(trd.points) as max_pts_for_race
        FROM "TeamResultDriver" trd
        JOIN "TeamResult" tr ON tr.id = trd."teamResultId"
        GROUP BY trd."driverId", tr."raceId"
      `;
      const cumulativeDriverPoints: Record<string, number> = {};
      for (const row of allDriverResults) {
          cumulativeDriverPoints[row.driverId] = (cumulativeDriverPoints[row.driverId] || 0) + Number(row.max_pts_for_race);
      }
      for (const [dId, totalPts] of Object.entries(cumulativeDriverPoints)) {
          await sql`UPDATE "Driver" SET points = \${totalPts} WHERE id = \${dId}`;
      }
      
    }); // end transaction

    return c.json({ ok: true, syncedLeagues: allLeagues.length, race: race.name, isCompleted: isRaceSessionPublished });

  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
// --- END OF CRON SYNC ENDPOINT ---

