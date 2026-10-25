// Full-game UX, latency, and reconnect audit against the disposable local demo server.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/ashut/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const web = process.env.AUDIT_WEB_URL || 'http://localhost:5175'
const api = process.env.AUDIT_API_URL || 'http://localhost:3011'
const out = 'artifacts/audit/full-game'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = [], timings = [], result = { roles: {}, connection: [], calls: 0, claims: [], errors }
async function login(id, width=390) {
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<640,hasTouch:width<640})
  const page=await context.newPage()
  const requestStarted=new WeakMap()
  page.on('pageerror',e=>errors.push(`${id}: ${e.message}`))
  page.on('console',m=>{if(m.type()==='error'&&!/react\.dev\/link\/react-devtools/.test(m.text())) errors.push(`${id} console: ${m.text()}`)})
  page.on('request',req=>requestStarted.set(req,performance.now()))
  page.on('requestfinished',async req=>{if(req.url().startsWith(api+'/api/games/')&&req.resourceType()==='fetch'){const res=await req.response().catch(()=>null);const started=requestStarted.get(req);if(started!==undefined)timings.push({label:`${id} ${req.method()} ${new URL(req.url()).pathname.split('/').slice(-1)[0]} API`,ms:+(performance.now()-started).toFixed(1),status:res?.status()})}})
  await page.goto(web)
  const name=id==='superadmin'?'Super Admin':id.startsWith('admin')?`Admin ${id.slice(-1)}`:`Member ${id.slice(-1)}`
  await page.getByRole('button',{name:new RegExp(`^${name} `)}).click()
  await page.waitForFunction(expected=>location.pathname===expected,id==='superadmin'?'/super-admin':id.startsWith('admin')?'/admin':'/account')
  return {id,context,page}
}
async function state(actor,gameId,token){
  const r=await actor.context.request.get(`${api}/api/games/${gameId}`,{headers:{Origin:web,Authorization:`Bearer ${token}`}})
  assert.equal(r.status(),200,await r.text());return r.json()
}
async function measured(label,fn){const start=performance.now();const result=await fn();return {label,ms:+(performance.now()-start).toFixed(1),result}}
function latency(entry){timings.push({label:entry.label,ms:entry.ms})}
let actors=[]
try {
  const root=await login('superadmin',1280), admin=await login('admin1'), secondAdmin=await login('admin2')
  const users=[];for(const id of ['user1','user2','user3','user4'])users.push(await login(id))
  actors=[root,admin,secondAdmin,...users]
  await admin.page.getByRole('button',{name:'Create a game',exact:true}).first().click();await admin.page.waitForURL('**/host')
  const host=await admin.page.evaluate(()=>JSON.parse(localStorage.getItem(`tt.v2.host:${localStorage.getItem('tt.account.id')}`)))
  result.game=host.code;result.roles={superAdmin:root.id,hostAdmin:admin.id,observerAdmin:secondAdmin.id,members:users.map(u=>u.id)}
  for(const u of users){await u.page.getByLabel('Game code',{exact:true}).fill(host.code);const start=performance.now();await u.page.getByRole('button',{name:'Join game',exact:true}).click();await u.page.waitForURL('**/play');timings.push({label:`${u.id} join API/UI`,ms:+(performance.now()-start).toFixed(1)})}
  await admin.page.getByRole('button',{name:'Start game with 4',exact:true}).click()
  const playerStatus=users[0].page.getByText('Game on · Playing',{exact:true});const startWait=performance.now();await playerStatus.waitFor();timings.push({label:'Start click → player status',ms:+(performance.now()-startWait).toFixed(1)})
  await users[0].page.getByRole('region',{name:'Claim a pattern',exact:true}).waitFor()
  // independent admin can see shared game; super-admin sees current state
  for(const observer of [root,secondAdmin]){
    await observer.page.getByRole('button',{name:'Refresh games',exact:true}).click()
    await observer.page.getByText(host.code,{exact:true}).waitFor({timeout:8000})
  }
  const board=await admin.context.newPage();board.on('pageerror',e=>errors.push(`board: ${e.message}`));await board.goto(`${web}/board?code=${host.code}`)
  async function clickDraw(seq){
    const p=users[0].page.locator('section.player-clue').getByText(`Call #${seq}`,{exact:true});const begin=performance.now();await admin.page.getByRole('button',{name:/Call Next Question/}).click();await p.waitFor({timeout:10000});const ms=+(performance.now()-begin).toFixed(1);timings.push({label:`Draw #${seq} click → player display`,ms});result.calls++
    await board.getByText(`Call #${seq}`,{exact:true}).waitFor({timeout:10000})
  }
  for(let seq=1;seq<=2;seq++) await clickDraw(seq)
  // Wrong-claim UX and host/admin notification; no mark/punishment.
  const tokens=await Promise.all(users.map(u=>u.page.evaluate(()=>JSON.parse(localStorage.getItem(`tt.v2.player:${localStorage.getItem('tt.account.id')}`)))))
  const beforeWrong=await state(users[0],host.game_id,tokens[0].player_token)
  const wrong=await measured('wrong claim click → member warning and host notification',async()=>{await users[0].page.getByRole('region',{name:'Claim a pattern'}).getByRole('button',{name:/Early Five/}).click();await users[0].page.getByRole('status').filter({hasText:'Incorrect claim'}).waitFor({timeout:8000});await admin.page.getByRole('alert').filter({hasText:'Incorrect claim:'}).waitFor({timeout:8000})});latency(wrong)
  const wrongBody=await state(users[0],host.game_id,tokens[0].player_token);assert.equal(wrongBody.me.score,beforeWrong.me.score);assert.equal(wrongBody.me.wrong_claims,beforeWrong.me.wrong_claims+1)
  result.claims.push({wrongClaim:'player warned, zero points/cells lost',hostNotified:true})
  // Loss of a client network: kill player 2 socket, perform a draw, reconnect and verify catch-up.
  await users[1].page.evaluate(()=>{const s=window.__tambolaSocket; if(s) s.disconnect()})
  // Socket.IO client is imported inside hook; discover socket through its manager transport.
  await users[1].page.evaluate(()=>{for(const k of Object.keys(window)){try{const v=window[k];if(v&&v.io&&typeof v.disconnect==='function')v.disconnect()}catch{}}})
  // Deterministic offline simulation via browser context offline.
  await users[1].context.setOffline(true)
  const offlineStart=performance.now();await clickDraw(3);await users[1].context.setOffline(false)
  await users[1].page.locator('section.player-clue').getByText('Call #3',{exact:true}).waitFor({timeout:20000})
  result.connection.push({case:'player internet disabled during draw, restored',recovered:true,catchupMs:+(performance.now()-offlineStart).toFixed(1)})
  // Pause/resume, historical selection, reveal and live state propagation.
  for(const [action,status] of [['Pause','Game paused'],['Resume','Game on · Playing']]){
    const begin=performance.now();await admin.page.getByRole('button',{name:action,exact:true}).click();await users[2].page.getByText(status,{exact:true}).waitFor({timeout:8000});timings.push({label:`${action} click → player status`,ms:+(performance.now()-begin).toFixed(1)})
  }
  for(let seq=4;seq<=6;seq++)await clickDraw(seq)
  await admin.page.getByRole('button',{name:/Reveal All/}).click();await users[3].page.locator('section.player-clue').getByText(/Answer Revealed/).waitFor({timeout:8000});result.claims.push({reveal:'host batch reveal reached member'})
  await admin.page.getByRole('button',{name:'Show question 2 to players',exact:true}).click();await users[2].page.locator('section.player-clue').getByText('Call #2',{exact:true}).waitFor({timeout:8000});result.historySelection='historical question selected and displayed'
  await admin.page.getByRole('button',{name:'Back to live',exact:true}).click();await users[2].page.locator('section.player-clue').getByText('Call #6',{exact:true}).waitFor({timeout:8000})
  // Mark cells based on official calls then verify accepted and rejected claims; confirm other user's state update.
  let s1=await state(users[0],host.game_id,tokens[0].player_token);const ticketNumbers=s1.me.ticket.flat().filter(Boolean);let calledSet=new Set(s1.calls.map(c=>c.number));
  while(ticketNumbers.filter(n=>calledSet.has(n)).length<5){await clickDraw(result.calls+1);s1=await state(users[0],host.game_id,tokens[0].player_token);calledSet=new Set(s1.calls.map(c=>c.number))}
  for(const n of ticketNumbers.filter(n=>calledSet.has(n)))await users[0].page.locator(`button[title^="#${n}:"]`).click()
  const accepted=await users[0].page.getByRole('button',{name:/Early Five/});const begin=performance.now();await accepted.click();await users[0].page.getByText(/Early Five accepted/).waitFor({timeout:10000});timings.push({label:'Valid claim click → confirmation',ms:+(performance.now()-begin).toFixed(1)})
  await users[1].page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>/Early Five/.test(b.textContent||'')&&b.disabled),{timeout:10000});result.claims.push({valid:'accepted',otherMemberPrizeDisabled:true})
  // Disconnect and reconnect a device explicitly, verify Socket.IO indicator and state snapshot.
  const latestBeforeReconnect=await state(users[2],host.game_id,tokens[2].player_token)
  await users[2].context.setOffline(true);await users[2].page.waitForTimeout(500);await users[2].context.setOffline(false)
  await users[2].page.locator('section.player-clue').getByText(`Call #${latestBeforeReconnect.calls.length}`,{exact:true}).waitFor({timeout:20000});result.connection.push({case:'browser offline/online reconnect',recovered:true,caughtUpTo:latestBeforeReconnect.calls.length})
  while(result.calls<90)await clickDraw(result.calls+1)
  result.fullGame={calls:result.calls,distinctNumbers:new Set((await state(users[0],host.game_id,tokens[0].player_token)).calls.map(c=>c.number)).size}
  for(const n of ticketNumbers){const cell=users[0].page.locator(`button[title^="#${n}:"]`);if(await cell.getAttribute('aria-pressed')==='false')await cell.click()}
  await users[0].page.getByLabel('Ticket save status').getByText('Ticket saved',{exact:true}).waitFor()
  let afterTapMarks=await state(users[0],host.game_id,tokens[0].player_token);result.manualMarkAudit={ticketCells:ticketNumbers.length,selectedImmediately:afterTapMarks.me.marked.length,selectedNumbers:afterTapMarks.me.marked}
  assert.equal(afterTapMarks.me.marked.length,15,'Every selected cell must be confirmed before claiming')
  await users[0].page.getByRole('region',{name:'Claim a pattern'}).getByRole('button',{name:/Full House/}).click();await users[0].page.getByText(/Full House accepted/).waitFor({timeout:10000});result.claims.push({fullHouse:'accepted'})
  const t2=await state(users[1],host.game_id,tokens[1].player_token);for(const n of t2.me.ticket.flat().filter(Boolean))await users[1].page.locator(`button[title^="#${n}:"]`).click()
  await users[1].page.getByRole('region',{name:'Claim a pattern'}).getByRole('button',{name:/Second House/}).click();await users[1].page.getByText(/Second House accepted/).waitFor({timeout:10000});result.claims.push({secondHouse:'accepted',gameEnded:true})
  // End cleanly; game state must reach all members.
  await users[0].page.getByText('Game ended',{exact:true}).waitFor({timeout:10000})
  result.end='finished status reached player'
  result.timings=timings;result.latencySummary=Object.fromEntries(['Draw #','click → player status','Valid claim','wrong claim'].map(prefix=>{const a=timings.filter(t=>t.label.includes(prefix)).map(t=>t.ms).sort((a,b)=>a-b);return [prefix,a.length?{n:a.length,min:a[0],median:a[Math.floor(a.length/2)],max:a.at(-1)}:null]}))
  result.errors=errors;await writeFile(`${out}/report.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));assert.deepEqual(errors,[])
}catch(error){result.failure=String(error);result.errors=errors;await writeFile(`${out}/report.json`,JSON.stringify(result,null,2));for(const a of actors)await a.page.screenshot({path:`${out}/${a.id}-failure.png`,fullPage:true}).catch(()=>{});throw error}
finally{await browser.close()}
