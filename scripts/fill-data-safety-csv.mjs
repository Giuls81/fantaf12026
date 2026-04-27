#!/usr/bin/env node
// Fills the Google Play Data Safety CSV template for FantaGP with the
// same disclosures we made on Apple's App Privacy form:
//
//   User IDs               - collected, required,  purposes: functionality, account
//   Purchase history       - collected, required,  purposes: functionality
//   App interactions       - collected + shared,   purposes: functionality + ads
//   Other user-generated   - collected, optional,  purposes: functionality
//   Crash logs             - collected, required,  purposes: functionality, analytics
//   Device or other IDs    - collected + shared,   purposes: functionality + ads
//
// Input:  data_safety_export.csv (exported from Play Console, 782 rows)
// Output: data_safety_filled.csv (same path, suffix "_filled")
//
// Usage:  node scripts/fill-data-safety-csv.mjs <input.csv>
//         Result printed to stdout if no <output> arg; or written next to input.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2] || 'C:/Users/dalpo/Downloads/data_safety_export.csv';
const outputPath = process.argv[3] || inputPath.replace(/\.csv$/i, '_filled.csv');

// ---------- Single-row answers (text or TRUE) ----------
const SINGLE_ANSWERS = {
  // Top-level
  'PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA': 'TRUE',
  'PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT': 'TRUE',

  // Account-deletion URL
  'PSL_ACCOUNT_DELETION_URL': 'https://giuls81.github.io/fantagp-privacy/delete_account',

  // Login created outside the app? No. (leave PSL_HAS_OUTSIDE_APP_ACCOUNTS blank implies FALSE)
};

// Rows where we want Response value = TRUE by (question_id, response_id) pair
const CHECKED = new Set([
  // Account creation method
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS|PSL_ACM_USER_ID_PASSWORD',

  // Data deletion: No (we delete the account only, no partial deletion)
  'PSL_SUPPORT_DATA_DELETION_BY_USER|DATA_DELETION_NO',

  // ---------- Data types selected (6) ----------
  'PSL_DATA_TYPES_PERSONAL|PSL_USER_ACCOUNT',            // User IDs
  'PSL_DATA_TYPES_FINANCIAL|PSL_PURCHASE_HISTORY',       // Purchase history
  'PSL_DATA_TYPES_APP_ACTIVITY|PSL_USER_INTERACTION',    // App interactions
  'PSL_DATA_TYPES_APP_ACTIVITY|PSL_USER_GENERATED_CONTENT', // Other UGC
  'PSL_DATA_TYPES_APP_PERFORMANCE|PSL_CRASH_LOGS',       // Crash logs
  'PSL_DATA_TYPES_IDENTIFIERS|PSL_DEVICE_ID',            // Device IDs

  // ---------- Usage: User IDs ----------
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_ACCOUNT:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_COLLECTED',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_ACCOUNT:DATA_USAGE_USER_CONTROL|PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_ACCOUNT:DATA_USAGE_COLLECTION_PURPOSE|PSL_APP_FUNCTIONALITY',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_ACCOUNT:DATA_USAGE_COLLECTION_PURPOSE|PSL_ACCOUNT_MANAGEMENT',

  // ---------- Usage: Purchase history ----------
  'PSL_DATA_USAGE_RESPONSES:PSL_PURCHASE_HISTORY:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_COLLECTED',
  'PSL_DATA_USAGE_RESPONSES:PSL_PURCHASE_HISTORY:DATA_USAGE_USER_CONTROL|PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  'PSL_DATA_USAGE_RESPONSES:PSL_PURCHASE_HISTORY:DATA_USAGE_COLLECTION_PURPOSE|PSL_APP_FUNCTIONALITY',

  // ---------- Usage: App interactions (collected + shared with AdMob) ----------
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_COLLECTED',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_SHARED',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:DATA_USAGE_USER_CONTROL|PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:DATA_USAGE_COLLECTION_PURPOSE|PSL_APP_FUNCTIONALITY',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:DATA_USAGE_COLLECTION_PURPOSE|PSL_ADVERTISING',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:DATA_USAGE_SHARING_PURPOSE|PSL_ADVERTISING',

  // ---------- Usage: Other user-generated content (team/league names, collected only) ----------
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_GENERATED_CONTENT:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_COLLECTED',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_GENERATED_CONTENT:DATA_USAGE_USER_CONTROL|PSL_DATA_USAGE_USER_CONTROL_OPTIONAL',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_GENERATED_CONTENT:DATA_USAGE_COLLECTION_PURPOSE|PSL_APP_FUNCTIONALITY',

  // ---------- Usage: Crash logs ----------
  'PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_COLLECTED',
  'PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:DATA_USAGE_USER_CONTROL|PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  'PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:DATA_USAGE_COLLECTION_PURPOSE|PSL_APP_FUNCTIONALITY',
  'PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:DATA_USAGE_COLLECTION_PURPOSE|PSL_ANALYTICS',

  // ---------- Usage: Device or other IDs (AdMob advertising ID — collected + shared) ----------
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_COLLECTED',
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:PSL_DATA_USAGE_COLLECTION_AND_SHARING|PSL_DATA_USAGE_ONLY_SHARED',
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:DATA_USAGE_USER_CONTROL|PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:DATA_USAGE_COLLECTION_PURPOSE|PSL_APP_FUNCTIONALITY',
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:DATA_USAGE_COLLECTION_PURPOSE|PSL_ADVERTISING',
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:DATA_USAGE_SHARING_PURPOSE|PSL_ADVERTISING',
]);

