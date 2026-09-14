const STORAGE_KEY = "secondBankerAdvisorRollingV1";
const HISTORY_KEY = "secondBankerAdvisorHistoryRollingV1";
const VOICE_KEY = "secondBankerVoiceV1";

const defaultState = () => ({
  settings: { startingBankroll:500, baseUnit:10, commission:5, takeProfit:50, stopLoss:100 },
  bankroll:500,
  highestBankroll:500,
  lowestBankroll:500,
  maxDrawdown:0,
  totalWagered:0,
  shoe:[],
  snapshots:[],
  cycleResults:[],
  levelWins:{},
  machine:{
    state:"WAITING",
    playerStreak:0,
    armed:false,
    triggerSeen:false,
    currentUnit:1,          // actual current betting unit
    cycleStartUnit:1,       // unit to start next triggered cycle
    attemptInCycle:0,       // 1..3 when betting
    lossesAfterTrigger:0,
    cycleNo:0,
    cyclesWon:0,
    cyclesRearmed:0,
    cycleStartBankroll:500
  },
  sessionStopped:false
});

let app = loadState() || defaultState();
let voiceEnabled = localStorage.getItem(VOICE_KEY)==="1";

function money(v){return `R${Number(v).toFixed(2)}`;}
function loadState(){
  try{
    const r=localStorage.getItem(STORAGE_KEY);
    if(!r) return null;
    const parsed=JSON.parse(r);

    // Light migration from older version if needed.
    if(parsed.machine && parsed.machine.currentUnit===undefined){
      parsed.machine.currentUnit = parsed.machine.currentLevel || 1;
      parsed.machine.cycleStartUnit = 1;
      parsed.machine.attemptInCycle = parsed.machine.currentLevel ? parsed.machine.currentLevel : 0;
      delete parsed.machine.currentLevel;
    }
    if(!parsed.levelWins) parsed.levelWins={};
    return parsed;
  }catch{return null}
}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(app));}
function loadHistory(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]")}catch{return []}}
function saveHistory(h){localStorage.setItem(HISTORY_KEY,JSON.stringify(h));}
function clone(o){return JSON.parse(JSON.stringify(o));}
function currentBetAmount(){return app.machine.attemptInCycle>0 ? app.settings.baseUnit*app.machine.currentUnit : 0;}

