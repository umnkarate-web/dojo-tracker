import { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential,
  sendPasswordResetEmail, createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp,
} from "firebase/firestore";

// ─── Firebase ─────────────────────────────────────────────────────────────────
const firebaseApp = initializeApp({
  apiKey: "AIzaSyDuxhxICq6_5Jd8I3m4fQD7Mwg2X_pHxtI",
  authDomain: "dojo-tracker-d4331.firebaseapp.com",
  projectId: "dojo-tracker-d4331",
  storageBucket: "dojo-tracker-d4331.firebasestorage.app",
  messagingSenderId: "603515048412",
  appId: "1:603515048412:web:5d78bd44434e20d7b3ff19",
});
// Secondary app for creating students without affecting instructor session
const secondaryApp = initializeApp({
  apiKey: "AIzaSyDuxhxICq6_5Jd8I3m4fQD7Mwg2X_pHxtI",
  authDomain: "dojo-tracker-d4331.firebaseapp.com",
  projectId: "dojo-tracker-d4331",
  storageBucket: "dojo-tracker-d4331.firebasestorage.app",
  messagingSenderId: "603515048412",
  appId: "1:603515048412:web:5d78bd44434e20d7b3ff19",
}, "secondary");
const auth = getAuth(firebaseApp);
const secondaryAuth = getAuth(secondaryApp);
const db = getFirestore(firebaseApp);

