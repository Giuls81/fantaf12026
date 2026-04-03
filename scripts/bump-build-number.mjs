import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const buildArg = process.argv[2];
const versionArg = process.argv[3];

const buildNumber = Number.parseInt(buildArg ?? '', 10);
if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
  console.error('Usage: node scripts/bump-build-number.mjs <buildNumber> [versionName]');
  process.exit(1);
}

const appVersion = versionArg ?? null;

const files = {
  android: 'android/app/build.gradle',
  iosProject: 'ios/App/App.xcodeproj/project.pbxproj',
  iosPlist: 'ios/App/App/Info.plist',
};

const replaceOrThrow = (content, pattern, replacer, label) => {
  if (!content.match(pattern)) {
    throw new Error(`Unable to find ${label}`);
  }
  return content.replace(pattern, replacer);
};

let androidGradle = readFileSync(files.android, 'utf8');
androidGradle = replaceOrThrow(
  androidGradle,
  /(versionCode\s+)\d+/,
  `$1${buildNumber}`,
  'android versionCode'
);
if (appVersion) {
  androidGradle = replaceOrThrow(
    androidGradle,
    /(versionName\s+")([^"]+)(")/,
    `$1${appVersion}$3`,
    'android versionName'
  );
}
writeFileSync(files.android, androidGradle, 'utf8');

let iosProject = readFileSync(files.iosProject, 'utf8');
iosProject = replaceOrThrow(
  iosProject,
  /(CURRENT_PROJECT_VERSION = )\d+(;)/g,
  `$1${buildNumber}$2`,
  'iOS CURRENT_PROJECT_VERSION'
);
if (appVersion) {
  iosProject = replaceOrThrow(
    iosProject,
    /(MARKETING_VERSION = )([^;]+)(;)/g,
    `$1${appVersion}$3`,
    'iOS MARKETING_VERSION'
  );
}
writeFileSync(files.iosProject, iosProject, 'utf8');

let iosPlist = readFileSync(files.iosPlist, 'utf8');
iosPlist = replaceOrThrow(
  iosPlist,
  /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/,
  `$1${buildNumber}$3`,
  'iOS CFBundleVersion'
);
if (appVersion) {
  iosPlist = replaceOrThrow(
    iosPlist,
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/,
    `$1${appVersion}$3`,
    'iOS CFBundleShortVersionString'
  );
}
writeFileSync(files.iosPlist, iosPlist, 'utf8');

console.log(`Build number set to ${buildNumber}${appVersion ? ` (version ${appVersion})` : ''}`);
