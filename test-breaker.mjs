// End-to-end smoke test for icantstudy_link_assignment_breaker.html in real Chrome.
// Run: node test-breaker.mjs   (requires Chrome at the path below)
import puppeteer from 'puppeteer-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = pathToFileURL(fileURLToPath(new URL('icantstudy_link_assignment_breaker.html', import.meta.url))).href;
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

// ---------- fixtures ----------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

// real PDF via Chrome print-to-pdf
{
  const p = await browser.newPage();
  await p.goto('data:text/html,<h1>Assignment 4: Binary Heap</h1><p>Implement a min-heap in Python. Deliverables: heap.py, a 2-page design report, 60-word summary. Deadline worth 15%%. Rubric: correctness, tests, style. 1200 words report.</p>');
  fs.mkdirSync('fixtures', { recursive: true });
  await p.pdf({ path: 'fixtures/sample.pdf', printBackground: false });
  await p.close();
}

// real DOCX
{
  const doc = new Document({
    sections: [{
      children: [
      new Paragraph({ children: [new TextRun('Assignment 5: Sorting Lab')] }),
        new Paragraph({ children: [new TextRun('Implement quicksort and mergesort in C++. Write a 500 word analysis of runtime benchmarks. Submit code plus report.')] }),
      ],
    }],
  });
  fs.writeFileSync('fixtures/sample.docx', await Packer.toBuffer(doc));
}

// ---------- main page ----------
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
await page.setViewport({ width: 1280, height: 900 });
await page.goto(PAGE, { waitUntil: 'networkidle0' });

ok('page loads with no page errors', pageErrors.length === 0, pageErrors[0] || '');

// PDF upload → text actually extracted
const fileInput = await page.$('#file-input');
await fileInput.uploadFile('fixtures/sample.pdf');
await page.waitForFunction(() => state.files.length > 0, { timeout: 15000 });
const pdfText = await page.evaluate(() => state.files[0].textContent);
ok('PDF upload extracts real text', /Binary Heap|min-heap/i.test(pdfText), pdfText.slice(0, 80));

// DOCX upload
await fileInput.uploadFile('fixtures/sample.docx');
await page.waitForFunction(() => state.files.length > 1, { timeout: 15000 });
const docxText = await page.evaluate(() => state.files[1].textContent);
ok('DOCX upload extracts real text', /quicksort|Sorting Lab/i.test(docxText), docxText.slice(0, 80));

// Full flow: paste essay sample → calibrate → plan
await page.evaluate(() => { state.files = []; renderFileList(); });
await page.click('button[onclick="loadSample(\'essay\')"]');
await page.evaluate(() => {
  const d = new Date(Date.now() + 7 * 86400000);
  const el = document.getElementById('deadline-input');
  el.value = toLocalDateTimeInputValue(d);
  el.dispatchEvent(new Event('change'));
});
await page.click('button[onclick="goToCalibration()"]');
await page.waitForFunction(() => !document.getElementById('step-2').classList.contains('hidden'));
await page.evaluate(() => { selectConfidence(2); selectPace('busy'); selectGrade('A'); });
await page.evaluate(() => processAssignment());
await page.waitForFunction(() => !document.getElementById('step-3').classList.contains('hidden'), { timeout: 15000 });

const dash = await page.evaluate(() => ({
  hours: document.getElementById('metric-hours').textContent,
  tasks: document.querySelectorAll('#subtasks-accordion input[type=checkbox]').length,
  bars: document.querySelectorAll('#timeline-diagram > div').length,
  curves: document.querySelectorAll('#pressure-svg path').length,
  stress: document.getElementById('metric-stress').textContent,
  note: document.getElementById('baseline-note').textContent,
}));
ok('dashboard shows plausible hours', /^[\d.]+h$/.test(dash.hours), dash.hours);
ok('subtask checkboxes rendered', dash.tasks >= 12, `${dash.tasks} tasks`);
ok('gantt bars rendered', dash.bars >= 5, `${dash.bars}`);
ok('pressure curves + area rendered', dash.curves >= 4, `${dash.curves} paths`);
ok('stress metric rendered', /\/10/.test(dash.stress), dash.stress);
ok('baseline note is honest (no subreddit claims)', !/r\/|forum/i.test(dash.note) && /heuristic/i.test(dash.note));

// Checking a task updates progress
await page.evaluate(() => toggleSubtask(0, 0));
const prog = await page.evaluate(() => document.getElementById('metric-progress-text').textContent);
ok('task checkbox updates progress', /\d+% done/.test(prog), prog);

// Persistence: reload → auto-restore plan
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => !document.getElementById('step-3').classList.contains('hidden'), { timeout: 10000 });
const restored = await page.evaluate(() => ({ done: state.completedTasks.size, hours: document.getElementById('metric-hours').textContent }));
ok('plan survives refresh (localStorage)', restored.done === 1 && /h$/.test(restored.hours), JSON.stringify(restored));

// Capacity warning: 1-day deadline + confidence 1 on CS sample
await page.evaluate(() => resetAll());
await page.evaluate(() => loadSample('cs'));
await page.evaluate(() => {
  const el = document.getElementById('deadline-input');
  el.value = toLocalDateTimeInputValue(new Date(Date.now() + 36 * 3600000));
  el.dispatchEvent(new Event('change'));
  goToCalibration();
  selectConfidence(1); selectPace('busy'); selectGrade('A');
});
await page.evaluate(() => processAssignment());
await page.waitForFunction(() => !document.getElementById('step-3').classList.contains('hidden'), { timeout: 15000 });
const warn = await page.evaluate(() => ({
  visible: !document.getElementById('capacity-warning').classList.contains('hidden'),
  text: document.getElementById('capacity-warning').textContent,
}));
ok('capacity warning fires when plan > daily budget', warn.visible, warn.text.slice(0, 90));

ok('no page errors during full run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
