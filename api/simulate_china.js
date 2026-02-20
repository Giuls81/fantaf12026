require('dotenv').config();
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

// Simple proxy rules just to assign some points
const DEFAULT_SCORING_RULES = {
  racePositionPoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  raceFastestLap: 1,
  raceLastPlaceMalus: -3,
  qualiQ1Eliminated: -3,
  qualiQ2Reached: 1,
  qualiQ3Reached: 3,
  qualiPole: 3,
  qualiGridPenalty: -3,
  raceDNF: -5,
  racePenalty: -5,
  teammateBeat: 2,
  teammateLost: -2,
  teammateBeatDNF: 1,
  positionGainedPos1_10: 1,
  positionGainedPos11_Plus: 0.5,
  positionLostPos1_10: -1,
  positionLostPos11_Plus: -0.5,
  sprintPositionPoints: [8, 7, 6, 5, 4, 3, 2, 1],
  sprintPole: 1
};

async function simulateChinaGP() {
  await client.connect();
  try {
    const res = await client.query(`SELECT * FROM "Race" WHERE name ILIKE '%China%' or name ILIKE '%Cina%' LIMIT 1`);
    const race = res.rows[0];
    if (!race) {
      console.log('China GP not found!');
      return;
    }
    console.log('Simulating for:', race.name);

    const driversRes = await client.query(`SELECT id, name, "constructorId" FROM "Driver"`);
    const allDrivers = driversRes.rows;

    if (allDrivers.length === 0) return console.log('No drivers');

    const shuffle = (array) => {
      let currentIndex = array.length, randomIndex;
      while (currentIndex > 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
      }
      return array;
    };

    const generateClassification = (drivers) => {
      const shuffled = shuffle([...drivers]);
      const classif = {};
      shuffled.forEach((d, index) => { classif[d.id] = index + 1; });
      return classif;
    };

    const combinedResults = {};
    
    // Grid Setup
    const gridPositions = generateClassification(allDrivers);
    combinedResults.quali = gridPositions;

    // Race Setup 
    const raceClassification = generateClassification(allDrivers);
    combinedResults.race = raceClassification;

    // Sprint setup 
    const sprintClassification = generateClassification(allDrivers);
    combinedResults.sprint = sprintClassification;
    
    // Quali Sprint Setup
    const sprintGridPositions = generateClassification(allDrivers);
    combinedResults.sprintQuali = sprintGridPositions;

    const rules = DEFAULT_SCORING_RULES;

    const teammates = {};
    const driversByConstructor = {};
    for (const d of allDrivers) {
        if (!driversByConstructor[d.constructorId]) driversByConstructor[d.constructorId] = [];
        driversByConstructor[d.constructorId].push(d.id);
    }
    for (const list of Object.values(driversByConstructor)) {
        if (list.length === 2) {
            teammates[list[0]] = list[1];
            teammates[list[1]] = list[0];
        }
    }

    const driverRacePoints = {};
    const driverBreakdown = {};

    for (const d of allDrivers) {
      const driverId = d.id;
      let pts = 0;
      
      driverBreakdown[driverId] = {
           racePosition: 0,
           overtakes: 0,
           teammate: 0,
           dnf: 0,
           qualiPole: 0,
           qualiSession: 0,
           sprintPosition: 0,
           total: 0
       };

      // A. Race Position
      const position = raceClassification[driverId];
      if (position <= 10) {
          const posPts = rules.racePositionPoints[position - 1];
          pts += posPts; 
          driverBreakdown[driverId].racePosition = posPts;
      }

      // B. Quali
      const grid = gridPositions[driverId];
      if (grid === 1) { pts += 3; driverBreakdown[driverId].qualiPole = 3; }
      if (grid <= 10) { pts += 3; driverBreakdown[driverId].qualiSession = 3; }
      else if (grid <= 15) { pts += 1; driverBreakdown[driverId].qualiSession = 1; }
      else { pts += -3; driverBreakdown[driverId].qualiSession = -3; }

      // C. Overtakes
      const diff = grid - position;
      let movePts = 0;
      if (diff > 0) {
          for (let p = grid - 1; p >= position; p--) {
              if (p <= 10) movePts += 1.0;
              else movePts += 0.5;
          }
      } else if (diff < 0) {
          for (let p = grid + 1; p <= position; p++) {
              if (p <= 10) movePts += -1.0;
              else movePts += -0.5;
          }
      }
      pts += movePts;
      driverBreakdown[driverId].overtakes = movePts;

      // Sprint Points
      const sprintPos = sprintClassification[driverId];
      if (sprintPos <= 8) {
          const sPts = rules.sprintPositionPoints[sprintPos - 1];
          pts += sPts;
          driverBreakdown[driverId].sprintPosition = sPts;
      }

      // Teammate logic
      const tmId = teammates[driverId];
      if (tmId) {
          const tmPos = raceClassification[tmId];
          if (position < tmPos) {
              pts += 2;
              driverBreakdown[driverId].teammate = 2;
          } else {
              pts -= 2;
              driverBreakdown[driverId].teammate = -2;
          }
      }

      driverBreakdown[driverId].total = pts;
      driverRacePoints[driverId] = pts;

      // Update DB Points
      await client.query(`UPDATE "Driver" SET points = points + $1 WHERE id = $2`, [pts, driverId]);
    }

    // Save race results 
    await client.query(`UPDATE "Race" SET results = $1, "isCompleted" = true WHERE id = $2`, [JSON.stringify(combinedResults), race.id]);

    console.log('Saved random mock results to race id:', race.id);
    console.log('Driver points updated.');

  } catch (err) {
    console.error('Simulation error:', err);
  } finally {
    await client.end();
  }
}

simulateChinaGP();
