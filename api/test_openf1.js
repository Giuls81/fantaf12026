async function testOpenF1() {
  try {
    const resAus = await fetch("https://api.openf1.org/v1/sessions?country_name=Australia&year=2026");
    if (resAus.ok) {
      const aus = await resAus.json();
      console.log(`Found ${aus.length} sessions in Australia for 2026.`);
      
      const quali = aus.find(s => s.session_name === 'Qualifying');
      if (quali) {
        console.log(`Qualifying session found: key=${quali.session_key}, date=${quali.date_start}`);
        
        console.log(`\nFetching positions for Qualifying...`);
        const cRes = await fetch(`https://api.openf1.org/v1/position?session_key=${quali.session_key}`);
        if (cRes.ok) {
          const positions = await cRes.json();
          console.log(`Found ${positions.length} position records.`);
          if (positions.length > 0) {
            console.log("Sample:", positions[0]);
          }
        } else {
          console.log(`Position fetch failed: HTTP ${cRes.status}`);
        }
      } else {
        console.log("Qualifying session not found!");
      }
    }

  } catch (e) {
    console.error("Error:", e.message);
  }
}

testOpenF1();