function speak(msg){
  if(!voiceEnabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(msg);
  u.rate=1;
  window.speechSynthesis.speak(u);
}

function snapshot(){
  const c=clone(app); c.snapshots=[];
  app.snapshots.push(c);
  if(app.snapshots.length>100) app.snapshots.shift();
}

function checkLimits(){
  const pl=app.bankroll-app.settings.startingBankroll;
  if(app.settings.stopLoss>0 && pl<=-app.settings.stopLoss) app.sessionStopped=true;
  if(app.settings.takeProfit>0 && pl>=app.settings.takeProfit) app.sessionStopped=true;
  if(app.machine.attemptInCycle>0 && currentBetAmount()>app.bankroll) app.sessionStopped=true;
}

function updateRisk(){
  app.highestBankroll=Math.max(app.highestBankroll,app.bankroll);
  app.lowestBankroll=Math.min(app.lowestBankroll,app.bankroll);
  app.maxDrawdown=Math.max(app.maxDrawdown, app.highestBankroll-app.bankroll);
  checkLimits();
}

function finishCycle(resultUnit){
  const m=app.machine;
  const cycleResult=app.bankroll-m.cycleStartBankroll;
  app.cycleResults.push(cycleResult);
  if(resultUnit){
    app.levelWins[resultUnit]=(app.levelWins[resultUnit]||0)+1;
  }
}

function processResult(result){
  if(app.sessionStopped){
    alert("Session stop condition reached. Start a new session to continue.");
    return;
  }

  snapshot();
  const m=app.machine;
  const before=clone(m);
  const betWasActive=m.attemptInCycle>0;
  let isTrigger=false;
  let betAmount=0;
  let outcome=null;

  if(m.state==="CYCLE_WON") m.state="WAITING";

  if(betWasActive){
    betAmount=currentBetAmount();

    if(result==="T"){
      outcome="push";
      // Same attempt and same unit.
    }else{
      app.totalWagered+=betAmount;

      if(result==="B"){
        const winningUnit=m.currentUnit;
        app.bankroll += betAmount*(1-app.settings.commission/100);
        m.cyclesWon++;
        outcome="win";
        finishCycle(winningUnit);

        // ROLLING RULE:
        // Next triggered cycle starts at winning unit - 1, floor 1.
        m.cycleStartUnit=Math.max(1, winningUnit-1);

        m.state="CYCLE_WON";
        m.attemptInCycle=0;
        m.lossesAfterTrigger=0;
        m.triggerSeen=false;
        m.armed=false;
        m.playerStreak=0;
        m.currentUnit=m.cycleStartUnit;

        speak(`Banker win at ${winningUnit} units. Next trigger starts at ${m.cycleStartUnit} units.`);
      }else{
        app.bankroll -= betAmount;
        outcome="loss";
        m.lossesAfterTrigger++;
        m.playerStreak++;

        if(m.attemptInCycle < 3){
          // Move to next unit inside the same 3-attempt cycle.
          m.currentUnit += 1;
          m.attemptInCycle += 1;
          m.state = m.attemptInCycle===2 ? "BET_ATTEMPT_2" : "BET_ATTEMPT_3";
          speak(`Next attempt. Bet Banker ${m.currentUnit} units, ${money(app.settings.baseUnit*m.currentUnit)}.`);
        }else{
          // Third loss: stop and re-arm.
          // The NEXT trigger starts at the LAST UNIT REACHED (not +1).
          finishCycle(null);
          m.cyclesRearmed++;
          m.cycleStartUnit=m.currentUnit;
          m.attemptInCycle=0;
          m.armed=true;
          m.triggerSeen=false;
          m.state="REARMED_AFTER_3P";

          speak(`Three Player losses. Stop betting. Next trigger starts at ${m.cycleStartUnit} units.`);
        }
      }
    }
  }else{
    if(result==="T"){
      // neutral
    }else if(result==="P"){
      m.playerStreak++;
      if(m.playerStreak>=2){
        m.armed=true;
        m.state="PLAYER_STREAK_ARMED";
        if(m.playerStreak===2) speak("Player streak armed. Wait for Banker.");
      }else{
        m.state="WAITING";
      }
    }else{
      if(m.armed && m.playerStreak>=2){
        m.cycleNo++;
        m.cycleStartBankroll=app.bankroll;
        isTrigger=true;
        m.triggerSeen=true;
        m.armed=false;
        m.playerStreak=0;
        m.lossesAfterTrigger=0;

        // Start at carried cycleStartUnit.
        m.currentUnit=Math.max(1,m.cycleStartUnit);
        m.attemptInCycle=1;
        m.state="TRIGGER_BANKER";

        speak(`Banker trigger. Start at ${m.currentUnit} units, ${money(app.settings.baseUnit*m.currentUnit)}.`);
      }else{
        m.playerStreak=0;
        m.state="WAITING";
      }
    }
  }

  updateRisk();

  app.shoe.push({
    n:app.shoe.length+1,
    result,
    betWasActive,
    isTrigger,
    betAmount,
    betUnit: betWasActive ? before.currentUnit : 0,
    outcome,
    stateBefore:before.state,
    stateAfter:m.state,
    bankrollAfter:app.bankroll,
    nextStartUnit:m.cycleStartUnit
  });

  save();
  render();
}

function advice(){
  const m=app.machine;
  const pl=app.bankroll-app.settings.startingBankroll;

  if(app.sessionStopped){
    if(app.settings.takeProfit>0 && pl>=app.settings.takeProfit)
      return["TAKE-PROFIT REACHED",`Session target reached at ${money(pl)}. End the session.`,"","success"];
    if(app.settings.stopLoss>0 && pl<=-app.settings.stopLoss)
      return["STOP-LOSS REACHED",`Session loss is ${money(pl)}. End the session.`,"","danger"];
    return["STOP SESSION","Insufficient bankroll for the next required bet.","","danger"];
  }

  if(m.state==="CYCLE_WON")
    return["BANKER CAPTURED",`Cycle complete. Next trigger starts at ${m.cycleStartUnit} unit${m.cycleStartUnit===1?"":"s"}.`,"","success"];

  if(m.state==="TRIGGER_BANKER")
    return["BET BANKER",`Trigger detected. Attempt 1 of 3 at ${m.currentUnit} unit${m.currentUnit===1?"":"s"}.`,money(app.settings.baseUnit*m.currentUnit),"warning"];

  if(m.state==="BET_ATTEMPT_2")
    return["BET BANKER",`Attempt 2 of 3 at ${m.currentUnit} units.`,money(app.settings.baseUnit*m.currentUnit),"warning"];

  if(m.state==="BET_ATTEMPT_3")
    return["BET BANKER",`Attempt 3 of 3 at ${m.currentUnit} units.`,money(app.settings.baseUnit*m.currentUnit),"danger"];

  if(m.state==="REARMED_AFTER_3P")
    return["STOP BETTING",`Three Player losses formed a new Player streak. Wait for Banker. Next cycle starts at ${m.cycleStartUnit} units.`,"","danger"];

  if(m.state==="PLAYER_STREAK_ARMED")
    return["PLAYER STREAK ARMED",`Player streak: ${m.playerStreak}. Wait for the first Banker.`,"","warning"];

  return["WAIT",m.playerStreak===1?"One Player recorded. Need one more Player to arm the trigger.":"Looking for 2+ consecutive Player results.","",""];
}

function cycleHint(){
  const m=app.machine;
  if(m.state==="TRIGGER_BANKER") return `Rolling progression start: ${m.currentUnit} → ${m.currentUnit+1} → ${m.currentUnit+2}.`;
  if(m.state==="BET_ATTEMPT_2") return `If this loses, final attempt is ${m.currentUnit+1} units.`;
  if(m.state==="BET_ATTEMPT_3") return `If this loses, stop and re-arm; next trigger restarts at ${m.currentUnit} units.`;
  if(m.state==="REARMED_AFTER_3P") return `Do not bet yet. New trigger will restart at ${m.cycleStartUnit} units.`;
  if(m.state==="PLAYER_STREAK_ARMED") return "Do not bet yet. Wait for Banker.";
  if(m.state==="CYCLE_WON") return `After the win, progression stepped back to ${m.cycleStartUnit} units for the next trigger.`;
  return `Next trigger start unit: ${m.cycleStartUnit}.`;
}

function renderHistory(){
  const list=document.getElementById("historyList");
  const h=loadHistory();
  if(!h.length){list.textContent="No completed sessions yet.";return;}
  list.innerHTML=h.slice().reverse().map(s=>`
    <div class="history-item">
      <strong>${s.date}</strong>
      <div class="history-meta">
        <span>P/L: ${money(s.pl)}</span>
        <span>Hands: ${s.hands}</span>
        <span>Cycles: ${s.cycles}</span>
        <span>Won: ${s.won}</span>
        <span>Re-armed: ${s.rearmed}</span>
        <span>Last start unit: ${s.startUnit}</span>
      </div>
    </div>`).join("");
}

function render(){
  const pl=app.bankroll-app.settings.startingBankroll;
  const m=app.machine;

  document.getElementById("bankroll").textContent=money(app.bankroll);
  document.getElementById("sessionPL").textContent=money(pl);
  document.getElementById("playerStreak").textContent=m.playerStreak;
  document.getElementById("progression").textContent=m.attemptInCycle
    ? `${m.currentUnit}u (Attempt ${m.attemptInCycle}/3)`
    : `Next: ${m.cycleStartUnit}u`;

  const [title,text,bet,tone]=advice();
  document.getElementById("advisorTitle").textContent=title;
  document.getElementById("advisorText").textContent=text;
  document.getElementById("betAmount").textContent=bet;
  document.getElementById("cycleHint").textContent=cycleHint();

  const ac=document.getElementById("advisorCard");
  ac.className="card advisor";
  if(tone) ac.classList.add(tone);

  document.getElementById("state").textContent=m.state;
  document.getElementById("cycleNo").textContent=m.cycleNo;
  document.getElementById("armed").textContent=m.armed?"Yes":"No";
  document.getElementById("level").textContent=m.attemptInCycle ? `${m.currentUnit}u` : `Next ${m.cycleStartUnit}u`;
  document.getElementById("losses").textContent=m.lossesAfterTrigger;
  document.getElementById("cyclesWon").textContent=m.cyclesWon;
  document.getElementById("cyclesRearmed").textContent=m.cyclesRearmed;
  document.getElementById("totalWagered").textContent=money(app.totalWagered);
  document.getElementById("highBankroll").textContent=money(app.highestBankroll);
  document.getElementById("lowBankroll").textContent=money(app.lowestBankroll);
  document.getElementById("maxDrawdown").textContent=money(app.maxDrawdown);

  // Show wins at the three most relevant low units; higher units are summarized in tooltip text.
  document.getElementById("level1Wins").textContent=app.levelWins[1]||0;
  document.getElementById("level2Wins").textContent=app.levelWins[2]||0;
  document.getElementById("level3Wins").textContent=app.levelWins[3]||0;

  const totalCycles=m.cyclesWon+m.cyclesRearmed;
  document.getElementById("cycleWinRate").textContent=totalCycles?`${((m.cyclesWon/totalCycles)*100).toFixed(1)}%`:"0%";
  const avg=app.cycleResults.length?app.cycleResults.reduce((a,b)=>a+b,0)/app.cycleResults.length:0;
  document.getElementById("avgCycleResult").textContent=money(avg);

  document.getElementById("handCount").textContent=`${app.shoe.length} hands`;
  document.getElementById("countP").textContent=app.shoe.filter(x=>x.result==="P").length;
  document.getElementById("countB").textContent=app.shoe.filter(x=>x.result==="B").length;
  document.getElementById("countT").textContent=app.shoe.filter(x=>x.result==="T").length;

  const road=document.getElementById("road");
  road.innerHTML="";
  app.shoe.forEach(h=>{
    const b=document.createElement("div");
    b.className=`bead ${h.result}${h.betWasActive?" bet":""}${h.isTrigger?" trigger":""}`;
    b.textContent=h.result;
    b.title=`Hand ${h.n} | ${h.stateBefore} → ${h.stateAfter}${h.betAmount?` | Bet ${h.betUnit}u / ${money(h.betAmount)}`:""} | Next start ${h.nextStartUnit}u | ${money(h.bankrollAfter)}`;
    road.appendChild(b);
  });

  document.getElementById("startingBankrollInput").value=app.settings.startingBankroll;
  document.getElementById("baseUnitInput").value=app.settings.baseUnit;
  document.getElementById("commissionInput").value=app.settings.commission;
  document.getElementById("takeProfitInput").value=app.settings.takeProfit;
  document.getElementById("stopLossInput").value=app.settings.stopLoss;
  document.getElementById("voiceBtn").textContent=`Voice: ${voiceEnabled?"On":"Off"}`;

  renderHistory();
}

function saveCurrentSessionToHistory(){
  if(!app.shoe.length) return;
  const h=loadHistory();
  h.push({
    date:new Date().toLocaleString(),
    pl:app.bankroll-app.settings.startingBankroll,
    hands:app.shoe.length,
    cycles:app.machine.cycleNo,
    won:app.machine.cyclesWon,
    rearmed:app.machine.cyclesRearmed,
    startUnit:app.machine.cycleStartUnit
  });
  while(h.length>30) h.shift();
  saveHistory(h);
}

function exportCSV(){
  if(!app.shoe.length){alert("No hands to export.");return;}
  const rows=[["Hand","Result","Trigger","Bet Active","Bet Unit","Bet Amount","Outcome","State Before","State After","Next Start Unit","Bankroll After"]];
  app.shoe.forEach(h=>rows.push([
    h.n,h.result,h.isTrigger?"Yes":"No",h.betWasActive?"Yes":"No",
    h.betUnit||0,h.betAmount||0,h.outcome||"",h.stateBefore,h.stateAfter,h.nextStartUnit||app.machine.cycleStartUnit,h.bankrollAfter.toFixed(2)
  ]));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`second-banker-rolling-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("playerBtn").onclick=()=>processResult("P");
document.getElementById("bankerBtn").onclick=()=>processResult("B");
document.getElementById("tieBtn").onclick=()=>processResult("T");

document.getElementById("undoBtn").onclick=()=>{
  if(!app.snapshots.length)return;
  const prev=app.snapshots.pop();
  prev.snapshots=app.snapshots;
  app=prev;
  save();render();
};

document.getElementById("resetShoeBtn").onclick=()=>{
  if(!confirm("Reset the shoe history and current trigger state? Bankroll, statistics, and rolling start unit stay unchanged."))return;
  const keepStartUnit=app.machine.cycleStartUnit;
  const keepCycleNo=app.machine.cycleNo;
  const keepWins=app.machine.cyclesWon;
  const keepRearmed=app.machine.cyclesRearmed;

  app.shoe=[];app.snapshots=[];
  app.machine={
    state:"WAITING",
    playerStreak:0,
    armed:false,
    triggerSeen:false,
    currentUnit:keepStartUnit,
    cycleStartUnit:keepStartUnit,
    attemptInCycle:0,
    lossesAfterTrigger:0,
    cycleNo:keepCycleNo,
    cyclesWon:keepWins,
    cyclesRearmed:keepRearmed,
    cycleStartBankroll:app.bankroll
  };
  save();render();
};

document.getElementById("newSessionBtn").onclick=()=>{
  if(!confirm("Start a completely new session? The current session will be added to history and rolling unit resets to 1."))return;
  saveCurrentSessionToHistory();
  const settings={...app.settings};
  app=defaultState();
  app.settings=settings;
  app.bankroll=settings.startingBankroll;
  app.highestBankroll=settings.startingBankroll;
  app.lowestBankroll=settings.startingBankroll;
  app.machine.cycleStartBankroll=settings.startingBankroll;
  save();render();
};

document.getElementById("applySettingsBtn").onclick=()=>{
  if(app.shoe.length && !confirm("Changing settings during an active session can affect statistics. Apply anyway?"))return;

  const s={
    startingBankroll:Number(document.getElementById("startingBankrollInput").value),
    baseUnit:Number(document.getElementById("baseUnitInput").value),
    commission:Number(document.getElementById("commissionInput").value),
    takeProfit:Number(document.getElementById("takeProfitInput").value),
    stopLoss:Number(document.getElementById("stopLossInput").value)
  };

  if(!Number.isFinite(s.startingBankroll)||s.startingBankroll<=0||!Number.isFinite(s.baseUnit)||s.baseUnit<=0){
    alert("Please enter valid positive bankroll and base-unit values.");return;
  }

  const pl=app.bankroll-app.settings.startingBankroll;
  app.settings=s;
  if(!app.shoe.length){
    app.bankroll=s.startingBankroll;
    app.highestBankroll=s.startingBankroll;
    app.lowestBankroll=s.startingBankroll;
    app.maxDrawdown=0;
    app.machine.cycleStartBankroll=s.startingBankroll;
  }else{
    app.bankroll=s.startingBankroll+pl;
  }
  app.sessionStopped=false;
  updateRisk();
  save();render();
};

document.getElementById("voiceBtn").onclick=()=>{
  voiceEnabled=!voiceEnabled;
  localStorage.setItem(VOICE_KEY,voiceEnabled?"1":"0");
  if(voiceEnabled) speak("Voice alerts enabled.");
  render();
};

document.getElementById("exportBtn").onclick=exportCSV;

document.getElementById("clearHistoryBtn").onclick=()=>{
  if(!confirm("Clear all saved session history?"))return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
};

render();
