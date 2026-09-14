const STORAGE_KEY = "secondBankerAdvisorV2";
const HISTORY_KEY = "secondBankerAdvisorHistoryV1";
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
  levelWins:{1:0,2:0,3:0},
  machine:{
    state:"WAITING",
    playerStreak:0,
    armed:false,
    triggerSeen:false,
    currentLevel:0,
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
function loadState(){try{const r=localStorage.getItem(STORAGE_KEY);return r?JSON.parse(r):null}catch{return null}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(app));}
function loadHistory(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]")}catch{return []}}
function saveHistory(h){localStorage.setItem(HISTORY_KEY,JSON.stringify(h));}
function clone(o){return JSON.parse(JSON.stringify(o));}
function currentBetAmount(){return app.machine.currentLevel>0?app.settings.baseUnit*app.machine.currentLevel:0;}

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
  if(app.machine.currentLevel>0 && currentBetAmount()>app.bankroll) app.sessionStopped=true;
}

function updateRisk(){
  app.highestBankroll=Math.max(app.highestBankroll,app.bankroll);
  app.lowestBankroll=Math.min(app.lowestBankroll,app.bankroll);
  app.maxDrawdown=Math.max(app.maxDrawdown, app.highestBankroll-app.bankroll);
  checkLimits();
}

function finishCycle(resultLevel){
  const m=app.machine;
  const cycleResult=app.bankroll-m.cycleStartBankroll;
  app.cycleResults.push(cycleResult);
  if(resultLevel) app.levelWins[resultLevel]=(app.levelWins[resultLevel]||0)+1;
}

