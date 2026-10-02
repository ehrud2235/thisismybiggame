// 실제 브라우저에서 구슬판을 열어 조준·발사·통과까지 돌려 보고 콘솔 에러가 없는지 본다.
//   npm start & node marble/tools/browsertest.mjs [스크린샷 폴더]
import { chromium } from 'playwright';

const out = process.argv[2] || '.';
const url = 'http://localhost:8080/marble/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const watch = async (page) => {
  // 웹폰트는 네트워크가 막힌 환경에서도 테스트가 돌도록 빈 응답으로 대신한다
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const waitRest = async (page) => {
  for (let i = 0; i < 80; i++) {
    if ((await page.evaluate(() => window.__game.world.phase)) !== 'roll') return;
    await page.waitForTimeout(100);
  }
};

// 데스크톱: 마우스로 당겨서 쏘기
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await watch(page);
await page.goto(url);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/marble-start.png` });
await page.mouse.move(640, 400);
await page.mouse.down();
await page.mouse.move(560, 470, { steps: 8 });
await page.screenshot({ path: `${out}/marble-aim.png` });
await page.mouse.up();
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/marble-roll.png` });
await waitRest(page);
const after = await page.evaluate(() => ({ phase: window.__game.world.phase, shots: window.__game.world.shots }));
console.log('마우스 발사 후:', JSON.stringify(after));

// 통과 경로: 시뮬 테스트에서 찾은 한 방 샷
await page.evaluate(() => { window.__game.restart(); window.__game.shoot((323 * Math.PI) / 180, 0.95); });
await waitRest(page);
await page.waitForTimeout(900);
const res = await page.evaluate(() => ({ phase: window.__game.world.phase, result: window.__game.world.result, card: !document.getElementById('result').hidden }));
console.log('통과 샷:', JSON.stringify(res));
await page.screenshot({ path: `${out}/marble-clear.png` });

// 튜닝 패널
await page.keyboard.press('r');
await page.keyboard.press('`');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/marble-debug.png` });

// 휴대폰 세로: 판이 90° 돌아가야 한다
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await watch(phone);
await phone.goto(url);
await phone.waitForTimeout(600);
await phone.screenshot({ path: `${out}/marble-phone.png` });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : '콘솔 에러 없음');
await browser.close();
if (errors.length || !res.card) process.exit(1);