// "Ephemeral" questions — answer FALSE explicitly for every selected data type
// (the MAYBE_REQUIRED rows need an answer once the type is collected)
const EPHEMERAL_FALSE = new Set([
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_ACCOUNT:PSL_DATA_USAGE_EPHEMERAL',
  'PSL_DATA_USAGE_RESPONSES:PSL_PURCHASE_HISTORY:PSL_DATA_USAGE_EPHEMERAL',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_INTERACTION:PSL_DATA_USAGE_EPHEMERAL',
  'PSL_DATA_USAGE_RESPONSES:PSL_USER_GENERATED_CONTENT:PSL_DATA_USAGE_EPHEMERAL',
  'PSL_DATA_USAGE_RESPONSES:PSL_CRASH_LOGS:PSL_DATA_USAGE_EPHEMERAL',
  'PSL_DATA_USAGE_RESPONSES:PSL_DEVICE_ID:PSL_DATA_USAGE_EPHEMERAL',
]);

// ---------- CSV parsing (tolerant to quoted commas) ----------
function parseRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function serializeRow(cols) {
  return cols.map(c => {
    const needsQuotes = /[",\n]/.test(c);
    return needsQuotes ? `"${c.replace(/"/g, '""')}"` : c;
  }).join(',');
}

// ---------- Main ----------
const raw = readFileSync(inputPath, 'utf8');
const lines = raw.split(/\r?\n/);
const header = lines[0];
const out = [header];

let filled = 0;
let seen = 0;
const unmatchedChecks = new Set(CHECKED);
const unmatchedEphemeral = new Set(EPHEMERAL_FALSE);
const unmatchedSingles = new Set(Object.keys(SINGLE_ANSWERS));

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) { out.push(line); continue; }
  const cols = parseRow(line);
  if (cols.length < 3) { out.push(line); continue; }
  seen++;

  const questionId = cols[0];
  const responseId = cols[1];
  const compoundKey = responseId ? `${questionId}|${responseId}` : questionId;

  let newValue = cols[2];

  if (SINGLE_ANSWERS[questionId] !== undefined && !responseId) {
    newValue = SINGLE_ANSWERS[questionId];
    unmatchedSingles.delete(questionId);
    filled++;
  } else if (CHECKED.has(compoundKey)) {
    newValue = 'TRUE';
    unmatchedChecks.delete(compoundKey);
    filled++;
  } else if (EPHEMERAL_FALSE.has(questionId) && !responseId) {
    newValue = 'FALSE';
    unmatchedEphemeral.delete(questionId);
    filled++;
  }

  cols[2] = newValue;
  out.push(serializeRow(cols));
}

writeFileSync(outputPath, out.join('\n'), 'utf8');

console.log(`\n=== Data Safety CSV filled ===`);
console.log(`Input:   ${inputPath}`);
console.log(`Output:  ${outputPath}`);
console.log(`Rows seen: ${seen}`);
console.log(`Values filled: ${filled}`);
if (unmatchedSingles.size || unmatchedChecks.size || unmatchedEphemeral.size) {
  console.log(`\n⚠ Some intended answers didn't match any CSV row:`);
  for (const id of unmatchedSingles) console.log(`  [single]    ${id}`);
  for (const id of unmatchedChecks) console.log(`  [checked]   ${id}`);
  for (const id of unmatchedEphemeral) console.log(`  [ephemeral] ${id}`);
  console.log(`This usually means the template structure changed. Review before importing.`);
}
