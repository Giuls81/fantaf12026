
// Mock Test Framework
function describe(name: string, fn: () => void) { console.log(`\n${name}`); fn(); }
function it(name: string, fn: () => void) { console.log(`  - ${name}`); fn(); }
const expect = (actual: any) => ({
    toBe: (expected: any) => {
        if (actual !== expected) console.error(`    FAIL: Expected ${expected}, got ${actual}`);
        else console.log(`    PASS: Got ${actual}`);
    }
});

// Mock Constants
const DEFAULT_SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const SCORING = {
    RACE_LAST_PLACE: -3,
    QUALI_Q1_ELIM: -3,
    QUALI_Q2_REACHED: 1,
    QUALI_Q3_REACHED: 3,
    QUALI_POLE: 3,
    SPRINT_POLE: 2, 
    RACE_DNF: -5,
    TEAMMATE_BEAT: 2,
    TEAMMATE_LOST: -2,
    TEAMMATE_BEAT_DNF: 1,
    POS_GAINED: 1,
    POS_LOST: -1
};

// Drivers & Teams Mock
const drivers = [
    { id: 'ver', constructorId: 'rbr' },
    { id: 'per', constructorId: 'rbr' }, 
    { id: 'lec', constructorId: 'fer' },
    { id: 'ham', constructorId: 'fer' },
];

const teammates: Record<string, string> = {
    'ver': 'per', 'per': 'ver',
    'lec': 'ham', 'ham': 'lec',
};

// ---------------------------------------------------------
// SPRINT TEST DATA
// ---------------------------------------------------------

// Sprint Shootout (Grid)
const sprintGridPositions: Record<string, number> = {
    'ver': 1,   // Pole (Starts 1st)
    'per': 4,   // Starts 4th
    'lec': 2,   // Starts 2nd
    'ham': 10,  // Starts 10th
};

// Sprint Race Result
const sprintClassification: Record<string, number> = {
    'ver': 1,   // 1st (8pts) -> Grid 1 -> Same
    'per': 3,   // 3rd (6pts) -> Grid 4 -> Gained 1 (4->3)
    'lec': 5,   // 5th (4pts) -> Grid 2 -> Lost 3 (2->3->4->5)
    'ham': 8,   // 8th (1pt)  -> Grid 10-> Gained 2 (10->9->8)
};

function calculateSprintPoints() {
    console.log("\n--- CALCULATING SPRINT POINTS ---");
    const driverPoints: Record<string, number> = {};
    const details: Record<string, any> = {};

    for (const [driverId, position] of Object.entries(sprintClassification)) {
        let pts = 0;
        const log: string[] = [];

        // A. Sprint Position Points
        if (position >= 1 && position <= DEFAULT_SPRINT_POINTS.length) {
            const p = DEFAULT_SPRINT_POINTS[position - 1] ?? 0;
            pts += p;
            log.push(`Sprint Pos ${position}: +${p}`);
        }

        // B. Shootout Bonuses (Pole Only? Or Pos Change too?)
        const grid = sprintGridPositions[driverId];
        if (grid) {
            // Sprint Pole
            if (grid === 1) { 
                pts += SCORING.SPRINT_POLE; 
                log.push(`Sprint Pole +${SCORING.SPRINT_POLE}`); 
            }
            
            // Pos Change (Standard 1 / 0.5 rules)
            const diff = grid - position;
            let movePts = 0;
            if (diff > 0) {
                 for (let p = grid - 1; p >= position; p--) {
                      movePts += (p <= 10 ? 1 : 0.5);
                 }
                 log.push(`Gained ${diff} (Calc): +${movePts}`);
            } else if (diff < 0) {
                 for (let p = grid + 1; p <= position; p++) {
                      movePts -= (p <= 10 ? 1 : 0.5);
                 }
                 log.push(`Lost ${Math.abs(diff)} (Calc): ${movePts}`);
            }
            pts += movePts;
        }

        // Teammate Logic (Same as Race)
        const mateId = teammates[driverId];
        if (mateId) {
            if (sprintClassification[mateId]) {
                if (position < sprintClassification[mateId]) {
                    pts += SCORING.TEAMMATE_BEAT;
                    log.push('Beat Mate +2');
                } else {
                    pts += SCORING.TEAMMATE_LOST;
                    log.push('Lost Mate -2');
                }
            } else {
                 // Assume DNF logic same
            }
        }

        driverPoints[driverId] = pts;
        details[driverId] = log;
    }

    return { driverPoints, details };
}

// Run
const results = calculateSprintPoints();
console.log(JSON.stringify(results, null, 2));

// Expected:
// VER: Pos 1 (8), Pole (2), Change 0, Beat Per (2) = 12
// PER: Pos 3 (6), Change +1 (1), Lost Ver (-2) = 5
// LEC: Pos 5 (4), Change -3 (Loss: 3->-1, 4->-1, 5->-1 = -3), Beat Ham (2) = 3
// HAM: Pos 8 (1), Change +2 (9->1, 8->1 = +2), Lost Lec (-2) = 1