function processResult(result){
  if(app.sessionStopped){
    alert("Session stop condition reached. Start a new session to continue.");
    return;
  }

  snapshot();
  const m=app.machine;
  const before=clone(m);
  let betWasActive=m.currentLevel>0;
  let isTrigger=false;
  let betAmount=0;
  let outcome=null;

  if(m.state==="CYCLE_WON") m.state="WAITING";

  if(betWasActive){
    betAmount=currentBetAmount();

    if(result==="T"){
      outcome="push";
    }else{
      app.totalWagered+=betAmount;

      if(result==="B"){
        const level=m.currentLevel;
        app.bankroll += betAmount*(1-app.settings.commission/100);
        m.cyclesWon++;
        outcome="win";
        finishCycle(level);
        m.state="CYCLE_WON";
        m.currentLevel=0;
        m.lossesAfterTrigger=0;
        m.triggerSeen=false;
        m.armed=false;
        m.playerStreak=0;
        speak("Second Banker captured.");
      }else{
        app.bankroll -= betAmount;
        outcome="loss";
        m.lossesAfterTrigger++;
        m.playerStreak++;

        if(m.currentLevel===1){
          m.currentLevel=2;
          m.state="BET_LEVEL_2";
          speak(`Level two. Bet Banker ${money(app.settings.baseUnit*2)}.`);
        }else if(m.currentLevel===2){
          m.currentLevel=3;
          m.state="BET_LEVEL_3";
          speak(`Final attempt. Bet Banker ${money(app.settings.baseUnit*3)}.`);
        }else{
          finishCycle(null);
          m.currentLevel=0;
          m.cyclesRearmed++;
          m.armed=true;
          m.triggerSeen=false;
          m.state="REARMED_AFTER_3P";
          speak("Three Player losses. Stop betting and wait for Banker.");
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
        m.currentLevel=1;
        m.state="TRIGGER_BANKER";
        speak(`Banker trigger. Bet Banker ${money(app.settings.baseUnit)} on the next hand.`);
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
    outcome,
    stateBefore:before.state,
    stateAfter:m.state,
    bankrollAfter:app.bankroll
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
    return["SECOND BANKER CAPTURED","Cycle complete. Wait for a new Player streak.","","success"];

  if(m.state==="TRIGGER_BANKER")
    return["BET BANKER","Trigger Banker detected. Next hand is Level 1.",money(app.settings.baseUnit),"warning"];

  if(m.state==="BET_LEVEL_2")
    return["BET BANKER","Level 1 lost. Progress to Level 2.",money(app.settings.baseUnit*2),"warning"];

  if(m.state==="BET_LEVEL_3")
    return["BET BANKER","Level 2 lost. This is the final attempt.",money(app.settings.baseUnit*3),"danger"];

  if(m.state==="REARMED_AFTER_3P")
    return["STOP BETTING","Three Player losses formed a new Player streak. Wait for Banker.","","danger"];

  if(m.state==="PLAYER_STREAK_ARMED")
    return["PLAYER STREAK ARMED",`Player streak: ${m.playerStreak}. Wait for the first Banker.`,"","warning"];

  return["WAIT",m.playerStreak===1?"One Player recorded. Need one more Player to arm the trigger.":"Looking for 2+ consecutive Player results.","",""];
}

function cycleHint(){
  const m=app.machine;
  if(m.state==="TRIGGER_BANKER") return "Trigger observed — the next hand is the first actual wager.";
  if(m.state==="BET_LEVEL_2") return "One Banker bet lost. One step up.";
  if(m.state==="BET_LEVEL_3") return "Two Banker bets lost. No level 4.";
  if(m.state==="REARMED_AFTER_3P") return "The three Player losses now count as the next qualifying streak.";
  if(m.state==="PLAYER_STREAK_ARMED") return "Do not bet yet. Wait for Banker.";
  return "";
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
      </div>
    </div>`).join("");
}

function render(){
  const pl=app.bankroll-app.settings.startingBankroll;
  const m=app.machine;

  document.getElementById("bankroll").textContent=money(app.bankroll);
  document.getElementById("sessionPL").textContent=money(pl);
  document.getElementById("playerStreak").textContent=m.playerStreak;
  document.getElementById("progression").textContent=m.currentLevel?`Level ${m.currentLevel}`:"—";

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
  document.getElementById("level").textContent=m.currentLevel||"—";
  document.getElementById("losses").textContent=m.lossesAfterTrigger;
  document.getElementById("cyclesWon").textContent=m.cyclesWon;
  document.getElementById("cyclesRearmed").textContent=m.cyclesRearmed;
  document.getElementById("totalWagered").textContent=money(app.totalWagered);
  document.getElementById("highBankroll").textContent=money(app.highestBankroll);
  document.getElementById("lowBankroll").textContent=money(app.lowestBankroll);
  document.getElementById("maxDrawdown").textContent=money(app.maxDrawdown);

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
    b.title=`Hand ${h.n} | ${h.stateBefore} → ${h.stateAfter}${h.betAmount?` | Bet ${money(h.betAmount)}`:""} | ${money(h.bankrollAfter)}`;
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
    rearmed:app.machine.cyclesRearmed
  });
  while(h.length>30) h.shift();
  saveHistory(h);
}

function exportCSV(){
  if(!app.shoe.length){alert("No hands to export.");return;}
  const rows=[["Hand","Result","Trigger","Bet Active","Bet Amount","Outcome","State Before","State After","Bankroll After"]];
  app.shoe.forEach(h=>rows.push([
    h.n,h.result,h.isTrigger?"Yes":"No",h.betWasActive?"Yes":"No",
    h.betAmount||0,h.outcome||"",h.stateBefore,h.stateAfter,h.bankrollAfter.toFixed(2)
  ]));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`second-banker-session-${new Date().toISOString().slice(0,10)}.csv`;
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
  if(!confirm("Reset the shoe history and current strategy state? Bankroll and session statistics stay unchanged."))return;
  app.shoe=[];app.snapshots=[];
  app.machine={
    state:"WAITING",playerStreak:0,armed:false,triggerSeen:false,currentLevel:0,
    lossesAfterTrigger:0,cycleNo:app.machine.cycleNo,cyclesWon:app.machine.cyclesWon,
    cyclesRearmed:app.machine.cyclesRearmed,cycleStartBankroll:app.bankroll
  };
  save();render();
};

document.getElementById("newSessionBtn").onclick=()=>{
  if(!confirm("Start a completely new session? The current session will be added to history."))return;
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
