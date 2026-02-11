// @ts-nocheck
const OPENF1_BASE = "https://api.openf1.org/v1";

async function getSession(year: number, location: string, sessionName: string) {
    const url = `${OPENF1_BASE}/sessions?year=${year}&location=${encodeURIComponent(location)}&session_name=${encodeURIComponent(sessionName)}`;
    console.log(`Fetching ${url}...`);
    const res = await fetch(url);
    return await res.json();
}

async function getClassification(sessionKey: number) {
    const url = `${OPENF1_BASE}/position?session_key=${sessionKey}`;
    console.log(`Fetching ${url}...`);
    const res = await fetch(url);
    return await res.json();
}

async function getLaps(sessionKey: number) {
    // Check for fastest lap or intervals if needed
    // Actually, let's check 'laps' endpoint
    const url = `${OPENF1_BASE}/laps?session_key=${sessionKey}`;
    console.log(`Fetching ${url}...`);
    const res = await fetch(url);
    return await res.json();
}


import fs from 'fs';

async function run() {
    try {
        console.log("Listing 2023 Race sessions...");
        const response = await fetch(`${OPENF1_BASE}/sessions?year=2023&session_name=Race`);
        const data = await response.json();
        
        const output: any = {};

        if (Array.isArray(data)) {
            output.sessions_sample = data.slice(0, 3);
            
             // Find Monza or just use first one
             const raceSession = data.find((s: any) => s.country_name === 'Italy' || s.location === 'Monza' || s.circuit_short_name === 'Monza') || data[0];
             
             if (raceSession) {
                 console.log("Selected Race:", raceSession.session_key, raceSession.country_name);
                 output.raceSession = raceSession;
                 
                 // Find corresponding Quali
                 // Note: Country name might correspond to race, let's try searching by circuit_key or location if available
                 const qUrl = `${OPENF1_BASE}/sessions?year=2023&session_name=Qualifying&circuit_key=${raceSession.circuit_key}`;
                 console.log(`Fetching Quali: ${qUrl}`);
                 const qResponse = await fetch(qUrl);
                 const qData = await qResponse.json();
                 
                 if (Array.isArray(qData) && qData.length > 0) {
                     const qualiSession = qData[0];
                     output.qualiSession = qualiSession;
                     output.qualiSessionKey = qualiSession.session_key;
                     
                     console.log("Fetching Quali Results...");
                     const qualiRes = await getClassification(qualiSession.session_key);
                     output.qualiResultsSample = Array.isArray(qualiRes) ? qualiRes : { error: qualiRes };
                 } else {
                     output.qualiError = qData;
                 }

                 output.raceSessionKey = raceSession.session_key;
                 
                 // Get Race Results
                 console.log("Fetching Race Results...");
                 const raceRes = await getClassification(raceSession.session_key);
                 output.raceResultsSample = Array.isArray(raceRes) ? raceRes : { error: raceRes };
             }
        } else {
            console.log("Data is not an array:", data);
            output.error = data;
        }
        
        fs.writeFileSync('openf1_test_output.json', JSON.stringify(output, null, 2));
        console.log("Output written to openf1_test_output.json");

    } catch (e) {
        console.error(e);
    }
}

run();
