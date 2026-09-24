// 브라우저에서 봇 대 봇 경기를 돌려 콘솔 에러가 없는지 보고 스크린샷을 남긴다.
//   node tools/serve.mjs & node tools/browsertest.mjs [출력 폴더]
import { chromium } from 'playwright';

const out = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8080/?auto&time=40');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/shot-fight.png` });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/shot-fight2.png` });
const state = await page.evaluate(() => {
  const s = window.__game.sim;
  return { mode: window.__game.mode, time: s.time.toFixed(1), log: s.log.length, stats: s.fighters.map((f) => f.stats) };
});
console.log(JSON.stringify(state));

// 다운 → 리플레이 → 경기 종료 경로 확인 (턱 기준을 낮춰서 빨리 나오게)
await page.goto('http://localhost:8080/?auto&replay&time=60');
await page.waitForTimeout(800);
await page.evaluate(() => { window.__game.CFG.chinBase = 4; window.__game.CFG.chinMin = 2; });
let sawReplay = false;
for (let i = 0; i < 60 && !sawReplay; i++) {
  await page.waitForTimeout(250);
  sawReplay = (await page.evaluate(() => window.__game.mode)) === 'replay';
}
console.log('리플레이 진입:', sawReplay);
if (sawReplay) { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/shot-replay.png` }); }
let ended = false;
for (let i = 0; i < 80 && !ended; i++) {
  await page.waitForTimeout(250);
  ended = (await page.evaluate(() => window.__game.mode)) === 'end';
}
console.log('경기 종료 화면:', ended);
if (ended) await page.screenshot({ path: `${out}/shot-end.png` });

await page.goto('http://localhost:8080/');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/shot-intro.png` });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : '콘솔 에러 없음');
await browser.close();
