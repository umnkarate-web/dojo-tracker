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
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

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

const PLACEMENT_PTS = [5, 3, 2, 1];
const DOJO_NAME = "Traditional Karatedo Academy at UMN";

// ─── Geo helpers ──────────────────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function calcStats(userId, trainingDays, events) {
  const myTd = (trainingDays || []).filter(td => td.attendees?.includes(userId));
  const trainingHours = myTd.reduce((s, td) => s + (td.durationHours || 1.5), 0);
  const trainingPoints = myTd.length;
  let eventPoints = 0, eventHours = 0;
  (events || []).forEach(ev => {
    const p = ev.participants?.[userId];
    if (!p?.attended) return;
    const h = (ev.hoursPerDay || 2) * (ev.days || 1);
    if (h >= 2) { eventPoints += h; eventHours += h; }
    if (ev.isCompetition && p.placement >= 1 && p.placement <= 4)
      eventPoints += PLACEMENT_PTS[p.placement - 1];
  });
  return { trainingHours, trainingPoints, eventPoints, eventHours, totalPoints: trainingPoints + eventPoints };
}

function getBeltProgress(beltIndex, joinDate, beltAchievedDate, stats) {
  const next = BELT_LEVELS[beltIndex + 1];
  if (!next) return { next: null, progress: 100 };
  if (next.yearsRequired) {
    const from = new Date(beltAchievedDate || joinDate);
    const years = (Date.now() - from) / (1000*60*60*24*365.25);
    return { next, isYearBased: true, years, yearsRequired: next.yearsRequired, progress: Math.min(100, (years/next.yearsRequired)*100) };
  }
  return { next, isYearBased: false, hoursNeeded: next.hoursRequired, progress: Math.min(100, (stats.trainingHours/next.hoursRequired)*100) };
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
    : [{id:"dashboard",label:"Dashboard",icon:"⛩️"},{id:"checkin",label:"Check-In",icon:"✅"},{id:"myrecord",label:"My Record",icon:"📋"},{id:"settings",label:"Settings",icon:"⚙️"}];

  const shared = { profile, trainingDays, setTrainingDays, events, setEvents, students, setStudents, showToast, db, auth, isInstructor, loadData, dojoSettings, setDojoSettings };

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
          <button key={n.id} onClick={()=>setView(n.id)} style={{background:"none",border:"none",color:view===n.id?"#C8A04A":"#555",display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",padding:"4px 6px"}}>
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

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardView({ profile, trainingDays, events, students, isInstructor }) {
  const stats = calcStats(profile.id, trainingDays, events);
  const beltInfo = getBeltProgress(profile.beltIndex||0, profile.joinDate, profile.beltAchievedDate, stats);
  const today = new Date().toISOString().split("T")[0];
  const todaySession = trainingDays.find(td=>td.date===today);

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>{isInstructor?"Dojo Overview":"My Dashboard"}</h2>

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

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        {[["Sessions",trainingDays.filter(td=>td.attendees?.includes(profile.id)).length],["Hours",stats.trainingHours.toFixed(1)],["Points",stats.totalPoints.toFixed(0)]].map(([l,v])=>(
          <Card key={l} style={{textAlign:"center",padding:14}}><div style={{fontSize:20,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:10,color:"#888",marginTop:2}}>{l}</div></Card>
        ))}
      </div>

      <Card style={{marginBottom:14}}>
        <div style={{fontSize:12,color:"#888",marginBottom:6}}>📅 Today — {today}</div>
        {todaySession?<div><span style={{color:"#4ade80",fontWeight:700}}>✅ Session active</span><span style={{fontSize:12,color:"#aaa",marginLeft:8}}>{todaySession.attendees?.length||0} checked in</span></div>:<div style={{color:"#555",fontSize:13}}>No session recorded yet.</div>}
      </Card>

      {isInstructor && (
        <Card>
          <div style={{fontWeight:700,marginBottom:12,color:"#C8A04A"}}>🏅 Top Students</div>
          {[...students].sort((a,b)=>calcStats(b.id,trainingDays,events).totalPoints-calcStats(a.id,trainingDays,events).totalPoints).slice(0,5).map((s,i)=>{
            const st=calcStats(s.id,trainingDays,events);
            return (
              <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<4?"1px solid rgba(255,255,255,0.06)":"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{color:["#FFD700","#C0C0C0","#CD7F32","#888","#888"][i],fontWeight:700,width:20}}>#{i+1}</span>
                  <div><div style={{fontSize:13,fontWeight:600}}>{s.name}</div><BeltBadge beltIndex={s.beltIndex||0} /></div>
                </div>
                <div style={{textAlign:"right"}}><div style={{color:"#C8A04A",fontWeight:800}}>{st.totalPoints.toFixed(0)} pts</div><div style={{fontSize:11,color:"#666"}}>{st.trainingHours.toFixed(1)}h</div></div>
              </div>
            );
          })}
          {students.length===0 && <div style={{color:"#555",fontSize:13}}>No students yet.</div>}
        </Card>
      )}
    </div>
  );
}

// ─── Check-In ─────────────────────────────────────────────────────────────────
function CheckInView({ profile, trainingDays, setTrainingDays, students, showToast, db, isInstructor, dojoSettings }) {
  const today = new Date().toISOString().split("T")[0];
  const [geoStatus, setGeoStatus] = useState("idle"); // idle | checking | ok | blocked | noGeo
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
            {geoStatus==="noGeo" && <InfoBox type="warn">⚠️ Dojo location not set yet. Contact your instructor.</InfoBox>}
          </>
        )}

        {alreadyIn && <InfoBox type="success">✅ Already checked in for today!</InfoBox>}

        <Btn onClick={handleCheckIn} disabled={busy||alreadyIn||!canCheckIn} style={{width:"100%"}}>
          {busy?"Checking in…":"Check In"}
        </Btn>
      </Card>

      <Card>
        <div style={{fontWeight:700,marginBottom:10,color:"#C8A04A"}}>Today's Attendance ({checkedIn.length})</div>
        {checkedIn.length===0?<div style={{color:"#555",fontSize:13}}>No one checked in yet.</div>:checkedIn.map(u=>(
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
  const allUsers = [...students, profile];
  const filtered = filterMonth ? trainingDays.filter(td=>td.date?.startsWith(filterMonth)) : trainingDays;

  const removeAttendee = async (tdId, userId) => {
    const td = trainingDays.find(t=>t.id===tdId);
    const updated = (td.attendees||[]).filter(a=>a!==userId);
    await updateDoc(doc(db,"trainingDays",tdId),{attendees:updated});
    setTrainingDays(prev=>prev.map(t=>t.id===tdId?{...t,attendees:updated}:t));
    showToast("Removed attendee");
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
      {filtered.map(td=>{
        const attendees=(td.attendees||[]).map(id=>allUsers.find(u=>u.id===id)).filter(Boolean);
        return (
          <Card key={td.id} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div><div style={{fontWeight:800}}>{td.date}</div><div style={{fontSize:12,color:"#888"}}>{attendees.length} attendees · {td.durationHours}h</div></div>
              {isInstructor && <div style={{display:"flex",gap:6}}>
                <Btn variant="ghost" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setEditId(editId===td.id?null:td.id)}>Edit</Btn>
                <Btn variant="danger" style={{padding:"4px 10px",fontSize:11}} onClick={()=>deleteSession(td.id)}>Del</Btn>
              </div>}
            </div>
            {attendees.map(u=>(
              <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                <span style={{fontSize:13}}>{u.name}</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <BeltBadge beltIndex={u.beltIndex||0} />
                  {isInstructor&&editId===td.id&&<button onClick={()=>removeAttendee(td.id,u.id)} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
      {filtered.length===0&&<div style={{color:"#555",textAlign:"center",marginTop:40}}>No sessions found.</div>}
    </div>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────
function EventsView({ events, setEvents, students, profile, isInstructor, showToast, db }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({name:"",date:"",hoursPerDay:2,days:1,isCompetition:false});
  const [participantModal, setParticipantModal] = useState(null);
  const [csvModal, setCsvModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const addEvent = async () => {
    if (!form.name||!form.date) { showToast("Name and date required","error"); return; }
    setBusy(true);
    try {
      const id=`ev_${Date.now()}`;
      const ev={name:form.name,date:form.date,hoursPerDay:Number(form.hoursPerDay),days:Number(form.days),isCompetition:form.isCompetition,participants:{},createdAt:serverTimestamp()};
      await setDoc(doc(db,"events",id),ev);
      setEvents(prev=>[{id,...ev},...prev]);
      setForm({name:"",date:"",hoursPerDay:2,days:1,isCompetition:false});
      setShowAdd(false);
      showToast("Event added!");
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  const deleteEvent = async id => {
    if (!window.confirm("Delete this event?")) return;
    await deleteDoc(doc(db,"events",id));
    setEvents(prev=>prev.filter(e=>e.id!==id));
    showToast("Event deleted");
  };

  const updateParticipants = async (evId, participants) => {
    await updateDoc(doc(db,"events",evId),{participants});
    setEvents(prev=>prev.map(e=>e.id===evId?{...e,participants}:e));
    if (participantModal?.id===evId) setParticipantModal(pm=>({...pm,participants}));
  };

  const handleCSVUpload = async (evId, csvText) => {
    const rows = parseCSV(csvText);
    const ev = events.find(e=>e.id===evId);
    const participants = {...(ev.participants||{})};
    let matched=0, notFound=[];
    rows.forEach(row => {
      const email = row.email?.toLowerCase();
      const student = students.find(s=>s.email?.toLowerCase()===email);
      if (!student) { notFound.push(email); return; }
      matched++;
      participants[student.id] = {
        attended: true,
        hoursAttended: parseFloat(row.hoursattended||row.hours||ev.hoursPerDay)||ev.hoursPerDay,
        placement: parseInt(row.placement)||null,
      };
    });
    await updateParticipants(evId, participants);
    showToast(`✅ Imported ${matched} students${notFound.length?`. Not found: ${notFound.join(", ")}`:""}`, matched>0?"success":"error");
    setCsvModal(null);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Events</h2>
        {isInstructor && <Btn onClick={()=>setShowAdd(true)}>+ Add Event</Btn>}
      </div>

      {showAdd && (
        <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.4)"}}>
          <div style={{fontWeight:700,marginBottom:12,color:"#C8A04A"}}>New Event</div>
          <FInput label="Event Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Fall Shiai Tournament" />
          <FInput label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <FInput label="Hours/Day" type="number" value={form.hoursPerDay} onChange={e=>setForm(f=>({...f,hoursPerDay:e.target.value}))} min="1" />
            <FInput label="Days" type="number" value={form.days} onChange={e=>setForm(f=>({...f,days:e.target.value}))} min="1" />
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <input type="checkbox" checked={form.isCompetition} onChange={e=>setForm(f=>({...f,isCompetition:e.target.checked}))} id="isComp" style={{width:16,height:16,accentColor:"#C8A04A"}} />
            <label htmlFor="isComp" style={{color:"#C8A04A",fontSize:14}}>Competition (placement points)</label>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={addEvent} disabled={busy} style={{flex:1}}>{busy?"Saving…":"Save"}</Btn>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)} style={{flex:1}}>Cancel</Btn>
          </div>
        </Card>
      )}

      {events.map(ev=>{
        const totalHours=ev.hoursPerDay*ev.days;
        const count=Object.values(ev.participants||{}).filter(p=>p.attended).length;
        const myStatus=ev.participants?.[profile.id];
        return (
          <Card key={ev.id} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div>
                <div style={{fontWeight:800}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#888"}}>{ev.date} · {totalHours}h{ev.isCompetition?" 🏆":""}</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                <span style={{fontSize:12,color:"#aaa"}}>{count} attended</span>
                {isInstructor && <div style={{display:"flex",gap:4}}>
                  <Btn variant="ghost" style={{padding:"2px 8px",fontSize:10}} onClick={()=>setParticipantModal(ev)}>Manage</Btn>
                  <Btn variant="green" style={{padding:"2px 8px",fontSize:10}} onClick={()=>setCsvModal(ev)}>CSV</Btn>
                  <Btn variant="danger" style={{padding:"2px 8px",fontSize:10}} onClick={()=>deleteEvent(ev.id)}>Del</Btn>
                </div>}
              </div>
            </div>
            {totalHours>=2&&<div style={{fontSize:12,color:"#4ade80",marginBottom:6}}>+{totalHours} pts participation{ev.isCompetition?" + placement bonus":""}</div>}
            {!isInstructor&&(myStatus?.attended
              ?<div style={{color:"#4ade80",fontSize:13}}>✅ You attended · {myStatus.hoursAttended||totalHours}h{myStatus.placement?` · ${myStatus.placement}${["st","nd","rd","th"][myStatus.placement-1]||"th"} place 🏅`:""}</div>
              :<div style={{color:"#555",fontSize:13}}>You did not attend.</div>
            )}
          </Card>
        );
      })}

      {/* Manage Participants Modal */}
      {participantModal && (
        <Modal title={`Participants: ${participantModal.name}`} onClose={()=>setParticipantModal(null)}>
          {students.map(u=>{
            const ev=events.find(e=>e.id===participantModal.id);
            const p=ev?.participants?.[u.id];
            const toggle=()=>{ const np={...(ev.participants||{})}; if(p?.attended){delete np[u.id];}else{np[u.id]={attended:true,hoursAttended:ev.hoursPerDay*ev.days,placement:null};} updateParticipants(participantModal.id,np); };
            return (
              <div key={u.id} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:p?.attended?6:0}}>
                  <span style={{fontSize:14,fontWeight:600}}>{u.name}</span>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <BeltBadge beltIndex={u.beltIndex||0} />
                    <input type="checkbox" checked={!!p?.attended} onChange={toggle} style={{width:16,height:16,accentColor:"#C8A04A"}} />
                  </div>
                </div>
                {p?.attended && <>
                  <FInput label="Hours Attended" type="number" value={p.hoursAttended||""} onChange={e=>{ const np={...(ev.participants||{}),[u.id]:{...p,hoursAttended:parseFloat(e.target.value)||0}}; updateParticipants(participantModal.id,np); }} style={{marginBottom:6}} />
                  {ev?.isCompetition && (
                    <FSelect value={p.placement||""} onChange={e=>{ const np={...(ev.participants||{}),[u.id]:{...p,placement:parseInt(e.target.value)||null}}; updateParticipants(participantModal.id,np); }} style={{marginBottom:0}}>
                      <option value="">No placement</option>
                      <option value="1">1st (+5 pts)</option>
                      <option value="2">2nd (+3 pts)</option>
                      <option value="3">3rd (+2 pts)</option>
                      <option value="4">4th (+1 pt)</option>
                    </FSelect>
                  )}
                </>}
              </div>
            );
          })}
        </Modal>
      )}

      {/* CSV Upload Modal */}
      {csvModal && <CSVEventModal event={csvModal} onUpload={handleCSVUpload} onClose={()=>setCsvModal(null)} />}
    </div>
  );
}

function CSVEventModal({ event, onUpload, onClose }) {
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  const handleFile = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsvText(ev.target.result);
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    await onUpload(event.id, csvText);
    setBusy(false);
  };

  return (
    <Modal title={`CSV Import: ${event.name}`} onClose={onClose}>
      <InfoBox type="info">
        Upload a CSV file with columns:<br/>
        <code style={{fontSize:12}}>email, hoursAttended, placement</code><br/>
        Placement is optional (1–4 for competition).
      </InfoBox>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Upload CSV File</label>
        <input type="file" accept=".csv" onChange={handleFile} style={{color:"#fff",fontSize:13}} />
      </div>
      {csvText && (
        <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:14,fontSize:11,color:"#888",maxHeight:120,overflowY:"auto",fontFamily:"monospace"}}>
          {csvText.slice(0,400)}{csvText.length>400?"…":""}
        </div>
      )}
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={handleSubmit} disabled={busy||!csvText} style={{flex:1}}>{busy?"Importing…":"Import"}</Btn>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── Students ─────────────────────────────────────────────────────────────────
function StudentsView({ students, setStudents, trainingDays, events, showToast, db }) {
  const [view, setView] = useState("list"); // list | add | edit | detail | csv
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({name:"",email:"",beltIndex:0,joinDate:new Date().toISOString().split("T")[0],beltAchievedDate:new Date().toISOString().split("T")[0]});
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  const createStudent = async () => {
    if (!form.name.trim()||!form.email.trim()) { showToast("Name and email required","error"); return; }
    setBusy(true);
    try {
      const tempPass = "Welcome@"+Math.floor(1000+Math.random()*9000);
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), tempPass);
      const uid = cred.user.uid;
      const profile = {name:form.name.trim(),email:form.email.trim(),role:"student",beltIndex:Number(form.beltIndex),joinDate:form.joinDate,beltAchievedDate:form.beltAchievedDate,createdAt:serverTimestamp()};
      await setDoc(doc(db,"users",uid),profile);
      await sendPasswordResetEmail(auth, form.email.trim());
      setStudents(prev=>[...prev,{id:uid,...profile}]);
      showToast(`✅ ${form.name} added! Password reset email sent.`);
      setForm({name:"",email:"",beltIndex:0,joinDate:new Date().toISOString().split("T")[0],beltAchievedDate:new Date().toISOString().split("T")[0]});
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
    const today=new Date().toISOString().split("T")[0];
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
        const cred=await createUserWithEmailAndPassword(auth,row.email.trim(),tempPass);
        const uid=cred.user.uid;
        const p={name:row.name.trim(),email:row.email.trim(),role:"student",beltIndex:parseInt(row.beltindex||row.beltIndex||0)||0,joinDate:row.joindate||row.joinDate||new Date().toISOString().split("T")[0],beltAchievedDate:row.beltachieveddate||row.beltAchievedDate||row.joindate||new Date().toISOString().split("T")[0],createdAt:serverTimestamp()};
        await setDoc(doc(db,"users",uid),p);
        await sendPasswordResetEmail(auth,row.email.trim());
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
          {BELT_LEVELS.map((b,i)=><option key={i} value={i}>{b.kyu} — {b.name}</option>)}
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
    const s=students.find(u=>u.id===selected.id)||selected;
    const stats=calcStats(s.id,trainingDays,events);
    const bi=getBeltProgress(s.beltIndex||0,s.joinDate,s.beltAchievedDate,stats);
    const sessions=trainingDays.filter(td=>td.attendees?.includes(s.id));
    const myEvents=events.filter(ev=>ev.participants?.[s.id]?.attended);
    return (
      <div>
        <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← All Students</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{s.name}</h2>
          <Btn variant="ghost" onClick={()=>{setSelected(s);setView("edit");}} style={{fontSize:12,padding:"6px 14px"}}>Edit</Btn>
        </div>
        <Card style={{marginBottom:12,background:"linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.3)"}}>
          <BeltBadge beltIndex={s.beltIndex||0} size="lg" />
          {s.beltAchievedDate&&<div style={{fontSize:11,color:"#888",marginTop:4}}>Achieved: {s.beltAchievedDate}</div>}
          <div style={{marginTop:12}}>
            <ProgressBar percent={bi.progress} />
            <div style={{fontSize:12,color:"#aaa",marginTop:6}}>{bi.isYearBased?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} years`:`${stats.trainingHours.toFixed(1)} / ${bi.hoursNeeded}h → ${bi.next?.name||"next level"}`}</div>
          </div>
          {bi.progress>=100&&bi.next&&<Btn onClick={()=>promoteStudent(s)} style={{marginTop:12,width:"100%"}}>🥋 Promote to {bi.next.name}</Btn>}
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
          {[["Sessions",sessions.length],["Hours",stats.trainingHours.toFixed(1)],["Points",stats.totalPoints.toFixed(0)]].map(([l,v])=>(
            <Card key={l} style={{textAlign:"center",padding:12}}><div style={{fontSize:20,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:10,color:"#888"}}>{l}</div></Card>
          ))}
        </div>
        <Card style={{marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Training Sessions</div>
          {sessions.slice(0,15).map(td=>(
            <div key={td.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
              <span>{td.date}</span><span style={{color:"#C8A04A"}}>{td.durationHours}h</span>
            </div>
          ))}
          {sessions.length===0&&<div style={{color:"#555",fontSize:13}}>No sessions yet.</div>}
        </Card>
        <Card>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Events</div>
          {myEvents.map(ev=>{
            const p=ev.participants[s.id];
            const h=p.hoursAttended||ev.hoursPerDay*ev.days;
            const pts=h+(ev.isCompetition&&p.placement?PLACEMENT_PTS[p.placement-1]:0);
            return (
              <div key={ev.id} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontSize:14,fontWeight:600}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#888"}}>{ev.date} · {h}h attended</div>
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

  // ── Edit view
  if (view==="edit" && selected) return (
    <div>
      <button onClick={()=>setView("detail")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Edit Student</h2>
      <Card>
        <FInput label="Full Name" value={selected.name} onChange={e=>setSelected(s=>({...s,name:e.target.value}))} />
        <FInput label="Email" value={selected.email} onChange={e=>setSelected(s=>({...s,email:e.target.value}))} />
        <FSelect label="Belt Level" value={selected.beltIndex} onChange={e=>setSelected(s=>({...s,beltIndex:e.target.value}))}>
          {BELT_LEVELS.map((b,i)=><option key={i} value={i}>{b.kyu} — {b.name}</option>)}
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
function MyRecordView({ profile, trainingDays, events }) {
  const stats=calcStats(profile.id,trainingDays,events);
  const bi=getBeltProgress(profile.beltIndex||0,profile.joinDate,profile.beltAchievedDate,stats);
  const sessions=trainingDays.filter(td=>td.attendees?.includes(profile.id));
  const myEvents=events.filter(ev=>ev.participants?.[profile.id]?.attended);

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>My Record</h2>
      <Card style={{marginBottom:14,background:"linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.3)"}}>
        <BeltBadge beltIndex={profile.beltIndex||0} size="lg" />
        {profile.beltAchievedDate&&<div style={{fontSize:11,color:"#888",marginTop:4}}>Achieved: {profile.beltAchievedDate}</div>}
        <div style={{marginTop:14}}>
          {bi.next?(<>
            <div style={{fontSize:13,color:"#aaa",marginBottom:8}}>Progress to {bi.next.name}</div>
            <ProgressBar percent={bi.progress} />
            <div style={{fontSize:12,color:"#888",marginTop:6}}>{bi.isYearBased?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} years since last promotion`:`${stats.trainingHours.toFixed(1)} of ${bi.hoursNeeded} hours`}</div>
          </>):<div style={{color:"#C8A04A",fontWeight:700,marginTop:8}}>🏆 Highest Rank Achieved!</div>}
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {[["Training Sessions",sessions.length,"📅"],["Training Hours",stats.trainingHours.toFixed(1)+"h","⏱️"],["Event Points",stats.eventPoints.toFixed(0),"🏆"],["Total Points",stats.totalPoints.toFixed(0),"⭐"]].map(([l,v,ic])=>(
          <Card key={l} style={{textAlign:"center"}}><div style={{fontSize:28}}>{ic}</div><div style={{fontSize:22,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:11,color:"#777"}}>{l}</div></Card>
        ))}
      </div>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Training Sessions ({sessions.length})</div>
        {sessions.map(td=>(
          <div key={td.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
            <span>{td.date}</span><span style={{color:"#C8A04A"}}>+{td.durationHours}h</span>
          </div>
        ))}
        {sessions.length===0&&<div style={{color:"#555",fontSize:13}}>No sessions yet.</div>}
      </Card>
      <Card>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Events Attended</div>
        {myEvents.map(ev=>{
          const p=ev.participants[profile.id];
          const h=p.hoursAttended||(ev.hoursPerDay*ev.days);
          const pts=h+(ev.isCompetition&&p.placement?PLACEMENT_PTS[p.placement-1]:0);
          return (
            <div key={ev.id} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:14,fontWeight:600}}>{ev.name}</div>
              <div style={{fontSize:12,color:"#888"}}>{ev.date} · {h}h attended</div>
              {p.placement&&<div style={{fontSize:12,color:"#C8A04A"}}>🏅 {p.placement}{["st","nd","rd","th"][p.placement-1]||"th"} place</div>}
              <div style={{fontSize:12,color:"#4ade80"}}>+{pts.toFixed(0)} pts</div>
            </div>
          );
        })}
        {myEvents.length===0&&<div style={{color:"#555",fontSize:13}}>No events attended yet.</div>}
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

  const saveEmail = async () => {
    if (!newEmail.trim()||!currentPass) { showToast("Email and current password required","error"); return; }
    setBusy(true);
    try {
      const cred=EmailAuthProvider.credential(authUser.email,currentPass);
      await reauthenticateWithCredential(authUser,cred);
      await updateEmail(authUser,newEmail.trim());
      await updateDoc(doc(db,"users",profile.id),{email:newEmail.trim()});
      setProfile(p=>({...p,email:newEmail.trim()}));
      showToast("Email updated!"); setCurrentPass("");
    } catch(e) { showToast(e.code==="auth/wrong-password"?"Current password incorrect":"Error: "+e.message,"error"); }
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

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Settings</h2>

      {isInstructor && (
        <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.3)"}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>📍 Dojo Location (for Check-In)</div>
          {dojoSettings?.lat
            ?<InfoBox type="success">Location set: {dojoSettings.lat.toFixed(5)}, {dojoSettings.lng.toFixed(5)}</InfoBox>
            :<InfoBox type="warn">No location set yet. Students cannot check in until this is configured.</InfoBox>
          }
          <p style={{fontSize:13,color:"#aaa",marginBottom:12}}>Stand at your dojo and tap the button below to set the check-in location. Students must be within 100 meters to check in.</p>
          <Btn onClick={setDojoLocation} disabled={geoStatus==="getting"} style={{width:"100%"}}>
            {geoStatus==="getting"?"📡 Getting location…":dojoSettings?.lat?"🔄 Update Dojo Location":"📍 Set Dojo Location Now"}
          </Btn>
        </Card>
      )}

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
    </div>
  );
}
