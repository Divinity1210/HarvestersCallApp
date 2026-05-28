const fs = require('fs');
const data = JSON.parse(fs.readFileSync('test_script.json'));
let script = data[0].script_template;

script = script.replace(/\\n/g, '\n');
script = script.replace(/\{\{attendee_name\}\}/gi, '[Attendee]');

const sections = [];
let currentSection = { title: 'Introduction', lines: [] };

script.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed.startsWith('## ')) {
    if (currentSection.lines.length > 0) {
      sections.push(currentSection);
    }
    currentSection = { title: trimmed.replace('## ', ''), lines: [] };
  } else if (trimmed) {
    currentSection.lines.push(trimmed);
  }
});

if (currentSection.lines.length > 0) {
  sections.push(currentSection);
}

console.log(JSON.stringify(sections, null, 2));
