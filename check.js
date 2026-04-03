// Pre-deploy safety check for JSM Recruiting Dashboard
// Run with: npm run check

const fs = require('fs');
const path = require('path');

const htmlFiles = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(__dirname, f));

let errors = 0;

for (const file of htmlFiles) {
  const name = path.basename(file);
  const content = fs.readFileSync(file, 'utf8');

  // Extract all <script> content
  const scripts = [];
  content.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => {
    if (code.trim()) scripts.push(code);
  });

  for (const code of scripts) {
    const lines = code.split('\n');

    // Check 1: const reassignment (the bug that broke analytics)
    const constVars = new Set();
    lines.forEach((line, i) => {
      const constMatch = line.match(/\bconst\s+(\w+)\s*=/);
      if (constMatch) constVars.add(constMatch[1]);

      // Look for reassignment of known const vars
      for (const v of constVars) {
        const reassign = new RegExp(`^\\s*${v}\\s*=\\s*[^=]`);
        if (reassign.test(line) && !line.includes('const ') && !line.includes('let ')) {
          console.error(`ERROR [${name}] line ~${i + 1}: Reassigning const "${v}" — will crash in strict mode`);
          errors++;
        }
      }
    });

    // Check 2: resp.json() without deep copy (Safari readonly bug)
    const jsonLines = lines.filter(l => l.includes('.json()') && !l.includes('JSON.parse(JSON.stringify'));
    const mutatingAfter = lines.some(l => /\.sort\(|\.splice\(|\.reverse\(|\.pop\(/.test(l));
    if (jsonLines.length > 0 && mutatingAfter) {
      const hasDeepCopy = lines.some(l => l.includes('JSON.parse(JSON.stringify'));
      if (!hasDeepCopy) {
        console.warn(`WARN  [${name}]: Uses .json() and mutates data but missing JSON.parse(JSON.stringify(...)) deep copy — may crash on Safari/iOS`);
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found. Fix before deploying.`);
  process.exit(1);
} else {
  console.log('All checks passed.');
}
