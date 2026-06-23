// Temporary recovery script: scan Claude Code transcripts for tool calls touching HazardLayer.jsx
import fs from 'node:fs';
import path from 'node:path';

const dir = 'C:/Users/justine/.claude/projects/C--Users-justine-Desktop-CDRRMO';
const target = /HazardLayer\.jsx/i;

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
const hits = [];

for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.includes('HazardLayer.jsx')) return;
    let obj;
    try { obj = JSON.parse(line); } catch { return; }
    const content = obj?.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block.type === 'tool_use' && ['Write', 'Edit', 'MultiEdit'].includes(block.name)) {
        const fp = block.input?.file_path || '';
        if (target.test(fp)) {
          hits.push({
            session: f, line: i, ts: obj.timestamp, tool: block.name,
            size: block.name === 'Write' ? (block.input.content || '').length : (block.input.new_string || '').length,
          });
        }
      }
    }
  });
}

hits.sort((a, b) => new Date(a.ts) - new Date(b.ts));
for (const h of hits) console.log(`${h.ts}  ${h.tool.padEnd(9)} len=${String(h.size).padStart(6)}  ${h.session}#${h.line}`);
console.log(`TOTAL: ${hits.length}`);
