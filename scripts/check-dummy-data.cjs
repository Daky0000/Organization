const fs = require('fs');
const path = require('path');

const dummyPatterns = [
  /1\.2[Kk]/,           // 1.2K
  /2\.5[Kk]/,           // 2.5K
  /\d+[Kk]\s*(followers|engagement)/i,
  /Lorem/,
  /dummy/i,
  /placeholder/i,
  /test\s*(data|post|metric)/i,
  /\{\s*engagement:\s*\d+\s*\}/,  // Hardcoded objects
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let found = [];
  
  dummyPatterns.forEach((pattern, i) => {
    if (pattern.test(content)) {
      found.push({
        file: filePath,
        pattern: pattern.toString(),
        lineNumber: content.substring(0, content.lastIndexOf(pattern)).split('\n').length
      });
    }
  });
  
  return found;
}

function scanDirectory(dirPath) {
  let results = [];
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        results = results.concat(scanDirectory(fullPath));
      }
    } else {
      results = results.concat(scanFile(fullPath));
    }
  });

  return results;
}

// Scan frontend and backend
const frontendResults = scanDirectory('./frontend');
const backendResults = scanDirectory('./backend');

const allResults = frontendResults.concat(backendResults);

if (allResults.length > 0) {
  console.log('Potential dummy data found:');
  allResults.forEach(result => {
    console.log(`- ${result.file} (line ${result.lineNumber}): matched ${result.pattern}`);
  });
} else {
  console.log('No potential dummy data found.');
}