// ─── Local Date Helper (fixes UTC timezone bug) ───────────────────────────────
function getLocalToday() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ─── Belt System ──────────────────────────────────────────────────────────────
const BELT_LEVELS = [
  { kyu: "10th Kyu", name: "White Belt",           color: "#e8e8e8", textColor: "#333",    hoursRequired: 0,  yearsRequired: null },
  { kyu: "8th Kyu",  name: "Orange Belt",          color: "#FF8C00", textColor: "#fff",    hoursRequired: 18, yearsRequired: null },
  { kyu: "7th Kyu",  name: "Red Belt",             color: "#CC0000", textColor: "#fff",    hoursRequired: 18, yearsRequired: null },
  { kyu: "6th Kyu",  name: "Green Belt",           color: "#228B22", textColor: "#fff",    hoursRequired: 20, yearsRequired: null },
  { kyu: "5th Kyu",  name: "Purple Belt",          color: "#6B21A8", textColor: "#fff",    hoursRequired: 22, yearsRequired: null },
  { kyu: "4th Kyu",  name: "Purple Belt II",       color: "#7C3AED", textColor: "#fff",    hoursRequired: 24, yearsRequired: null },
  { kyu: "3rd Kyu",  name: "Brown Belt",           color: "#92400E", textColor: "#fff",    hoursRequired: 28, yearsRequired: null },
  { kyu: "2nd Kyu",  name: "Brown Belt II",        color: "#78350F", textColor: "#fff",    hoursRequired: 36, yearsRequired: null },
  { kyu: "1st Kyu",  name: "Brown Belt III",       color: "#6B3A2A", textColor: "#fff",    hoursRequired: 40, yearsRequired: null },
  { kyu: "Shodan",   name: "Black Belt 1st Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: 50, yearsRequired: null },
  { kyu: "Nidan",    name: "Black Belt 2nd Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 3  },
  { kyu: "Sandan",   name: "Black Belt 3rd Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 4  },
  { kyu: "Yondan",   name: "Black Belt 4th Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 5  },
  { kyu: "Godan",    name: "Black Belt 5th Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 6  },
  { kyu: "Rokudan",  name: "Black Belt 6th Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 7  },
  { kyu: "Shichidan",name: "Black Belt 7th Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 8  },
  { kyu: "Hachidan", name: "Black Belt 8th Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 9  },
  { kyu: "Kudan",    name: "Black Belt 9th Dan",   color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 10 },
];

const PLACEMENT_PTS = [10, 9, 8, 7]; // 1st, 2nd, 3rd, 4th
const PLACEMENT_LABELS = ["1st (+10 pts)", "2nd (+9 pts)", "3rd (+8 pts)", "4th (+7 pts)"];
const DOJO_NAME = "Traditional Karatedo Academy at UMN";
const APP_VERSION = "1.6.3";

// ─── Rank Code System ─────────────────────────────────────────────────────────
// Each belt level has a short code used in rank exams
const BELT_CODES = [
  "10","8","7","6","5","4","3","2","1",
  "Shodan","Nidan","Sandan","Yondan","Godan","Rokudan","Shichidan","Hachidan","Kudan"
];
// S = Satisfactory (passed), E = Exceeding (passed with distinction)
// S/E modifiers only apply to Kyu ranks (beltIndex 0–8)
// Black belt ranks (beltIndex 9+) use rank name only

function isKyuRank(beltIndex) {
  return beltIndex <= 8;
}

function getRankCode(beltIndex, result) {
  if (!isKyuRank(beltIndex)) return BELT_LEVELS[beltIndex]?.kyu || "";
  return `${result}${BELT_CODES[beltIndex] || beltIndex}`;
}

// Full dropdown label:
// Kyu:  "3rd Kyu — Brown Belt (S3 / E3)"
// Dan:  "Shodan — Black Belt 1st Dan"
function beltDropdownLabel(i) {
  const b = BELT_LEVELS[i];
  if (!isKyuRank(i)) return `${b.kyu} — ${b.name}`;
  const s = getRankCode(i, "S");
  const e = getRankCode(i, "E");
  return `${b.kyu} — ${b.name} (${s} / ${e})`;
}

function parseRankCode(code) {
  // Returns { result: "S"|"E", beltIndex: number } or null
  if (!code) return null;
  const result = code[0];
  if (result !== "S" && result !== "E") return null;
  const levelStr = code.slice(1);
  const idx = BELT_CODES.indexOf(levelStr);
  if (idx === -1) return null;
  return { result, beltIndex: idx };
}

function calcPromotion(currentBeltIndex, examBeltIndex, result) {
  // S/E promotions only valid for Kyu ranks (0–8)
  if (!isKyuRank(examBeltIndex)) return { promoted: false, newBeltIndex: currentBeltIndex, levelsAdvanced: 0 };
  if (result !== "S" && result !== "E") return { promoted: false, newBeltIndex: currentBeltIndex, levelsAdvanced: 0 };
  // Student must be testing at a higher level (higher index = higher kyu rank number)
  const levelsAdvanced = examBeltIndex - currentBeltIndex;
  if (levelsAdvanced <= 0) return { promoted: false, newBeltIndex: currentBeltIndex, levelsAdvanced: 0 };
  // E allows up to 2 levels, S allows exactly 1
  if (result === "S" && levelsAdvanced > 1) return { promoted: false, newBeltIndex: currentBeltIndex, levelsAdvanced: 0 };
  if (result === "E" && levelsAdvanced > 2) return { promoted: false, newBeltIndex: currentBeltIndex, levelsAdvanced: 0 };
  return { promoted: true, newBeltIndex: examBeltIndex, levelsAdvanced };
}

// ─── Geo helpers ──────────────────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function calcStats(userId, trainingDays, events, trainingResetDate) {
  const myTd = (trainingDays || []).filter(td => td.attendees?.includes(userId));
  const trainingHours = myTd.reduce((s, td) => s + (td.durationHours || 1.5), 0);
  const trainingPoints = myTd.length;
  // Hours since last promotion (for belt progress)
  const trainingHoursSinceReset = trainingResetDate
    ? myTd.filter(td => td.date >= trainingResetDate).reduce((s, td) => s + (td.durationHours || 1.5), 0)
    : trainingHours;
  let eventPoints = 0, eventHours = 0;
  (events || []).forEach(ev => {
    const p = ev.participants?.[userId];
    if (!p?.attended) return;
    const h = parseFloat(p.hoursAttended || ev.hours || 0);
    eventPoints += h;
    eventHours += h;
    if (ev.isCompetition && p.placement >= 1 && p.placement <= 4)
      eventPoints += PLACEMENT_PTS[p.placement - 1];
  });
  return { trainingHours, trainingHoursSinceReset, trainingPoints, eventPoints, eventHours, totalPoints: trainingPoints + eventPoints };
}

// ─── Rank Exam Processor ─────────────────────────────────────────────────────
async function processRankExam(db, student, examBeltIndex, result, examDate, setStudents, showToast) {
  const { promoted, newBeltIndex, levelsAdvanced } = calcPromotion(student.beltIndex||0, examBeltIndex, result);
  const code = getRankCode(examBeltIndex, result);
  const examEntry = {
    date: examDate,
    code,
    result,
    beltTested: examBeltIndex,
    beltTestedName: BELT_LEVELS[examBeltIndex]?.name || "",
    promoted,
    levelsAdvanced,
  };

  const rankHistory = [...(student.rankHistory||[]), examEntry];
  const updates = { rankHistory };

  if (promoted) {
    updates.beltIndex = newBeltIndex;
    updates.beltAchievedDate = examDate;
    updates.trainingResetDate = examDate; // training hours count from here
    showToast(`🎉 ${student.name} promoted to ${BELT_LEVELS[newBeltIndex]?.name}!`);
  } else {
    // No promotion — add hours requirement penalty
    const extraHours = BELT_LEVELS[examBeltIndex]?.hoursRequired || 0;
    updates.extraHoursRequired = (student.extraHoursRequired||0) + extraHours;
    showToast(`📋 ${student.name} — exam recorded, not promoted.`);
  }

  await updateDoc(doc(db,"users",student.id), updates);
  const updated = { ...student, ...updates };
  if (setStudents) setStudents(prev=>prev.map(s=>s.id===student.id?updated:s));
  return updated;
}

// ─── Date Range Helpers ───────────────────────────────────────────────────────
function getYearlyRange(dojoSettings) {
  if (!dojoSettings?.yearlyStart) return null;
  const start = dojoSettings.yearlyStart; // e.g. "2024-09-01"
  const startDate = new Date(start);
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);
  endDate.setDate(endDate.getDate() - 1);
  return { name: dojoSettings.yearlyName || "Current Year", start, end: endDate.toISOString().split("T")[0] };
}

function filterByRange(trainingDays, events, start, end) {
  const filteredTd = start && end
    ? trainingDays.filter(td => td.date >= start && td.date <= end)
    : trainingDays;
  const filteredEv = start && end
    ? events.filter(ev => ev.date >= start && ev.date <= end)
    : events;
  return { filteredTd, filteredEv };
}

function calcStatsForRange(userId, trainingDays, events, start, end, trainingResetDate) {
  const { filteredTd, filteredEv } = filterByRange(trainingDays, events, start, end);
  return calcStats(userId, filteredTd, filteredEv, trainingResetDate);
}

function getBeltProgress(beltIndex, joinDate, beltAchievedDate, stats, student) {
  const next = BELT_LEVELS[beltIndex + 1];
  if (!next) return { next: null, progress: 100 };

  // Hours trained since last promotion (from trainingResetDate)
  const hoursSincePromotion = stats.trainingHoursSinceReset !== undefined
    ? stats.trainingHoursSinceReset
    : stats.trainingHours;

  if (next.yearsRequired) {
    const from = new Date(beltAchievedDate || joinDate);
    const years = (Date.now() - from) / (1000*60*60*24*365.25);
    return { next, isYearBased: true, years, yearsRequired: next.yearsRequired, progress: Math.min(100, (years/next.yearsRequired)*100) };
  }

  const baseHours = next.hoursRequired;
  const extraHours = student?.extraHoursRequired || 0;
  const totalRequired = baseHours + extraHours;
  return {
    next,
    isYearBased: false,
    hoursNeeded: totalRequired,
    baseHours,
    extraHours,
    progress: Math.min(100, (hoursSincePromotion/totalRequired)*100)
  };
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function BeltBadge({ beltIndex, size="sm" }) {
  const b = BELT_LEVELS[Math.min(beltIndex||0, BELT_LEVELS.length-1)];
  const sz = size==="lg" ? {padding:"6px 16px",fontSize:14,borderRadius:20} : {padding:"2px 10px",fontSize:11,borderRadius:12};
  return <span style={{background:b.color,color:b.textColor,fontWeight:700,letterSpacing:"0.04em",border:b.color==="#e8e8e8"?"1px solid #ccc":"none",...sz}}>{b.name}</span>;
}

function ProgressBar({ percent }) {
  return (
    <div style={{background:"rgba(255,255,255,0.1)",borderRadius:8,height:12,overflow:"hidden"}}>
      <div style={{width:`${Math.max(0,Math.min(100,percent))}%`,background:"linear-gradient(90deg,#C8A04A,#fff8dc)",height:"100%",borderRadius:8,transition:"width 0.6s"}} />
    </div>
  );
}

function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,padding:20,cursor:onClick?"pointer":"default",...style}}>{children}</div>;
}

function FInput({ label, ...p }) {
  return (
    <div style={{marginBottom:14}}>
      {label && <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</label>}
      <input {...p} style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"10px 14px",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",...p.style}} />
    </div>
  );
}

function FSelect({ label, children, ...p }) {
  return (
    <div style={{marginBottom:14}}>
      {label && <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</label>}
      <select {...p} style={{width:"100%",background:"#1a1a2e",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"10px 14px",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box",...p.style}}>{children}</select>
    </div>
  );
}

function Btn({ children, variant="primary", onClick, style, disabled }) {
  const v = {
    primary:{background:"linear-gradient(135deg,#C8A04A,#E8C86A)",color:"#0a0a1a"},
    danger:{background:"rgba(220,38,38,0.8)",color:"#fff"},
    ghost:{background:"rgba(255,255,255,0.08)",color:"#fff",border:"1px solid rgba(255,255,255,0.15)"},
    green:{background:"rgba(34,197,94,0.8)",color:"#fff"},
  };
  return <button onClick={onClick} disabled={disabled} style={{border:"none",borderRadius:10,padding:"10px 20px",fontFamily:"inherit",fontWeight:700,cursor:disabled?"not-allowed":"pointer",fontSize:14,opacity:disabled?0.5:1,...v[variant],...style}}>{children}</button>;
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:"#12122a",border:"1px solid rgba(200,160,74,0.3)",borderRadius:20,padding:24,width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{margin:0,color:"#C8A04A",fontSize:18}}>{title}</h3>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#888",fontSize:22,cursor:"pointer"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return <div style={{display:"flex",justifyContent:"center",padding:40}}><div style={{width:36,height:36,border:"3px solid rgba(200,160,74,0.2)",borderTop:"3px solid #C8A04A",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
}

function InfoBox({ children, type="info" }) {
  const colors = { info:{bg:"rgba(59,130,246,0.15)",border:"rgba(59,130,246,0.4)",text:"#93c5fd"}, warn:{bg:"rgba(234,179,8,0.15)",border:"rgba(234,179,8,0.4)",text:"#fde047"}, error:{bg:"rgba(220,38,38,0.15)",border:"rgba(220,38,38,0.4)",text:"#fca5a5"}, success:{bg:"rgba(34,197,94,0.15)",border:"rgba(34,197,94,0.4)",text:"#86efac"} };
  const c = colors[type];
  return <div style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:c.text}}>{children}</div>;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g,""));
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function KarateApp() {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [trainingDays, setTrainingDays] = useState([]);
  const [events, setEvents] = useState([]);
  const [students, setStudents] = useState([]);
  const [dojoSettings, setDojoSettings] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  const loadData = useCallback(async () => {
    try {
      const [tdSnap, evSnap, usSnap, settSnap] = await Promise.all([
        getDocs(collection(db,"trainingDays")),
        getDocs(collection(db,"events")),
        getDocs(collection(db,"users")),
        getDoc(doc(db,"settings","dojo")),
      ]);
      setTrainingDays(tdSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.date?.localeCompare(a.date)));
      setEvents(evSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.date?.localeCompare(a.date)));
      setStudents(usSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.role==="student"));
      if (settSnap.exists()) setDojoSettings(settSnap.data());
      else setDojoSettings({});
      setDataLoaded(true);
    } catch(e) { showToast("Error loading data: "+e.message,"error"); }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (user) {
        setAuthUser(user);
        const snap = await getDoc(doc(db,"users",user.uid));
        if (snap.exists()) { setProfile({id:user.uid,...snap.data()}); await loadData(); }
        else { await signOut(auth); }
      } else { setAuthUser(null); setProfile(null); setDataLoaded(false); }
      setLoading(false);
    });
    return unsub;
  }, [loadData]);

  if (loading) return <div style={{minHeight:"100vh",background:"#0a0a1a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:60,marginBottom:20}}>⛩️</div><Spinner /></div>;
  if (!authUser || !profile) return <LoginScreen auth={auth} onLogin={async uid=>{ const s=await getDoc(doc(db,"users",uid)); if(s.exists()){setProfile({id:uid,...s.data()});await loadData();} }} showToast={showToast} toast={toast} />;

  const isInstructor = profile.role === "instructor";
  const navItems = isInstructor
    ? [{id:"dashboard",label:"Dashboard",icon:"⛩️"},{id:"checkin",label:"Check-In",icon:"✅"},{id:"training",label:"Training",icon:"📅"},{id:"events",label:"Events",icon:"🏆"},{id:"students",label:"Students",icon:"👥"},{id:"report",label:"Reports",icon:"📊"},{id:"settings",label:"Settings",icon:"⚙️"}]
    : [{id:"dashboard",label:"Dashboard",icon:"⛩️"},{id:"checkin",label:"Check-In",icon:"✅"},{id:"training",label:"Training",icon:"📅"},{id:"myrecord",label:"My Record",icon:"📋"},{id:"settings",label:"Settings",icon:"⚙️"}];

  const shared = { profile, trainingDays, setTrainingDays, events, setEvents, students, setStudents, showToast, db, auth, secondaryAuth, isInstructor, loadData, dojoSettings, setDojoSettings };

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0a0a1a 0%,#12122a 50%,#0d0d20 100%)",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      <div style={{background:"rgba(0,0,0,0.4)",borderBottom:"1px solid rgba(200,160,74,0.3)",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div>
          <div style={{fontSize:10,color:"#C8A04A",letterSpacing:"0.15em",textTransform:"uppercase"}}>{DOJO_NAME}</div>
          <div style={{fontSize:17,fontWeight:800}}>⛩️ {profile.name}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <BeltBadge beltIndex={profile.beltIndex||0} />
          <button onClick={()=>{ signOut(auth); setView("dashboard"); }} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#aaa",padding:"5px 10px",cursor:"pointer",fontSize:11}}>Logout</button>
        </div>
      </div>

      <div style={{flex:1,padding:"16px 16px 100px",overflowY:"auto"}}>
        {!dataLoaded ? <Spinner /> : <>
          {view==="dashboard" && <DashboardView {...shared} />}
          {view==="checkin" && <CheckInView {...shared} />}
          {view==="training" && <TrainingDaysView {...shared} />}
          {view==="events" && <EventsView {...shared} />}
          {view==="students" && isInstructor && <StudentsView {...shared} />}
          {view==="report" && isInstructor && <ReportView {...shared} />}
          {view==="myrecord" && <MyRecordView {...shared} />}
          {view==="settings" && <SettingsView {...shared} authUser={authUser} setProfile={setProfile} />}
        </>}
      </div>

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"rgba(10,10,26,0.95)",borderTop:"1px solid rgba(200,160,74,0.2)",display:"flex",justifyContent:"space-around",padding:"8px 0 14px",backdropFilter:"blur(10px)",zIndex:100}}>
        {navItems.map(n=>(
          <button key={n.id} onClick={async()=>{ setView(n.id); if(n.id==="dashboard"||n.id==="training"){ try{ const snap=await getDocs(collection(db,"trainingDays")); setTrainingDays(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.date?.localeCompare(a.date))); }catch(e){} } }} style={{background:"none",border:"none",color:view===n.id?"#C8A04A":"#555",display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",padding:"4px 6px"}}>
            <span style={{fontSize:18}}>{n.icon}</span>
            <span style={{fontSize:9,fontWeight:view===n.id?700:400}}>{n.label}</span>
          </button>
        ))}
      </div>

      {toast && <div style={{position:"fixed",top:76,left:"50%",transform:"translateX(-50%)",background:toast.type==="success"?"#166534":"#7f1d1d",color:"#fff",padding:"10px 20px",borderRadius:12,fontSize:14,fontWeight:600,zIndex:200,whiteSpace:"nowrap",boxShadow:"0 4px 20px rgba(0,0,0,0.4)"}}>{toast.msg}</div>}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ auth, onLogin, showToast, toast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const handleLogin = async () => {
    setError(""); setBusy(true);
    try {
      const c = await signInWithEmailAndPassword(auth, email.trim(), password);
      await onLogin(c.user.uid);
    } catch(e) { setError(e.code==="auth/invalid-credential"?"Invalid email or password.":e.message); }
    setBusy(false);
  };

  const handleReset = async () => {
    if (!resetEmail.trim()) { setError("Enter your email address."); return; }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setForgotMode(false);
      showToast("Password reset email sent! Check your inbox.");
    } catch(e) { setError("Could not send reset email. Check the address."); }
    setBusy(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0a0a1a,#12122a)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:64,marginBottom:10}}>⛩️</div>
        <h1 style={{margin:0,fontSize:24,fontWeight:900,color:"#C8A04A"}}>Dojo Tracker</h1>
        <p style={{color:"#555",margin:"4px 0 0",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>{DOJO_NAME}</p>
      </div>
      <div style={{width:"100%",maxWidth:360,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,160,74,0.2)",borderRadius:20,padding:28}}>
        {!forgotMode ? (
          <>
            <div style={{fontWeight:800,fontSize:18,marginBottom:20,color:"#fff"}}>Sign In</div>
            {error && <InfoBox type="error">{error}</InfoBox>}
            <FInput label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" />
            <FInput label="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" />
            <Btn onClick={handleLogin} disabled={busy} style={{width:"100%",marginBottom:12}}>{busy?"Signing in…":"Sign In"}</Btn>
            <button onClick={()=>{setForgotMode(true);setError("");}} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",fontSize:13,width:"100%",textAlign:"center"}}>Forgot password?</button>
          </>
        ) : (
          <>
            <div style={{fontWeight:800,fontSize:18,marginBottom:12,color:"#fff"}}>Reset Password</div>
            <p style={{color:"#aaa",fontSize:13,marginBottom:16}}>Enter your email and we'll send a reset link.</p>
            {error && <InfoBox type="error">{error}</InfoBox>}
            <FInput label="Email" type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="your@email.com" />
            <Btn onClick={handleReset} disabled={busy} style={{width:"100%",marginBottom:12}}>{busy?"Sending…":"Send Reset Email"}</Btn>
            <button onClick={()=>{setForgotMode(false);setError("");}} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontSize:13,width:"100%",textAlign:"center"}}>← Back to Sign In</button>
          </>
        )}
      </div>
      {toast && <div style={{marginTop:20,background:"#166534",color:"#fff",padding:"10px 20px",borderRadius:12,fontSize:14}}>{toast.msg}</div>}
    </div>
  );
}

// ─── Period Selector ──────────────────────────────────────────────────────────
function PeriodSelector({ dojoSettings, mode, setMode, selectedSemester, setSelectedSemester }) {
  const semesters = dojoSettings?.semesters || [];
  const yearlyRange = getYearlyRange(dojoSettings);
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        {[["alltime","All Time"],["yearly","Yearly"],["semester","Semester"]].map(([m,l])=>(
          <button key={m} onClick={()=>setMode(m)} style={{flex:1,background:mode===m?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:mode===m?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:mode===m?"#C8A04A":"#666",padding:"7px 4px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      {mode==="semester" && semesters.length>0 && (
        <select value={selectedSemester} onChange={e=>setSelectedSemester(e.target.value)} style={{width:"100%",background:"#1a1a2e",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:13,fontFamily:"inherit",outline:"none"}}>
          {semesters.map((s,i)=><option key={i} value={i}>{s.name} ({s.start} → {s.end})</option>)}
        </select>
      )}
      {mode==="semester" && semesters.length===0 && <InfoBox type="warn">No semesters configured yet. Ask your instructor to set them up in Settings.</InfoBox>}
      {mode==="yearly" && !yearlyRange && <InfoBox type="warn">No yearly period configured yet. Ask your instructor to set it up in Settings.</InfoBox>}
      {mode==="yearly" && yearlyRange && (
        <div style={{fontSize:12,color:"#888",textAlign:"center"}}>{yearlyRange.name}: {yearlyRange.start} → {yearlyRange.end}</div>
      )}
    </div>
  );
}

function getActiveRange(mode, dojoSettings, selectedSemester) {
  if (mode==="alltime") return { start: null, end: null, label: "All Time" };
  if (mode==="yearly") {
    const r = getYearlyRange(dojoSettings);
    if (!r) return { start: null, end: null, label: "All Time" };
    return { start: r.start, end: r.end, label: r.name };
  }
  if (mode==="semester") {
    const semesters = dojoSettings?.semesters || [];
    const s = semesters[selectedSemester];
    if (!s) return { start: null, end: null, label: "All Time" };
    return { start: s.start, end: s.end, label: s.name };
  }
  return { start: null, end: null, label: "All Time" };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardView({ profile, trainingDays, events, students, isInstructor, dojoSettings }) {
  const stats = calcStats(profile.id, trainingDays, events);
  const beltInfo = getBeltProgress(profile.beltIndex||0, profile.joinDate, profile.beltAchievedDate, stats);
  const today = getLocalToday();
  const todaySession = trainingDays.find(td=>td.date===today);
  const [mode, setMode] = useState("alltime");
  const [selectedSemester, setSelectedSemester] = useState(0);

  const range = getActiveRange(mode, dojoSettings, selectedSemester);

  const ranked = [...students]
    .map(s => {
      const st = calcStatsForRange(s.id, trainingDays, events, range.start, range.end);
      return { ...s, pts: st.totalPoints, trainingPts: st.trainingPoints, eventPts: st.eventPoints };
    })
    .sort((a,b) => b.pts - a.pts)
    .slice(0, 10);

  const myRankedStats = calcStatsForRange(profile.id, trainingDays, events, range.start, range.end);
  const myRank = ranked.findIndex(s=>s.id===profile.id) + 1;

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>{isInstructor?"Dojo Overview":"My Dashboard"}</h2>

      {/* Belt progress */}
      <Card style={{marginBottom:14,background:"linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <div><div style={{fontSize:11,color:"#C8A04A",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>Current Belt</div><BeltBadge beltIndex={profile.beltIndex||0} size="lg" /></div>
          {beltInfo.next && <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#888",marginBottom:4}}>Next Goal</div><BeltBadge beltIndex={(profile.beltIndex||0)+1} size="lg" /></div>}
        </div>
        {beltInfo.next ? (<>
          <ProgressBar percent={beltInfo.progress} />
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:12,color:"#aaa"}}>
            <span>{beltInfo.isYearBased?`${beltInfo.years?.toFixed(1)} yrs since promotion`:`${stats.trainingHours.toFixed(1)} hrs trained`}</span>
            <span>{beltInfo.isYearBased?`Goal: ${beltInfo.yearsRequired} yrs`:`Goal: ${beltInfo.hoursNeeded} hrs`}</span>
          </div>
        </>) : <div style={{color:"#C8A04A",fontWeight:700,marginTop:8}}>🏆 Highest Rank Achieved!</div>}
      </Card>

      {/* My stats for selected range */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        {[
          ["Sessions", filterByRange(trainingDays,events,range.start,range.end).filteredTd.filter(td=>td.attendees?.includes(profile.id)).length],
          ["Hours", myRankedStats.trainingHours.toFixed(1)],
          ["Points", myRankedStats.totalPoints.toFixed(0)]
        ].map(([l,v])=>(
          <Card key={l} style={{textAlign:"center",padding:14}}><div style={{fontSize:20,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:10,color:"#888",marginTop:2}}>{l}</div></Card>
        ))}
      </div>

      {/* Today */}
      <Card style={{marginBottom:14}}>
        <div style={{fontSize:12,color:"#888",marginBottom:6}}>📅 Today — {today}</div>
        {todaySession
          ?<div><span style={{color:"#4ade80",fontWeight:700}}>✅ Session active</span><span style={{fontSize:12,color:"#aaa",marginLeft:8}}>{todaySession.attendees?.length||0} checked in</span></div>
          :<div style={{color:"#555",fontSize:13}}>No session recorded yet.</div>}
      </Card>

      {/* Leaderboard */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A"}}>🏅 Top 10</div>
          <div style={{fontSize:11,color:"#888"}}>{range.label}</div>
        </div>

        <PeriodSelector dojoSettings={dojoSettings} mode={mode} setMode={setMode} selectedSemester={selectedSemester} setSelectedSemester={setSelectedSemester} />

        {ranked.length===0 && <div style={{color:"#555",fontSize:13,textAlign:"center",padding:"20px 0"}}>No data for this period yet.</div>}
        {ranked.map((s,i) => {
          const isMe = s.id===profile.id;
          const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
          return (
            <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 6px",borderBottom:i<ranked.length-1?"1px solid rgba(255,255,255,0.06)":"none",background:isMe?"rgba(200,160,74,0.08)":"none",borderRadius:isMe?8:0,marginBottom:isMe?2:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:medal?18:13,width:26,textAlign:"center",color:["#FFD700","#C0C0C0","#CD7F32","#888","#888","#888","#888","#888","#888","#888"][i],fontWeight:700}}>
                  {medal||`#${i+1}`}
                </span>
                <div>
                  <div style={{fontSize:13,fontWeight:isMe?800:600,color:isMe?"#C8A04A":"#fff"}}>{s.name}{isMe?" (You)":""}</div>
                  <BeltBadge beltIndex={s.beltIndex||0} />
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#C8A04A",fontWeight:800,fontSize:15}}>{s.pts.toFixed(0)}</div>
                <div style={{fontSize:10,color:"#666"}}>{s.trainingPts}t + {s.eventPts.toFixed(0)}e pts</div>
              </div>
            </div>
          );
        })}
        {!isInstructor && myRank===0 && ranked.length>0 && (
          <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.06)",fontSize:12,color:"#888",textAlign:"center"}}>
            You are not yet ranked for this period.
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Check-In ─────────────────────────────────────────────────────────────────
function CheckInView({ profile, trainingDays, setTrainingDays, students, showToast, db, isInstructor, dojoSettings }) {
  const today = getLocalToday();
  const [geoStatus, setGeoStatus] = useState("idle");
  const [selectedId, setSelectedId] = useState(profile.id);
  const [duration, setDuration] = useState("1.5");
  const [busy, setBusy] = useState(false);
  const [checkedGeo, setCheckedGeo] = useState(false);

  const session = trainingDays.find(td=>td.date===today);
  const checkedIn = (session?.attendees||[]).map(id=>[...students,profile].find(u=>u.id===id)).filter(Boolean);
  const alreadyIn = session?.attendees?.includes(selectedId);

  const verifyLocation = () => {
    if (!dojoSettings?.lat || !dojoSettings?.lng) { setGeoStatus("noGeo"); setCheckedGeo(true); return; }
    if (!navigator.geolocation) { setGeoStatus("blocked"); setCheckedGeo(true); return; }
    setGeoStatus("checking");
    navigator.geolocation.getCurrentPosition(
      pos => {
        const dist = getDistance(pos.coords.latitude, pos.coords.longitude, dojoSettings.lat, dojoSettings.lng);
        setGeoStatus(dist <= 100 ? "ok" : "blocked");
        setCheckedGeo(true);
      },
      () => { setGeoStatus("blocked"); setCheckedGeo(true); },
      { timeout: 10000 }
    );
  };

  const canCheckIn = isInstructor || geoStatus === "ok" || geoStatus === "noGeo";

  const handleCheckIn = async () => {
    if (!canCheckIn) { showToast("Location verification required","error"); return; }
    if (alreadyIn) { showToast("Already checked in!","error"); return; }
    setBusy(true);
    try {
      const sessionId = `td_${today}`;
      const existing = trainingDays.find(td=>td.date===today);
      if (existing) {
        await updateDoc(doc(db,"trainingDays",sessionId),{attendees:[...(existing.attendees||[]),selectedId]});
        setTrainingDays(prev=>prev.map(td=>td.date===today?{...td,attendees:[...(td.attendees||[]),selectedId]}:td));
      } else {
        const nd = {date:today,attendees:[selectedId],durationHours:parseFloat(duration)||1.5,createdAt:serverTimestamp()};
        await setDoc(doc(db,"trainingDays",sessionId),nd);
        setTrainingDays(prev=>[{id:sessionId,...nd},...prev]);
      }
      showToast("✅ Checked in successfully!");
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Training Check-In</h2>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>📅 Today: {today}</div>
        <div style={{fontSize:12,color:"#888",marginBottom:14}}>Check-in is only available for today's session.</div>

        {isInstructor && (
          <>
            <FSelect label="Check in student" value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
              <option value={profile.id}>{profile.name} (You)</option>
              {students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </FSelect>
            <FInput label="Session Duration (hours)" type="number" value={duration} onChange={e=>setDuration(e.target.value)} step="0.5" min="0.5" />
          </>
        )}

        {!isInstructor && (
          <>
            {!checkedGeo && (
              <div style={{textAlign:"center",marginBottom:14}}>
                <div style={{fontSize:13,color:"#aaa",marginBottom:12}}>You must verify your location before checking in.</div>
                <Btn onClick={verifyLocation} disabled={geoStatus==="checking"} style={{width:"100%"}}>
                  {geoStatus==="checking"?"📡 Checking location…":"📍 Verify My Location"}
                </Btn>
              </div>
            )}
            {geoStatus==="ok" && <InfoBox type="success">✅ Location verified — you are at the dojo!</InfoBox>}
            {geoStatus==="blocked" && <InfoBox type="error">❌ You are not within range of the dojo. Check-in is only allowed on premises.</InfoBox>}
            {geoStatus==="noGeo" && <InfoBox type="warn">⚠️ Dojo location not configured yet. Contact your instructor.</InfoBox>}
          </>
        )}

        {alreadyIn && <InfoBox type="success">✅ Already checked in for today!</InfoBox>}

        <Btn onClick={handleCheckIn} disabled={busy||alreadyIn||!canCheckIn} style={{width:"100%"}}>
          {busy?"Checking in…":"Check In"}
        </Btn>
      </Card>

      <Card>
        <div style={{fontWeight:700,marginBottom:10,color:"#C8A04A"}}>Today's Attendance ({checkedIn.length})</div>
        {checkedIn.length===0
          ?<div style={{color:"#555",fontSize:13}}>No one checked in yet.</div>
          :checkedIn.map(u=>(
            <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
              <span style={{fontSize:13}}>{u.name}</span>
              <BeltBadge beltIndex={u.beltIndex||0} />
            </div>
          ))}
      </Card>
    </div>
  );
}

// ─── Training Days ────────────────────────────────────────────────────────────
function TrainingDaysView({ trainingDays, setTrainingDays, students, profile, isInstructor, showToast, db }) {
  const [filterMonth, setFilterMonth] = useState("");
  const [editId, setEditId] = useState(null);
  const [expandedIds, setExpandedIds] = useState({});
  const [addingToId, setAddingToId] = useState(null); // which session is open for adding
  const [addStudentId, setAddStudentId] = useState("");
  const allUsers = [...students, profile];
  const filtered = filterMonth ? trainingDays.filter(td=>td.date?.startsWith(filterMonth)) : trainingDays;

  const toggleExpand = id => setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));

  const removeAttendee = async (tdId, userId) => {
    const td = trainingDays.find(t=>t.id===tdId);
    const updated = (td.attendees||[]).filter(a=>a!==userId);
    await updateDoc(doc(db,"trainingDays",tdId),{attendees:updated});
    setTrainingDays(prev=>prev.map(t=>t.id===tdId?{...t,attendees:updated}:t));
    showToast("Removed attendee");
  };

  const addAttendee = async (tdId) => {
    if (!addStudentId) { showToast("Select a student","error"); return; }
    const td = trainingDays.find(t=>t.id===tdId);
    if (td.attendees?.includes(addStudentId)) { showToast("Already in this session","error"); return; }
    const updated = [...(td.attendees||[]), addStudentId];
    await updateDoc(doc(db,"trainingDays",tdId),{attendees:updated});
    setTrainingDays(prev=>prev.map(t=>t.id===tdId?{...t,attendees:updated}:t));
    setAddStudentId("");
    setAddingToId(null);
    showToast("✅ Student added to session");
  };

  const deleteSession = async id => {
    if (!window.confirm("Delete this session?")) return;
    await deleteDoc(doc(db,"trainingDays",id));
    setTrainingDays(prev=>prev.filter(t=>t.id!==id));
    showToast("Session deleted");
  };

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Training Days</h2>
      <FInput label="Filter by Month" type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} />

      {filtered.map(td => {
        const attendees = (td.attendees||[]).map(id=>allUsers.find(u=>u.id===id)).filter(Boolean);
        const iAttended = td.attendees?.includes(profile.id);
        const isExpanded = isInstructor ? (editId===td.id || expandedIds[td.id]) : !!expandedIds[td.id];
        const isAddingHere = addingToId===td.id;

        // Students not yet in this session (for add dropdown)
        const notAttending = allUsers.filter(u=>!(td.attendees||[]).includes(u.id));

        return (
          <Card key={td.id} style={{marginBottom:10}}>
            {/* Header */}
            <div onClick={()=>toggleExpand(td.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
              <div>
                <div style={{fontWeight:800,fontSize:15}}>{td.date}</div>
                <div style={{fontSize:12,color:"#888",marginTop:2}}>
                  {attendees.length} attendees · {td.durationHours}h
                  {iAttended && <span style={{color:"#4ade80",marginLeft:8}}>✅ You attended</span>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {isInstructor && (
                  <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                    <Btn variant="ghost" style={{padding:"4px 10px",fontSize:11}} onClick={()=>{ setEditId(editId===td.id?null:td.id); setAddingToId(null); }}>Edit</Btn>
                    <Btn variant="danger" style={{padding:"4px 10px",fontSize:11}} onClick={()=>deleteSession(td.id)}>Del</Btn>
                  </div>
                )}
                <span style={{color:"#666",fontSize:16,display:"inline-block",transform:isExpanded?"rotate(180deg)":"rotate(0deg)"}}>⌄</span>
              </div>
            </div>

            {/* Collapsible attendee list */}
            {isExpanded && (
              <div style={{marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:8}}>
                {attendees.length===0
                  ?<div style={{fontSize:12,color:"#555",marginBottom:8}}>No attendees recorded.</div>
                  :attendees.map(u=>(
                    <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                      <span style={{fontSize:13,color:u.id===profile.id?"#C8A04A":"#fff",fontWeight:u.id===profile.id?700:400}}>{u.name}{u.id===profile.id?" (You)":""}</span>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <BeltBadge beltIndex={u.beltIndex||0} />
                        {isInstructor && editId===td.id && (
                          <button onClick={()=>removeAttendee(td.id,u.id)} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                        )}
                      </div>
                    </div>
                  ))
                }

                {/* Add student section — instructor only */}
                {isInstructor && editId===td.id && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.07)"}}>
                    {!isAddingHere ? (
                      <Btn variant="green" style={{width:"100%",fontSize:12,padding:"7px"}} onClick={e=>{ e.stopPropagation(); setAddingToId(td.id); setAddStudentId(""); }}>
                        + Add Student to This Session
                      </Btn>
                    ) : (
                      <div onClick={e=>e.stopPropagation()}>
                        <FSelect label="Select Student to Add" value={addStudentId} onChange={e=>setAddStudentId(e.target.value)} style={{marginBottom:8}}>
                          <option value="">-- Choose student --</option>
                          {notAttending.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                        </FSelect>
                        <div style={{display:"flex",gap:8}}>
                          <Btn onClick={()=>addAttendee(td.id)} disabled={!addStudentId} style={{flex:1,fontSize:12,padding:"7px"}}>Add</Btn>
                          <Btn variant="ghost" onClick={()=>{ setAddingToId(null); setAddStudentId(""); }} style={{flex:1,fontSize:12,padding:"7px"}}>Cancel</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
      {filtered.length===0 && <div style={{color:"#555",textAlign:"center",marginTop:40}}>No sessions found.</div>}
    </div>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────
function EventsView({ events, setEvents, students, setStudents, profile, isInstructor, showToast, db }) {
  const [subview, setSubview] = useState("list"); // list | add
  const [editingEv, setEditingEv] = useState(null);

  // ── List
  if (subview === "list") return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Events</h2>
        {isInstructor && <Btn onClick={()=>setSubview("add")}>+ Add Event</Btn>}
      </div>
      {events.map(ev => {
        const count = Object.values(ev.participants||{}).filter(p=>p.attended).length;
        const myStatus = ev.participants?.[profile.id];
        const myPts = myStatus?.attended ? (parseFloat(myStatus.hoursAttended||ev.hours||0) + (ev.isCompetition&&myStatus.placement>=1&&myStatus.placement<=4?PLACEMENT_PTS[myStatus.placement-1]:0)) : 0;
        return (
          <Card key={ev.id} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div>
                <div style={{fontWeight:800,fontSize:15}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#888"}}>{ev.date} · {ev.hours}h{ev.isCompetition?" 🏆 Competition":""}</div>
                <div style={{fontSize:12,color:"#4ade80",marginTop:2}}>{ev.hours} attendance pts{ev.isCompetition?" + placement bonus":""}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,color:"#aaa"}}>{count} attended</div>
                {isInstructor && (
                  <div style={{display:"flex",gap:4,marginTop:6,justifyContent:"flex-end"}}>
                    <Btn variant="ghost" style={{padding:"2px 8px",fontSize:10}} onClick={()=>{ setEditingEv(ev); setSubview("add"); }}>Edit</Btn>
                    <Btn variant="danger" style={{padding:"2px 8px",fontSize:10}} onClick={async()=>{ if(!window.confirm("Delete event?"))return; await deleteDoc(doc(db,"events",ev.id)); setEvents(prev=>prev.filter(e=>e.id!==ev.id)); showToast("Event deleted"); }}>Del</Btn>
                  </div>
                )}
              </div>
            </div>
            {!isInstructor && myStatus?.attended && (
              <div style={{background:"rgba(200,160,74,0.1)",border:"1px solid rgba(200,160,74,0.2)",borderRadius:8,padding:"8px 12px",marginTop:8}}>
                <div style={{fontSize:13,color:"#4ade80",fontWeight:600}}>✅ You attended · {myStatus.hoursAttended||ev.hours}h</div>
                {myStatus.placement && <>
                  <div style={{fontSize:12,color:"#C8A04A"}}>🏅 {myStatus.placement}{["st","nd","rd","th"][myStatus.placement-1]||"th"} place{myStatus.category?` — ${myStatus.category}`:""}</div>
                </>}
                <div style={{fontSize:12,color:"#4ade80"}}>+{myPts.toFixed(0)} total pts earned</div>
              </div>
            )}
            {!isInstructor && !myStatus?.attended && <div style={{fontSize:12,color:"#555",marginTop:4}}>You did not attend this event.</div>}
            {isInstructor && count > 0 && (
              <div style={{marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:10}}>
                {Object.entries(ev.participants||{}).filter(([,p])=>p.attended).map(([uid,p])=>{
                  const s = students.find(st=>st.id===uid);
                  if (!s) return null;
                  const pts = parseFloat(p.hoursAttended||ev.hours||0) + (ev.isCompetition&&p.placement>=1&&p.placement<=4?PLACEMENT_PTS[p.placement-1]:0);
                  return (
                    <div key={uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:12}}>
                      <span>{s.name}{p.category?<span style={{color:"#888"}}> · {p.category}</span>:""}</span>
                      <div style={{textAlign:"right"}}>
                        {p.placement&&<span style={{color:"#C8A04A",marginRight:8}}>🏅 {p.placement}{["st","nd","rd","th"][p.placement-1]}</span>}
                        <span style={{color:"#4ade80"}}>+{pts.toFixed(0)} pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
      {events.length===0 && <div style={{color:"#555",textAlign:"center",marginTop:40}}>No events yet.</div>}
    </div>
  );

  // ── Add / Edit Event
  return (
    <AddEventView
      existingEvent={editingEv}
      students={students}
      setStudents={setStudents}
      db={db}
      showToast={showToast}
      onSave={ev => {
        if (editingEv) { setEvents(prev=>prev.map(e=>e.id===ev.id?ev:e)); }
        else { setEvents(prev=>[ev,...prev]); }
        setEditingEv(null); setSubview("list");
      }}
      onCancel={()=>{ setEditingEv(null); setSubview("list"); }}
    />
  );
}

function AddEventView({ existingEvent, students, setStudents, db, showToast, onSave, onCancel }) {
  const isEdit = !!existingEvent;
  const [step, setStep] = useState(1); // 1=event details, 2=participants
  const [form, setForm] = useState({
    name: existingEvent?.name || "",
    date: existingEvent?.date || getLocalToday(),
    hours: existingEvent?.hours || "",
    isCompetition: existingEvent?.isCompetition || false,
    type: existingEvent?.type || "regular", // regular | rankExam
  });
  const [participants, setParticipants] = useState(existingEvent?.participants || {});
  const [addMode, setAddMode] = useState("individual"); // individual | csv
  const [indivId, setIndivId] = useState("");
  const [indivPlacement, setIndivPlacement] = useState("");
  const [indivCategory, setIndivCategory] = useState("");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  const addIndividual = () => {
    if (!indivId) { showToast("Select a student","error"); return; }
    if (form.type==="rankExam") {
      if (indivPlacement==="") { showToast("Select belt level being tested","error"); return; }
      if (!indivCategory) { showToast("Select S or E result","error"); return; }
      setParticipants(prev => ({
        ...prev,
        [indivId]: { attended: true, examBeltIndex: Number(indivPlacement), result: indivCategory }
      }));
    } else {
      const placement = parseInt(indivPlacement) || null;
      setParticipants(prev => ({
        ...prev,
        [indivId]: { attended: true, hoursAttended: parseFloat(form.hours)||0, placement, category: indivCategory.trim()||null }
      }));
    }
    setIndivId(""); setIndivPlacement(""); setIndivCategory("");
    showToast("Student added to event");
  };

  const removeParticipant = uid => {
    setParticipants(prev => { const n={...prev}; delete n[uid]; return n; });
  };

  const handleCSV = () => {
    const rows = parseCSV(csvText);
    let added=0, notFound=[];
    const newP = {...participants};
    rows.forEach(row => {
      const email = (row.email||"").toLowerCase().trim();
      const name = (row.name||"").toLowerCase().trim();
      const student = students.find(s => s.email?.toLowerCase()===email || s.name?.toLowerCase()===name);
      if (!student) { notFound.push(row.email||row.name||"unknown"); return; }
      newP[student.id] = {
        attended: true,
        hoursAttended: parseFloat(form.hours)||0,
        placement: parseInt(row.placement)||null,
        category: (row.category||"").trim()||null,
      };
      added++;
    });
    setParticipants(newP);
    showToast(`Added ${added} students${notFound.length?`. Not found: ${notFound.slice(0,3).join(", ")}`:""}`, added>0?"success":"error");
    setCsvText("");
  };

  const handleSave = async () => {
    if (!form.name.trim()||!form.date) { showToast("Name and date required","error"); return; }
    if (form.type==="regular"&&!form.hours) { showToast("Hours required for regular events","error"); return; }
    setBusy(true);
    try {
      const id = existingEvent?.id || `ev_${Date.now()}`;
      const evData = { name:form.name.trim(), date:form.date, type:form.type, hours:parseFloat(form.hours)||0, isCompetition:form.isCompetition, participants, updatedAt:serverTimestamp() };
      if (!existingEvent) evData.createdAt = serverTimestamp();
      await setDoc(doc(db,"events",id), evData, {merge:true});
      // Process rank exam promotions
      if (form.type==="rankExam" && setStudents) {
        for (const [uid, p] of Object.entries(participants)) {
          if (!p.attended) continue;
          const student = students.find(s=>s.id===uid);
          if (!student) continue;
          await processRankExam(db, student, p.examBeltIndex, p.result, form.date, setStudents, ()=>{});
        }
        showToast(`🥋 Rank exam saved! ${Object.keys(participants).length} results processed.`);
      } else {
        showToast(isEdit?"Event updated!":"Event saved!");
      }
      onSave({id,...evData});
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  const participantList = Object.entries(participants).filter(([,p])=>p.attended);

  return (
    <div>
      <button onClick={onCancel} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>{isEdit?"Edit Event":"Add Event"}</h2>

      {/* Step indicators */}
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[["1","Event Details"],["2","Participants"]].map(([n,l])=>(
          <div key={n} onClick={()=>{ if(n==="2"&&(!form.name||!form.hours))return; setStep(parseInt(n)); }} style={{flex:1,background:step===parseInt(n)?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.05)",border:step===parseInt(n)?"1px solid rgba(200,160,74,0.5)":"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"8px 12px",cursor:"pointer",textAlign:"center"}}>
            <div style={{fontSize:12,fontWeight:700,color:step===parseInt(n)?"#C8A04A":"#555"}}>Step {n}</div>
            <div style={{fontSize:11,color:step===parseInt(n)?"#ddd":"#444"}}>{l}</div>
          </div>
        ))}
      </div>

      {step===1 && (
        <Card>
          {/* Event Type */}
          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:6,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Event Type</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[["regular","🏆 Regular Event"],["rankExam","🥋 Rank Examination"]].map(([val,label])=>(
                <div key={val} onClick={()=>setForm(f=>({...f,type:val}))} style={{background:form.type===val?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.04)",border:form.type===val?"2px solid #C8A04A":"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px",cursor:"pointer",textAlign:"center",fontSize:13,fontWeight:600,color:form.type===val?"#C8A04A":"#888"}}>
                  {label}
                </div>
              ))}
            </div>
          </div>

          <FInput label="Event Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder={form.type==="rankExam"?"e.g. Spring 2025 Rank Examination":"e.g. Fall Shiai Tournament"} />
          <FInput label="Event Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />

          {form.type==="regular" && (<>
            <FInput label="Event Hours (creditable points)" type="number" value={form.hours} onChange={e=>setForm(f=>({...f,hours:e.target.value}))} placeholder="e.g. 4" min="0.5" step="0.5" />
            <div style={{background:"rgba(200,160,74,0.08)",border:"1px solid rgba(200,160,74,0.2)",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#C8A04A"}}>
              Each attendee earns <strong>{form.hours||"0"} points</strong> for attending.
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <input type="checkbox" checked={form.isCompetition} onChange={e=>setForm(f=>({...f,isCompetition:e.target.checked}))} id="isComp" style={{width:18,height:18,accentColor:"#C8A04A"}} />
              <label htmlFor="isComp" style={{color:"#C8A04A",fontSize:14,fontWeight:600}}>🏆 Competition (placement points apply)</label>
            </div>
            {form.isCompetition && (
              <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:12,marginBottom:14,fontSize:12}}>
                <div style={{color:"#C8A04A",fontWeight:700,marginBottom:6}}>Placement Bonuses:</div>
                {["1st = +10 pts","2nd = +9 pts","3rd = +8 pts","4th = +7 pts"].map(l=>(
                  <div key={l} style={{color:"#aaa",padding:"2px 0"}}>🏅 {l}</div>
                ))}
              </div>
            )}
          </>)}

          {form.type==="rankExam" && (
            <InfoBox type="info">
              In the next step, add each student with their exam result (S or E) and the belt level they tested for. Promotions will be applied automatically.
            </InfoBox>
          )}

          <Btn onClick={()=>{ if(!form.name.trim()||(form.type==="regular"&&!form.hours)){showToast("Name and hours required","error");return;} setStep(2); }} style={{width:"100%"}}>Next: Add Participants →</Btn>
        </Card>
      )}

      {step===2 && (
        <div>
          {/* Summary bar */}
          <Card style={{marginBottom:14,background:"linear-gradient(135deg,rgba(200,160,74,0.1),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.25)"}}>
            <div style={{fontWeight:700}}>{form.name}</div>
            <div style={{fontSize:12,color:"#888"}}>{form.date} · {form.hours}h · {participantList.length} participants{form.isCompetition?" · Competition":""}</div>
          </Card>

          {/* Add mode toggle */}
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["individual","👤 Individual"],["csv","📥 Bulk CSV"]].map(([m,l])=>(
              <button key={m} onClick={()=>setAddMode(m)} style={{flex:1,background:addMode===m?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.05)",border:addMode===m?"1px solid rgba(200,160,74,0.5)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:addMode===m?"#C8A04A":"#777",padding:"8px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>{l}</button>
            ))}
          </div>

          {/* Individual add */}
          {addMode==="individual" && (
            <Card style={{marginBottom:14}}>
              <FSelect label="Select Student" value={indivId} onChange={e=>setIndivId(e.target.value)}>
                <option value="">-- Choose student --</option>
                {students.filter(s=>!participants[s.id]?.attended).map(s=><option key={s.id} value={s.id}>{s.name} — {BELT_LEVELS[s.beltIndex||0]?.name}</option>)}
              </FSelect>

              {form.type==="rankExam" && indivId && (<>
                <FSelect label="Belt Level Being Tested" value={indivPlacement} onChange={e=>setIndivPlacement(e.target.value)}>
                  <option value="">-- Select belt level tested --</option>
                  {BELT_LEVELS.map((_,i)=> isKyuRank(i) ? <option key={i} value={i}>{beltDropdownLabel(i)}</option> : null)}
                </FSelect>
                {indivPlacement !== "" && (
                  <div style={{marginBottom:14}}>
                    <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:6,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Result</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {[["S","S — Satisfactory"],["E","E — Exceeding"]].map(([val,label])=>(
                        <div key={val} onClick={()=>setIndivCategory(val)} style={{background:indivCategory===val?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.04)",border:indivCategory===val?"2px solid #C8A04A":"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px",cursor:"pointer",textAlign:"center",fontSize:13,fontWeight:700,color:indivCategory===val?"#C8A04A":"#888"}}>{label}</div>
                      ))}
                    </div>
                  </div>
                )}
                {indivPlacement !== "" && indivCategory && (() => {
                  const student = students.find(s=>s.id===indivId);
                  const { promoted, levelsAdvanced } = calcPromotion(student?.beltIndex||0, Number(indivPlacement), indivCategory);
                  return (
                    <div style={{background:promoted?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",border:`1px solid ${promoted?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12}}>
                      <strong style={{color:promoted?"#4ade80":"#f87171"}}>{getRankCode(Number(indivPlacement),indivCategory)}</strong>
                      <span style={{color:"#aaa",marginLeft:8}}>{promoted?`✅ Will promote${levelsAdvanced>1?" (+2 levels)":""}` : "❌ No promotion"}</span>
                    </div>
                  );
                })()}
              </>)}

              {form.type==="regular" && form.isCompetition && indivId && (
                <>
                  <FSelect label="Placement (optional)" value={indivPlacement} onChange={e=>setIndivPlacement(e.target.value)}>
                    <option value="">No placement / Did not place</option>
                    {PLACEMENT_LABELS.map((l,i)=><option key={i} value={i+1}>{l}</option>)}
                  </FSelect>
                  {indivPlacement && (
                    <FInput label="Category Name" value={indivCategory} onChange={e=>setIndivCategory(e.target.value)} placeholder="e.g. Kumite Under 70kg" />
                  )}
                </>
              )}
              <Btn onClick={addIndividual} disabled={!indivId} style={{width:"100%"}}>+ Add to Event</Btn>
            </Card>
          )}

          {/* CSV add */}
          {addMode==="csv" && (
            <Card style={{marginBottom:14}}>
              <InfoBox type="info">
                CSV columns: <code style={{fontSize:11}}>name, email, placement, category</code><br/>
                Leave placement/category blank for non-placers.
              </InfoBox>
              <div style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Upload CSV</label>
                <input type="file" accept=".csv" onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f); }} style={{color:"#fff",fontSize:13}} />
              </div>
              {csvText && <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:10,fontSize:11,color:"#888",maxHeight:100,overflowY:"auto",fontFamily:"monospace"}}>{csvText.slice(0,300)}</div>}
              <Btn onClick={handleCSV} disabled={!csvText} style={{width:"100%"}}>Import from CSV</Btn>
            </Card>
          )}

          {/* Participant list */}
          {participantList.length > 0 && (
            <Card style={{marginBottom:14}}>
              <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Participants ({participantList.length})</div>
              {participantList.map(([uid,p])=>{
                const s=students.find(st=>st.id===uid);
                if (form.type==="rankExam") {
                  const code = p.examBeltIndex!==undefined&&p.result ? getRankCode(Number(p.examBeltIndex),p.result) : "?";
                  const { promoted } = p.examBeltIndex!==undefined&&p.result ? calcPromotion(s?.beltIndex||0,Number(p.examBeltIndex),p.result) : {promoted:false};
                  return (
                    <div key={uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600}}>{s?.name||uid}</div>
                        <div style={{fontSize:12,color:"#888"}}>{BELT_LEVELS[s?.beltIndex||0]?.name} → testing {BELT_LEVELS[Number(p.examBeltIndex)]?.name}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:14,fontWeight:800,color:promoted?"#4ade80":"#f87171"}}>{code}</span>
                        <button onClick={()=>removeParticipant(uid)} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                      </div>
                    </div>
                  );
                }
                const pts=parseFloat(p.hoursAttended||form.hours||0)+(form.isCompetition&&p.placement>=1&&p.placement<=4?PLACEMENT_PTS[p.placement-1]:0);
                return (
                  <div key={uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600}}>{s?.name||uid}</div>
                      {p.placement&&<div style={{fontSize:11,color:"#C8A04A"}}>🏅 {p.placement}{["st","nd","rd","th"][p.placement-1]} place{p.category?` — ${p.category}`:""}</div>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:"#4ade80",fontSize:13,fontWeight:700}}>+{pts.toFixed(0)} pts</span>
                      <button onClick={()=>removeParticipant(uid)} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          <div style={{display:"flex",gap:10}}>
            <Btn variant="ghost" onClick={()=>setStep(1)} style={{flex:1}}>← Back</Btn>
            <Btn onClick={handleSave} disabled={busy} style={{flex:2}}>{busy?"Saving…":`Save Event (${participantList.length} participants)`}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function CSVEventModal({ event, onUpload, onClose }) {
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const handleFile = e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f); };
  const handleSubmit = async () => { if(!csvText.trim())return; setBusy(true); await onUpload(event.id,csvText); setBusy(false); };
  return (
    <Modal title={`CSV Import: ${event.name}`} onClose={onClose}>
      <InfoBox type="info">Columns: <code style={{fontSize:12}}>name, email, placement, category</code></InfoBox>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Upload CSV File</label>
        <input type="file" accept=".csv" onChange={handleFile} style={{color:"#fff",fontSize:13}} />
      </div>
      {csvText&&<div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:14,fontSize:11,color:"#888",maxHeight:120,overflowY:"auto",fontFamily:"monospace"}}>{csvText.slice(0,400)}</div>}
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={handleSubmit} disabled={busy||!csvText} style={{flex:1}}>{busy?"Importing…":"Import"}</Btn>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── Students ─────────────────────────────────────────────────────────────────
function StudentsView({ students, setStudents, trainingDays, events, showToast, db, secondaryAuth }) {
  const [view, setView] = useState("list"); // list | add | edit | detail | csv
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({name:"",email:"",beltIndex:0,joinDate:getLocalToday(),beltAchievedDate:getLocalToday()});
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  const createStudent = async () => {
    if (!form.name.trim()||!form.email.trim()) { showToast("Name and email required","error"); return; }
    setBusy(true);
    try {
      const tempPass = "Welcome@"+Math.floor(1000+Math.random()*9000);
      // Use secondary auth so instructor stays logged in
      const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email.trim(), tempPass);
      const uid = cred.user.uid;
      const newProfile = {name:form.name.trim(),email:form.email.trim(),role:"student",beltIndex:Number(form.beltIndex),joinDate:form.joinDate,beltAchievedDate:form.beltAchievedDate,createdAt:serverTimestamp()};
      await setDoc(doc(db,"users",uid),newProfile);
      await sendPasswordResetEmail(secondaryAuth, form.email.trim());
      await signOut(secondaryAuth); // sign out secondary, instructor session untouched
      setStudents(prev=>[...prev,{id:uid,...newProfile}]);
      showToast(`✅ ${form.name} added! Welcome email sent.`);
      setForm({name:"",email:"",beltIndex:0,joinDate:getLocalToday(),beltAchievedDate:getLocalToday()});
      setView("list");
    } catch(e) {
      showToast(e.code==="auth/email-already-in-use"?"Email already registered":e.message,"error");
    }
    setBusy(false);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const updates={name:selected.name,email:selected.email,beltIndex:Number(selected.beltIndex),joinDate:selected.joinDate,beltAchievedDate:selected.beltAchievedDate};
      await updateDoc(doc(db,"users",selected.id),updates);
      setStudents(prev=>prev.map(s=>s.id===selected.id?{...s,...updates}:s));
      showToast("Student updated!");
      setView("detail");
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  const deleteStudent = async id => {
    if (!window.confirm("Delete this student?")) return;
    await deleteDoc(doc(db,"users",id));
    setStudents(prev=>prev.filter(s=>s.id!==id));
    setView("list"); setSelected(null);
    showToast("Student removed");
  };

  const promoteStudent = async s => {
    const ni=Math.min((s.beltIndex||0)+1,BELT_LEVELS.length-1);
    const today=getLocalToday();
    await updateDoc(doc(db,"users",s.id),{beltIndex:ni,beltAchievedDate:today});
    const updated={...s,beltIndex:ni,beltAchievedDate:today};
    setStudents(prev=>prev.map(u=>u.id===s.id?updated:u));
    setSelected(updated);
    showToast(`🎉 Promoted to ${BELT_LEVELS[ni].name}!`);
  };

  const handleCSVImport = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    const rows = parseCSV(csvText);
    let added=0, errors=[];
    for (const row of rows) {
      if (!row.email||!row.name) { errors.push(row.email||"missing email"); continue; }
      try {
        const tempPass="Welcome@"+Math.floor(1000+Math.random()*9000);
        const cred=await createUserWithEmailAndPassword(secondaryAuth,row.email.trim(),tempPass);
        const uid=cred.user.uid;
        const p={name:row.name.trim(),email:row.email.trim(),role:"student",beltIndex:parseInt(row.beltindex||row.beltIndex||0)||0,joinDate:row.joindate||row.joinDate||getLocalToday(),beltAchievedDate:row.beltachieveddate||row.beltAchievedDate||row.joindate||getLocalToday(),createdAt:serverTimestamp()};
        await setDoc(doc(db,"users",uid),p);
        await sendPasswordResetEmail(secondaryAuth,row.email.trim());
        await signOut(secondaryAuth);
        setStudents(prev=>[...prev,{id:uid,...p}]);
        added++;
      } catch(e) { errors.push(`${row.email}: ${e.code==="auth/email-already-in-use"?"already registered":e.message}`); }
    }
    showToast(`✅ Imported ${added} students${errors.length?`. Errors: ${errors.slice(0,2).join(", ")}`:""}`);
    setCsvText(""); setView("list");
    setBusy(false);
  };

  // ── List view
  if (view==="list") return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Students ({students.length})</h2>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" onClick={()=>setView("csv")} style={{fontSize:12,padding:"7px 12px"}}>📥 CSV</Btn>
          <Btn onClick={()=>setView("add")} style={{fontSize:12,padding:"7px 12px"}}>+ Add</Btn>
        </div>
      </div>
      {students.sort((a,b)=>a.name.localeCompare(b.name)).map(s=>{
        const st=calcStats(s.id,trainingDays,events);
        const bi=getBeltProgress(s.beltIndex||0,s.joinDate,s.beltAchievedDate,st);
        return (
          <Card key={s.id} style={{marginBottom:10}} onClick={()=>{setSelected(s);setView("detail");}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{s.name}</div>
                <BeltBadge beltIndex={s.beltIndex||0} />
                <div style={{marginTop:8}}><ProgressBar percent={bi.progress} /></div>
              </div>
              <div style={{textAlign:"right",marginLeft:14}}><div style={{color:"#C8A04A",fontWeight:800,fontSize:18}}>{st.totalPoints.toFixed(0)}</div><div style={{fontSize:10,color:"#666"}}>pts</div></div>
            </div>
          </Card>
        );
      })}
      {students.length===0&&<div style={{color:"#555",textAlign:"center",marginTop:40}}>No students yet. Add one or import via CSV.</div>}
    </div>
  );

  // ── Add student
  if (view==="add") return (
    <div>
      <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Add Student</h2>
      <Card>
        <FInput label="Full Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Student's full name" />
        <FInput label="Email" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="student@email.com" />
        <FSelect label="Current Belt" value={form.beltIndex} onChange={e=>setForm(f=>({...f,beltIndex:e.target.value}))}>
          {BELT_LEVELS.map((_,i)=><option key={i} value={i}>{beltDropdownLabel(i)}</option>)}
        </FSelect>
        <FInput label="Join Date" type="date" value={form.joinDate} onChange={e=>setForm(f=>({...f,joinDate:e.target.value}))} />
        <FInput label="Date Belt Was Achieved" type="date" value={form.beltAchievedDate} onChange={e=>setForm(f=>({...f,beltAchievedDate:e.target.value}))} />
        <InfoBox type="info">A password reset email will be automatically sent to the student.</InfoBox>
        <Btn onClick={createStudent} disabled={busy} style={{width:"100%"}}>{busy?"Creating…":"Add Student & Send Email"}</Btn>
      </Card>
    </div>
  );

  // ── CSV Import
  if (view==="csv") return (
    <div>
      <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>CSV Import</h2>
      <Card>
        <InfoBox type="info">
          CSV columns (first row must be headers):<br/>
          <code style={{fontSize:12}}>name, email, beltIndex, joinDate, beltAchievedDate</code><br/><br/>
          beltIndex: 0=White, 1=Orange, 2=Red… 9=Shodan, etc.<br/>
          A password reset email is sent to each student.
        </InfoBox>
        <div style={{marginBottom:14}}>
          <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Upload CSV File</label>
          <input type="file" accept=".csv" onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f); }} style={{color:"#fff",fontSize:13}} />
        </div>
        {csvText&&<div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:14,fontSize:11,color:"#888",maxHeight:120,overflowY:"auto",fontFamily:"monospace"}}>{csvText.slice(0,500)}</div>}
        <Btn onClick={handleCSVImport} disabled={busy||!csvText} style={{width:"100%"}}>{busy?"Importing…":"Import Students"}</Btn>
      </Card>
    </div>
  );

  // ── Detail view
  if (view==="detail" && selected) {
    const s = students.find(u=>u.id===selected.id) || selected;
    const stats = calcStats(s.id, trainingDays, events, s.trainingResetDate);
    const bi = getBeltProgress(s.beltIndex||0, s.joinDate, s.beltAchievedDate, stats, s);
    const sessions = trainingDays.filter(td=>td.attendees?.includes(s.id));
    const myEvents = events.filter(ev=>ev.participants?.[s.id]?.attended && ev.type !== "rankExam");
    const rankHistory = [...(s.rankHistory||[])].sort((a,b)=>b.date?.localeCompare(a.date));

    return (
      <div>
        <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← All Students</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{s.name}</h2>
          <div style={{display:"flex",gap:6}}>
            <Btn variant="green" onClick={()=>setView("rankexam")} style={{fontSize:11,padding:"5px 10px"}}>🥋 Rank Exam</Btn>
            <Btn variant="ghost" onClick={()=>{setSelected(s);setView("edit");}} style={{fontSize:11,padding:"5px 10px"}}>Edit</Btn>
          </div>
        </div>

        {/* Belt + progress */}
        <Card style={{marginBottom:12,background:"linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.3)"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
            <BeltBadge beltIndex={s.beltIndex||0} size="lg" />
            <div>
              <div style={{fontSize:12,color:"#C8A04A",fontWeight:700}}>{BELT_LEVELS[s.beltIndex||0]?.kyu}</div>
              {isKyuRank(s.beltIndex||0) && (() => {
                // Show the actual result code from last rank exam if available
                const lastPromotion = [...(s.rankHistory||[])].filter(r=>r.promoted).sort((a,b)=>b.date?.localeCompare(a.date))[0];
                const displayCode = lastPromotion ? lastPromotion.code : getRankCode(s.beltIndex||0,"S");
                return <div style={{fontSize:11,color:"#888"}}>Code: {displayCode}</div>;
              })()}
            </div>
          </div>
          {s.beltAchievedDate&&<div style={{fontSize:11,color:"#888",marginBottom:8}}>Achieved: {s.beltAchievedDate}</div>}
          {bi.next && (<>
            <ProgressBar percent={bi.progress} />
            <div style={{fontSize:12,color:"#aaa",marginTop:6}}>
              {bi.isYearBased
                ?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} years`
                :`${stats.trainingHoursSinceReset?.toFixed(1)||0} / ${bi.hoursNeeded}h to ${bi.next.name}`}
              {bi.extraHours>0 && <span style={{color:"#f87171",marginLeft:6}}>(+{bi.extraHours}h added from failed exam)</span>}
            </div>
          </>)}
          {!bi.next && <div style={{color:"#C8A04A",fontWeight:700,marginTop:8}}>🏆 Highest Rank!</div>}
        </Card>

        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
          {[["Sessions",sessions.length],["Hours",stats.trainingHours.toFixed(1)],["Points",stats.totalPoints.toFixed(0)]].map(([l,v])=>(
            <Card key={l} style={{textAlign:"center",padding:12}}><div style={{fontSize:20,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:10,color:"#888"}}>{l}</div></Card>
          ))}
        </div>

        {/* Rank Exam History */}
        <Card style={{marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>🥋 Rank Examination History</div>
          {rankHistory.length===0
            ?<div style={{color:"#555",fontSize:13}}>No rank exams recorded yet.</div>
            :rankHistory.map((r,i)=>(
              <div key={i} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <span style={{fontSize:15,fontWeight:800,color:r.promoted?"#4ade80":"#f87171",marginRight:8}}>{r.code}</span>
                    <span style={{fontSize:12,color:"#aaa"}}>{r.beltTestedName}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,color:"#888"}}>{r.date}</div>
                    <div style={{fontSize:11,fontWeight:700,color:r.promoted?"#4ade80":"#f87171"}}>
                      {r.promoted?`✅ Promoted${r.levelsAdvanced>1?" (+2 levels)":""}`:"❌ Not promoted"}
                    </div>
                  </div>
                </div>
                <div style={{fontSize:11,color:"#666",marginTop:2}}>
                  {r.result==="S"?"Satisfactory":"Exceeding"} — tested for {r.beltTestedName}
                </div>
              </div>
            ))
          }
        </Card>

        {/* Training Sessions */}
        <Card style={{marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Training Sessions ({sessions.length})</div>
          {sessions.slice(0,15).map(td=>(
            <div key={td.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
              <span>{td.date}</span><span style={{color:"#C8A04A"}}>{td.durationHours}h</span>
            </div>
          ))}
          {sessions.length===0&&<div style={{color:"#555",fontSize:13}}>No sessions yet.</div>}
        </Card>

        {/* Events */}
        <Card>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Events Attended</div>
          {myEvents.map(ev=>{
            const p=ev.participants[s.id];
            const h=parseFloat(p.hoursAttended||ev.hours||0);
            const pts=h+(ev.isCompetition&&p.placement?PLACEMENT_PTS[p.placement-1]:0);
            return (
              <div key={ev.id} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontSize:14,fontWeight:600}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#888"}}>{ev.date} · {h}h</div>
                {p.placement&&<div style={{fontSize:12,color:"#C8A04A"}}>🏅 {p.placement}{["st","nd","rd","th"][p.placement-1]||"th"} place</div>}
                <div style={{fontSize:12,color:"#4ade80"}}>+{pts.toFixed(0)} pts</div>
              </div>
            );
          })}
          {myEvents.length===0&&<div style={{color:"#555",fontSize:13}}>No events yet.</div>}
        </Card>
      </div>
    );
  }

  // ── Rank Exam Entry
  if (view==="rankexam" && selected) {
    const s = students.find(u=>u.id===selected.id) || selected;
    return <RankExamEntry student={s} db={db} showToast={showToast} setStudents={setStudents} onBack={()=>{ setSelected(students.find(u=>u.id===selected.id)||selected); setView("detail"); }} />;
  }

  // ── Edit view
  if (view==="edit" && selected) return (
    <div>
      <button onClick={()=>setView("detail")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Edit Student</h2>
      <Card>
        <FInput label="Full Name" value={selected.name} onChange={e=>setSelected(s=>({...s,name:e.target.value}))} />
        <FInput label="Email" value={selected.email} onChange={e=>setSelected(s=>({...s,email:e.target.value}))} />
        <FSelect label="Belt Level" value={selected.beltIndex} onChange={e=>setSelected(s=>({...s,beltIndex:Number(e.target.value)}))}>
          {BELT_LEVELS.map((_,i)=><option key={i} value={i}>{beltDropdownLabel(i)}</option>)}
        </FSelect>
        <FInput label="Join Date" type="date" value={selected.joinDate} onChange={e=>setSelected(s=>({...s,joinDate:e.target.value}))} />
        <FInput label="Belt Achieved Date" type="date" value={selected.beltAchievedDate||""} onChange={e=>setSelected(s=>({...s,beltAchievedDate:e.target.value}))} />
        <div style={{display:"flex",gap:10}}>
          <Btn onClick={saveEdit} disabled={busy} style={{flex:1}}>{busy?"Saving…":"Save"}</Btn>
          <Btn variant="danger" onClick={()=>deleteStudent(selected.id)} style={{flex:1}}>Delete</Btn>
        </div>
      </Card>
    </div>
  );

  return null;
}

// ─── Rank Exam Entry Component ────────────────────────────────────────────────
function RankExamEntry({ student, db, showToast, setStudents, onBack }) {
  const [examDate, setExamDate] = useState(getLocalToday());
  const [examBeltIndex, setExamBeltIndex] = useState(Math.min((student.beltIndex||0)+1, BELT_LEVELS.length-1));
  const [result, setResult] = useState("S");
  const [busy, setBusy] = useState(false);

  const { promoted, levelsAdvanced } = calcPromotion(student.beltIndex||0, examBeltIndex, result);
  const code = getRankCode(examBeltIndex, result);
  const targetBelt = BELT_LEVELS[examBeltIndex];

  const handleSubmit = async () => {
    setBusy(true);
    await processRankExam(db, student, examBeltIndex, result, examDate, setStudents, showToast);
    setBusy(false);
    onBack();
  };

  return (
    <div>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 4px",fontSize:22,fontWeight:800}}>Rank Examination</h2>
      <div style={{fontSize:13,color:"#888",marginBottom:18}}>{student.name}</div>

      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{fontSize:12,color:"#888"}}>Current rank:</div>
          <BeltBadge beltIndex={student.beltIndex||0} size="lg" />
          <div style={{fontSize:12,color:"#C8A04A",fontWeight:700}}>{getRankCode(student.beltIndex||0,"S")}</div>
        </div>

        <FInput label="Exam Date" type="date" value={examDate} onChange={e=>setExamDate(e.target.value)} />

        <FSelect label="Belt Level Being Tested" value={examBeltIndex} onChange={e=>setExamBeltIndex(Number(e.target.value))}>
          {BELT_LEVELS.map((b,i)=> isKyuRank(i) ? (
            <option key={i} value={i}>{beltDropdownLabel(i)}</option>
          ) : null)}
        </FSelect>

        <div style={{marginBottom:14}}>
          <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:8,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Result</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[["S","S — Satisfactory","Meets requirements, advances"],["E","E — Exceeding","Exceeds requirements, advances"]].map(([val,label,desc])=>(
              <div key={val} onClick={()=>setResult(val)} style={{background:result===val?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.04)",border:result===val?"2px solid #C8A04A":"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 12px",cursor:"pointer",textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:900,color:result===val?"#C8A04A":"#666"}}>{val}</div>
                <div style={{fontSize:12,fontWeight:700,color:result===val?"#fff":"#888"}}>{label}</div>
                <div style={{fontSize:10,color:"#666",marginTop:2}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:13,color:"#888",marginBottom:6}}>Result code: <span style={{fontSize:16,fontWeight:900,color:"#C8A04A"}}>{code}</span></div>
          <div style={{fontSize:13,color:"#888",marginBottom:4}}>Testing for: <span style={{color:"#fff",fontWeight:600}}>{targetBelt?.name} ({targetBelt?.kyu})</span></div>
          {promoted ? (
            <div style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"8px 12px",marginTop:8}}>
              <div style={{color:"#4ade80",fontWeight:700}}>✅ Will be promoted!</div>
              <div style={{fontSize:12,color:"#aaa",marginTop:2}}>
                {levelsAdvanced===2?"Advancing 2 levels (E — Exceeding)":"Advancing 1 level"} → <strong style={{color:"#fff"}}>{BELT_LEVELS[examBeltIndex]?.name}</strong>
              </div>
              <div style={{fontSize:11,color:"#888",marginTop:2}}>Training hours will reset from {examDate}</div>
            </div>
          ) : (
            <div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,padding:"8px 12px",marginTop:8}}>
              <div style={{color:"#f87171",fontWeight:700}}>❌ Not promoted</div>
              <div style={{fontSize:12,color:"#aaa",marginTop:2}}>
                {examBeltIndex<=( student.beltIndex||0)
                  ?"Testing at current or lower level — must test at a higher level to advance"
                  :`${BELT_LEVELS[examBeltIndex]?.hoursRequired||0} additional hours added to next test requirement`}
              </div>
            </div>
          )}
        </div>

        <Btn onClick={handleSubmit} disabled={busy} style={{width:"100%",fontSize:15}}>
          {busy?"Recording…":`Record ${code} Exam`}
        </Btn>
      </Card>
    </div>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function ReportView({ students, trainingDays, events }) {
  const rows=[...students].map(s=>{
    const st=calcStats(s.id,trainingDays,events);
    return {...s,...st};
  }).sort((a,b)=>b.totalPoints-a.totalPoints);

  const copyReport=()=>{
    const lines=["DOJO TRAINING REPORT",`${DOJO_NAME}`,`Generated: ${new Date().toLocaleDateString()}`,"",
      ...rows.map((r,i)=>{
        const bi=getBeltProgress(r.beltIndex||0,r.joinDate,r.beltAchievedDate,r);
        return `#${i+1} ${r.name} | ${BELT_LEVELS[r.beltIndex||0].name} | ${r.trainingPoints} sessions | ${r.trainingHours.toFixed(1)}h | ${r.eventPoints.toFixed(0)} event pts | ${r.totalPoints.toFixed(0)} total pts\n    Progress: ${bi.next?(bi.isYearBased?`${bi.years?.toFixed(1)}/${bi.yearsRequired} yrs`:`${r.trainingHours.toFixed(1)}/${bi.hoursNeeded}h → ${bi.next.name}`):"Max rank"}`;
      })
    ].join("\n");
    navigator.clipboard?.writeText(lines).then(()=>alert("Report copied!")).catch(()=>alert("Copy not supported"));
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Reports</h2>
        <Btn onClick={copyReport} style={{fontSize:12,padding:"7px 14px"}}>📋 Copy</Btn>
      </div>
      {rows.map((r,i)=>{
        const bi=getBeltProgress(r.beltIndex||0,r.joinDate,r.beltAchievedDate,r);
        return (
          <Card key={r.id} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{color:i<3?"#C8A04A":"#555",fontWeight:800}}>#{i+1}</span>
                  <span style={{fontWeight:700}}>{r.name}</span>
                </div>
                <BeltBadge beltIndex={r.beltIndex||0} />
              </div>
              <div style={{textAlign:"right"}}><div style={{color:"#C8A04A",fontWeight:900,fontSize:20}}>{r.totalPoints.toFixed(0)}</div><div style={{fontSize:10,color:"#666"}}>total pts</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12,marginBottom:10}}>
              {[["Sessions",r.trainingPoints],["Hours",r.trainingHours.toFixed(1)+"h"],["Evt Pts",r.eventPoints.toFixed(0)]].map(([l,v])=>(
                <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"6px 8px",textAlign:"center"}}><div style={{fontWeight:700,color:"#ddd"}}>{v}</div><div style={{color:"#666",fontSize:10}}>{l}</div></div>
              ))}
            </div>
            {bi.next?(<><ProgressBar percent={bi.progress}/><div style={{fontSize:11,color:"#888",marginTop:4}}>{bi.isYearBased?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} yrs`:`${r.trainingHours.toFixed(1)}/${bi.hoursNeeded}h → ${bi.next.name}`}</div></>):<div style={{fontSize:12,color:"#C8A04A",fontWeight:700}}>🏆 Highest rank</div>}
          </Card>
        );
      })}
      {rows.length===0&&<div style={{color:"#555",textAlign:"center",marginTop:40}}>No students yet.</div>}
    </div>
  );
}

// ─── My Record ────────────────────────────────────────────────────────────────
function MyRecordView({ profile, trainingDays, events, dojoSettings }) {
  const [mode, setMode] = useState("alltime");
  const [selectedSemester, setSelectedSemester] = useState(0);
  const range = getActiveRange(mode, dojoSettings, selectedSemester);
  const { filteredTd, filteredEv } = filterByRange(trainingDays, events, range.start, range.end);
  const stats = calcStats(profile.id, filteredTd, filteredEv);
  const allTimeStats = calcStats(profile.id, trainingDays, events);
  const bi = getBeltProgress(profile.beltIndex||0, profile.joinDate, profile.beltAchievedDate, allTimeStats);
  const mySessions = filteredTd.filter(td=>td.attendees?.includes(profile.id));
  const myEvents = filteredEv.filter(ev=>ev.participants?.[profile.id]?.attended);

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>My Record</h2>

      {/* Belt progress - always all time */}
      <Card style={{marginBottom:14,background:"linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.3)"}}>
        <BeltBadge beltIndex={profile.beltIndex||0} size="lg" />
        {profile.beltAchievedDate&&<div style={{fontSize:11,color:"#888",marginTop:4}}>Achieved: {profile.beltAchievedDate}</div>}
        <div style={{marginTop:12}}>
          {bi.next?(<>
            <div style={{fontSize:13,color:"#aaa",marginBottom:8}}>Progress to {bi.next.name}</div>
            <ProgressBar percent={bi.progress} />
            <div style={{fontSize:12,color:"#888",marginTop:6}}>
              {bi.isYearBased?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} years since last promotion`:`${allTimeStats.trainingHours.toFixed(1)} of ${bi.hoursNeeded} hours (all time)`}
            </div>
          </>):<div style={{color:"#C8A04A",fontWeight:700,marginTop:8}}>🏆 Highest Rank Achieved!</div>}
        </div>
      </Card>

      {/* Period selector */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>📊 View Period</div>
        <PeriodSelector dojoSettings={dojoSettings} mode={mode} setMode={setMode} selectedSemester={selectedSemester} setSelectedSemester={setSelectedSemester} />
        <div style={{fontSize:12,color:"#888",textAlign:"center"}}>Showing: <span style={{color:"#C8A04A",fontWeight:600}}>{range.label}</span>{range.start?` (${range.start} → ${range.end})`:""}</div>
      </Card>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {[["Training Sessions",mySessions.length,"📅"],["Training Hours",stats.trainingHours.toFixed(1)+"h","⏱️"],["Event Points",stats.eventPoints.toFixed(0),"🏆"],["Total Points",stats.totalPoints.toFixed(0),"⭐"]].map(([l,v,ic])=>(
          <Card key={l} style={{textAlign:"center"}}><div style={{fontSize:28}}>{ic}</div><div style={{fontSize:22,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:11,color:"#777"}}>{l}</div></Card>
        ))}
      </div>

      {/* Points breakdown */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Points Breakdown — {range.label}</div>
        {[
          ["Training Sessions",stats.trainingPoints,"1 pt per session"],
          ["Event Attendance",stats.eventHours.toFixed(0),"1 pt per hour"],
          ["Competition Placements",(stats.eventPoints-stats.eventHours).toFixed(0),"Top 4 bonus pts"],
          ["Total",stats.totalPoints.toFixed(0),""],
        ].map(([l,v,sub],i)=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<3?"1px solid rgba(255,255,255,0.06)":"none",borderTop:i===3?"2px solid rgba(200,160,74,0.3)":"none",marginTop:i===3?4:0}}>
            <div>
              <div style={{fontSize:13,fontWeight:i===3?800:400,color:i===3?"#C8A04A":"#fff"}}>{l}</div>
              {sub&&<div style={{fontSize:11,color:"#666"}}>{sub}</div>}
            </div>
            <div style={{fontSize:15,fontWeight:i===3?900:600,color:i===3?"#C8A04A":"#aaa"}}>{v}</div>
          </div>
        ))}
      </Card>

      {/* Training sessions */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Training Sessions ({mySessions.length})</div>
        {mySessions.length===0
          ?<div style={{color:"#555",fontSize:13}}>No sessions in this period.</div>
          :mySessions.map(td=>(
            <div key={td.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
              <span>{td.date}</span><span style={{color:"#C8A04A"}}>+1 pt · {td.durationHours}h</span>
            </div>
          ))
        }
      </Card>

      {/* Events */}
      <Card>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Events Attended ({myEvents.length})</div>
        {myEvents.length===0
          ?<div style={{color:"#555",fontSize:13}}>No events in this period.</div>
          :myEvents.map(ev=>{
            const p=ev.participants[profile.id];
            const h=parseFloat(p.hoursAttended||ev.hours||0);
            const placementPts=ev.isCompetition&&p.placement>=1&&p.placement<=4?PLACEMENT_PTS[p.placement-1]:0;
            return (
              <div key={ev.id} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontSize:14,fontWeight:600}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#888"}}>{ev.date}</div>
                <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,background:"rgba(74,222,128,0.15)",color:"#4ade80",padding:"2px 8px",borderRadius:6}}>+{h} attendance pts</span>
                  {p.placement&&<span style={{fontSize:12,background:"rgba(200,160,74,0.15)",color:"#C8A04A",padding:"2px 8px",borderRadius:6}}>🏅 {p.placement}{["st","nd","rd","th"][p.placement-1]} {p.category?`(${p.category})`:""} +{placementPts}pts</span>}
                </div>
                <div style={{fontSize:13,fontWeight:700,color:"#C8A04A",marginTop:4}}>Total: +{(h+placementPts).toFixed(0)} pts</div>
              </div>
            );
          })
        }
      </Card>

      {/* Rank Exam History */}
      <Card style={{marginTop:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>🥋 Rank Examination History</div>
        {(profile.rankHistory||[]).length===0
          ?<div style={{color:"#555",fontSize:13}}>No rank exams recorded yet.</div>
          :[...(profile.rankHistory||[])].sort((a,b)=>b.date?.localeCompare(a.date)).map((r,i)=>(
            <div key={i} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <span style={{fontSize:18,fontWeight:900,color:r.promoted?"#4ade80":"#f87171",marginRight:10}}>{r.code}</span>
                  <span style={{fontSize:13,color:"#aaa"}}>{r.beltTestedName}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,color:"#888"}}>{r.date}</div>
                  <div style={{fontSize:11,fontWeight:700,color:r.promoted?"#4ade80":"#f87171"}}>
                    {r.promoted?`✅ Promoted${r.levelsAdvanced>1?" (+2 levels)":""}`:"❌ Not promoted"}
                  </div>
                </div>
              </div>
              <div style={{fontSize:11,color:"#666",marginTop:4}}>
                {r.result==="S"?"Satisfactory — met requirements":"Exceeding — exceeded requirements"}
                {r.promoted && <span style={{color:"#4ade80",marginLeft:6}}>→ Advanced to {BELT_LEVELS[r.beltTested]?.name}</span>}
              </div>
            </div>
          ))
        }
      </Card>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsView({ profile, setProfile, authUser, db, showToast, isInstructor, dojoSettings, setDojoSettings }) {
  const [newEmail, setNewEmail] = useState(profile.email);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [geoStatus, setGeoStatus] = useState("");

  // Period management state
  const [semForm, setSemForm] = useState({ name:"", start:"", end:"" });
  const [yearlyForm, setYearlyForm] = useState({ name: dojoSettings?.yearlyName||"", start: dojoSettings?.yearlyStart||"" });
  const semesters = dojoSettings?.semesters || [];

  const saveEmail = async () => {
    if (!newEmail.trim()||!currentPass) { showToast("Email and current password required","error"); return; }
    if (newEmail.trim() === profile.email) { showToast("That is already your current email","error"); return; }
    setBusy(true);
    try {
      // Re-authenticate with current credentials first
      const cred = EmailAuthProvider.credential(authUser.email, currentPass);
      await reauthenticateWithCredential(authUser, cred);
      // Update Firebase Auth email (this updates login credentials)
      await updateEmail(authUser, newEmail.trim());
      // Update Firestore profile to match
      await updateDoc(doc(db,"users",profile.id), { email: newEmail.trim() });
      // Update local profile state
      setProfile(p=>({...p, email: newEmail.trim()}));
      showToast("✅ Email updated! Use your new email to log in next time.");
      setCurrentPass(""); setNewEmail(newEmail.trim());
    } catch(e) {
      if (e.code==="auth/wrong-password"||e.code==="auth/invalid-credential") showToast("Current password is incorrect","error");
      else if (e.code==="auth/email-already-in-use") showToast("That email is already in use by another account","error");
      else if (e.code==="auth/invalid-email") showToast("Invalid email address","error");
      else if (e.code==="auth/requires-recent-login") showToast("Session expired — please log out and log back in first","error");
      else showToast("Error: "+e.message,"error");
    }
    setBusy(false);
  };

  const savePassword = async () => {
    if (!currentPass||!newPass) { showToast("Both fields required","error"); return; }
    if (newPass.length<6) { showToast("Password must be 6+ characters","error"); return; }
    setBusy(true);
    try {
      const cred=EmailAuthProvider.credential(authUser.email,currentPass);
      await reauthenticateWithCredential(authUser,cred);
      await updatePassword(authUser,newPass);
      showToast("Password updated!"); setCurrentPass(""); setNewPass("");
    } catch(e) { showToast(e.code==="auth/wrong-password"?"Current password incorrect":"Error: "+e.message,"error"); }
    setBusy(false);
  };

  const setDojoLocation = () => {
    setGeoStatus("getting");
    navigator.geolocation.getCurrentPosition(async pos=>{
      const lat=pos.coords.latitude, lng=pos.coords.longitude;
      await setDoc(doc(db,"settings","dojo"),{lat,lng,updatedAt:serverTimestamp()},{merge:true});
      setDojoSettings(s=>({...s,lat,lng}));
      setGeoStatus("saved");
      showToast(`✅ Dojo location set! (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
    }, ()=>{ setGeoStatus("error"); showToast("Could not get location","error"); });
  };

  const addSemester = async () => {
    if (!semForm.name||!semForm.start||!semForm.end) { showToast("All semester fields required","error"); return; }
    if (semForm.start >= semForm.end) { showToast("End date must be after start date","error"); return; }
    const updated = [...semesters, { name:semForm.name, start:semForm.start, end:semForm.end }];
    await setDoc(doc(db,"settings","dojo"),{semesters:updated},{merge:true});
    setDojoSettings(s=>({...s,semesters:updated}));
    setSemForm({name:"",start:"",end:""});
    showToast("Semester added!");
  };

  const deleteSemester = async i => {
    const updated = semesters.filter((_,idx)=>idx!==i);
    await setDoc(doc(db,"settings","dojo"),{semesters:updated},{merge:true});
    setDojoSettings(s=>({...s,semesters:updated}));
    showToast("Semester removed");
  };

  const saveYearly = async () => {
    if (!yearlyForm.start) { showToast("Start date required","error"); return; }
    await setDoc(doc(db,"settings","dojo"),{yearlyName:yearlyForm.name||"Current Year",yearlyStart:yearlyForm.start},{merge:true});
    setDojoSettings(s=>({...s,yearlyName:yearlyForm.name||"Current Year",yearlyStart:yearlyForm.start}));
    showToast("Yearly period saved!");
  };

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Settings</h2>

      {isInstructor && (<>
        {/* Dojo Location */}
        <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.3)"}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>📍 Dojo Location (Check-In)</div>
          {dojoSettings?.lat
            ?<InfoBox type="success">Location set: {dojoSettings.lat.toFixed(5)}, {dojoSettings.lng.toFixed(5)}</InfoBox>
            :<InfoBox type="warn">No location set — students cannot check in until configured.</InfoBox>}
          <Btn onClick={setDojoLocation} disabled={geoStatus==="getting"} style={{width:"100%"}}>
            {geoStatus==="getting"?"📡 Getting location…":dojoSettings?.lat?"🔄 Update Location":"📍 Set Dojo Location"}
          </Btn>
        </Card>

        {/* Yearly Period */}
        <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.3)"}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>📆 Yearly Period</div>
          {dojoSettings?.yearlyStart && (
            <InfoBox type="success">
              {dojoSettings.yearlyName||"Current Year"}: {dojoSettings.yearlyStart} → {getYearlyRange(dojoSettings)?.end}
            </InfoBox>
          )}
          <FInput label="Period Name (e.g. 2024-2025)" value={yearlyForm.name} onChange={e=>setYearlyForm(f=>({...f,name:e.target.value}))} placeholder="2024-2025 Academic Year" />
          <FInput label="Start Date" type="date" value={yearlyForm.start} onChange={e=>setYearlyForm(f=>({...f,start:e.target.value}))} />
          {yearlyForm.start && <div style={{fontSize:12,color:"#888",marginBottom:10}}>Period: {yearlyForm.start} → {(() => { const d=new Date(yearlyForm.start); d.setFullYear(d.getFullYear()+1); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; })()}</div>}
          <Btn onClick={saveYearly} style={{width:"100%"}}>Save Yearly Period</Btn>
        </Card>

        {/* Semesters */}
        <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.3)"}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>🗓️ Semesters</div>
          {semesters.length===0
            ?<div style={{color:"#555",fontSize:13,marginBottom:12}}>No semesters added yet.</div>
            :semesters.map((s,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{s.name}</div>
                  <div style={{fontSize:11,color:"#888"}}>{s.start} → {s.end}</div>
                </div>
                <button onClick={()=>deleteSemester(i)} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"3px 10px",cursor:"pointer",fontSize:12}}>✕</button>
              </div>
            ))
          }
          <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:12,color:"#C8A04A",fontWeight:600,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.08em"}}>Add Semester</div>
            <FInput label="Semester Name" value={semForm.name} onChange={e=>setSemForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Fall 2025" />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <FInput label="Start Date" type="date" value={semForm.start} onChange={e=>setSemForm(f=>({...f,start:e.target.value}))} />
              <FInput label="End Date" type="date" value={semForm.end} onChange={e=>setSemForm(f=>({...f,end:e.target.value}))} />
            </div>
            <Btn onClick={addSemester} style={{width:"100%"}}>+ Add Semester</Btn>
          </div>
        </Card>
      </>)}

      {/* Account settings */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>Change Email</div>
        <FInput label="New Email" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} />
        <FInput label="Current Password (to confirm)" type="password" value={currentPass} onChange={e=>setCurrentPass(e.target.value)} />
        <Btn onClick={saveEmail} disabled={busy} style={{width:"100%"}}>{busy?"Updating…":"Update Email"}</Btn>
      </Card>

      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>Change Password</div>
        <FInput label="Current Password" type="password" value={currentPass} onChange={e=>setCurrentPass(e.target.value)} />
        <FInput label="New Password" type="password" value={newPass} onChange={e=>setNewPass(e.target.value)} />
        <Btn onClick={savePassword} disabled={busy} style={{width:"100%"}}>{busy?"Updating…":"Update Password"}</Btn>
      </Card>

      <Card style={{background:"rgba(0,0,0,0.3)"}}>
        <div style={{fontSize:13,color:"#555"}}>Logged in as: <span style={{color:"#aaa"}}>{profile.email}</span></div>
        <div style={{fontSize:13,color:"#555",marginTop:4}}>Role: <span style={{color:profile.role==="instructor"?"#C8A04A":"#aaa",textTransform:"capitalize"}}>{profile.role}</span></div>
        <div style={{fontSize:13,color:"#555",marginTop:4}}>Member since: <span style={{color:"#aaa"}}>{profile.joinDate}</span></div>
      </Card>

      <div style={{textAlign:"center",marginTop:24,paddingBottom:8}}>
        <div style={{fontSize:11,color:"#333",letterSpacing:"0.1em",textTransform:"uppercase"}}>{DOJO_NAME}</div>
        <div style={{fontSize:12,color:"#444",marginTop:4}}>Version {APP_VERSION}</div>
      </div>
    </div>
  );
}
