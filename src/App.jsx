import { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  updateEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

// ─── Firebase Init ────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDuxhxICq6_5Jd8I3m4fQD7Mwg2X_pHxtI",
  authDomain: "dojo-tracker-d4331.firebaseapp.com",
  projectId: "dojo-tracker-d4331",
  storageBucket: "dojo-tracker-d4331.firebasestorage.app",
  messagingSenderId: "603515048412",
  appId: "1:603515048412:web:5d78bd44434e20d7b3ff19",
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ─── Belt System ──────────────────────────────────────────────────────────────
const BELT_LEVELS = [
  { kyu: "10th Kyu", name: "White Belt", color: "#e8e8e8", textColor: "#333", hoursRequired: 0, yearsRequired: null },
  { kyu: "8th Kyu", name: "Orange Belt", color: "#FF8C00", textColor: "#fff", hoursRequired: 18, yearsRequired: null },
  { kyu: "7th Kyu", name: "Red Belt", color: "#CC0000", textColor: "#fff", hoursRequired: 18, yearsRequired: null },
  { kyu: "6th Kyu", name: "Green Belt", color: "#228B22", textColor: "#fff", hoursRequired: 20, yearsRequired: null },
  { kyu: "5th Kyu", name: "Purple Belt", color: "#6B21A8", textColor: "#fff", hoursRequired: 22, yearsRequired: null },
  { kyu: "4th Kyu", name: "Purple Belt II", color: "#7C3AED", textColor: "#fff", hoursRequired: 24, yearsRequired: null },
  { kyu: "3rd Kyu", name: "Brown Belt", color: "#92400E", textColor: "#fff", hoursRequired: 28, yearsRequired: null },
  { kyu: "2nd Kyu", name: "Brown Belt II", color: "#78350F", textColor: "#fff", hoursRequired: 36, yearsRequired: null },
  { kyu: "1st Kyu", name: "Brown Belt III", color: "#6B3A2A", textColor: "#fff", hoursRequired: 40, yearsRequired: null },
  { kyu: "Shodan", name: "Black Belt 1st Dan", color: "#111111", textColor: "#FFD700", hoursRequired: 50, yearsRequired: null },
  { kyu: "Nidan", name: "Black Belt 2nd Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 3 },
  { kyu: "Sandan", name: "Black Belt 3rd Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 4 },
  { kyu: "Yondan", name: "Black Belt 4th Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 5 },
  { kyu: "Godan", name: "Black Belt 5th Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 6 },
  { kyu: "Rokudan", name: "Black Belt 6th Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 7 },
  { kyu: "Shichidan", name: "Black Belt 7th Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 8 },
  { kyu: "Hachidan", name: "Black Belt 8th Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 9 },
  { kyu: "Kudan", name: "Black Belt 9th Dan", color: "#111111", textColor: "#FFD700", hoursRequired: null, yearsRequired: 10 },
];


const PLACEMENT_POINTS = [5, 3, 2, 1];

function calcStudentStats(userId, trainingDays, events) {
  const myTraining = trainingDays.filter(td => td.attendees?.includes(userId));
  const trainingHours = myTraining.reduce((s, td) => s + (td.durationHours || 1.5), 0);
  const trainingPoints = myTraining.length;
  let eventPoints = 0, eventHours = 0;
  (events || []).forEach(ev => {
    const p = ev.participants?.[userId];
    if (!p?.attended) return;
    const total = (ev.hoursPerDay || 2) * (ev.days || 1);
    if (total >= 2) { eventPoints += total; eventHours += total; }
    if (ev.isCompetition && p.placement >= 1 && p.placement <= 4)
      eventPoints += PLACEMENT_POINTS[p.placement - 1];
  });
  return { trainingHours, trainingPoints, eventPoints, eventHours, totalPoints: trainingPoints + eventPoints, totalHours: trainingHours + eventHours };
}

function getNextBeltInfo(beltIndex, joinDate, stats) {
  const next = BELT_LEVELS[beltIndex + 1];
  if (!next) return { next: null, progress: 100 };
  if (next.yearsRequired) {
    const years = (Date.now() - new Date(joinDate)) / (1000 * 60 * 60 * 24 * 365.25);
    return { next, isYearBased: true, yearsTraining: years, yearsRequired: next.yearsRequired, progress: Math.min(100, (years / next.yearsRequired) * 100) };
  }
  return { next, isYearBased: false, hoursNeeded: next.hoursRequired, progress: Math.min(100, (stats.trainingHours / next.hoursRequired) * 100) };
}

// ─── Firestore Helpers ────────────────────────────────────────────────────────
async function fetchCollection(col) {
  const snap = await getDocs(collection(db, col));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function BeltBadge({ beltIndex, size = "sm" }) {
  const b = BELT_LEVELS[beltIndex] || BELT_LEVELS[0];
  const sz = size === "lg" ? { padding: "6px 16px", fontSize: 14, borderRadius: 20 } : { padding: "2px 10px", fontSize: 11, borderRadius: 12 };
  return <span style={{ background: b.color, color: b.textColor, fontWeight: 700, letterSpacing: "0.04em", border: b.color === "#e8e8e8" ? "1px solid #ccc" : "none", ...sz }}>{b.name}</span>;
}

function ProgressBar({ percent, color = "#C8A04A" }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 8, height: 12, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, percent)}%`, background: `linear-gradient(90deg, ${color}, #fff8dc)`, height: "100%", borderRadius: 8, transition: "width 0.6s ease" }} />
    </div>
  );
}

function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 20, cursor: onClick ? "pointer" : "default", ...style }}>{children}</div>;
}

function FInput({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 12, color: "#C8A04A", marginBottom: 4, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>}
      <input {...props} style={{ width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "10px 14px", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", ...props.style }} />
    </div>
  );
}

function FSelect({ label, children, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 12, color: "#C8A04A", marginBottom: 4, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</label>}
      <select {...props} style={{ width: "100%", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "10px 14px", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", ...props.style }}>{children}</select>
    </div>
  );
}

function Btn({ children, variant = "primary", onClick, style, disabled }) {
  const base = { border: "none", borderRadius: 10, padding: "10px 20px", fontFamily: "inherit", fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontSize: 14, transition: "opacity 0.2s", opacity: disabled ? 0.5 : 1 };
  const variants = { primary: { background: "linear-gradient(135deg,#C8A04A,#E8C86A)", color: "#0a0a1a" }, danger: { background: "rgba(220,38,38,0.8)", color: "#fff" }, ghost: { background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" } };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#12122a", border: "1px solid rgba(200,160,74,0.3)", borderRadius: 20, padding: 24, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#C8A04A", fontSize: 18 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Spinner() {
  return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 40 }}><div style={{ width: 36, height: 36, border: "3px solid rgba(200,160,74,0.2)", borderTop: "3px solid #C8A04A", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function KarateApp() {
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [trainingDays, setTrainingDays] = useState([]);
  const [events, setEvents] = useState([]);
  const [students, setStudents] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    try {
      const [td, ev, st] = await Promise.all([
        fetchCollection("trainingDays"),
        fetchCollection("events"),
        fetchCollection("users"),
      ]);
      setTrainingDays(td.sort((a, b) => b.date?.localeCompare(a.date)));
      setEvents(ev.sort((a, b) => b.date?.localeCompare(a.date)));
      setStudents(st.filter(u => u.role === "student"));
      setDataLoaded(true);
    } catch (e) {
      showToast("Error loading data: " + e.message, "error");
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setAuthUser(user);
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          setUserProfile({ id: user.uid, ...snap.data() });
          await loadData();
        }
      } else {
        setAuthUser(null);
        setUserProfile(null);
        setDataLoaded(false);
      }
      setLoading(false);
    });
    return unsub;
  }, [loadData]);

  const handleLogout = async () => {
    await signOut(auth);
    setView("dashboard");
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a1a", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 60, marginBottom: 20 }}>⛩️</div>
      <Spinner />
    </div>
  );

  if (!authUser || !userProfile) return <LoginScreen db={db} auth={auth} onLogin={async (uid) => {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) { setUserProfile({ id: uid, ...snap.data() }); await loadData(); }
  }} showToast={showToast} toast={toast} />;

  const isInstructor = userProfile.role === "instructor";

  const navItems = isInstructor
    ? [{ id: "dashboard", label: "Dashboard", icon: "⛩️" }, { id: "checkin", label: "Check-In", icon: "✅" }, { id: "training", label: "Training", icon: "📅" }, { id: "events", label: "Events", icon: "🏆" }, { id: "students", label: "Students", icon: "👥" }, { id: "report", label: "Reports", icon: "📊" }, { id: "settings", label: "Settings", icon: "⚙️" }]
    : [{ id: "dashboard", label: "Dashboard", icon: "⛩️" }, { id: "checkin", label: "Check-In", icon: "✅" }, { id: "myrecord", label: "My Record", icon: "📋" }, { id: "settings", label: "Settings", icon: "⚙️" }];

  const sharedProps = { userProfile, trainingDays, setTrainingDays, events, setEvents, students, setStudents, showToast, db, auth, isInstructor, loadData };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0a0a1a 0%,#12122a 50%,#0d0d20 100%)", color: "#fff", fontFamily: "'Segoe UI',system-ui,sans-serif", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ background: "rgba(0,0,0,0.4)", borderBottom: "1px solid rgba(200,160,74,0.3)", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <div>
          <div style={{ fontSize: 10, color: "#C8A04A", letterSpacing: "0.15em", textTransform: "uppercase" }}>Dojo Tracker</div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>⛩️ {userProfile.name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BeltBadge beltIndex={userProfile.beltIndex || 0} />
          <button onClick={handleLogout} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#aaa", padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Logout</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "16px 16px 100px", overflowY: "auto" }}>
        {!dataLoaded ? <Spinner /> : (
          <>
            {view === "dashboard" && <DashboardView {...sharedProps} />}
            {view === "checkin" && <CheckInView {...sharedProps} />}
            {view === "training" && <TrainingDaysView {...sharedProps} />}
            {view === "events" && <EventsView {...sharedProps} />}
            {view === "students" && isInstructor && <StudentsView {...sharedProps} />}
            {view === "report" && isInstructor && <ReportView {...sharedProps} />}
            {view === "myrecord" && <MyRecordView {...sharedProps} />}
            {view === "settings" && <SettingsView {...sharedProps} authUser={authUser} setUserProfile={setUserProfile} />}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(10,10,26,0.95)", borderTop: "1px solid rgba(200,160,74,0.2)", display: "flex", justifyContent: "space-around", padding: "8px 0 14px", backdropFilter: "blur(10px)", zIndex: 100 }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => setView(n.id)} style={{ background: "none", border: "none", color: view === n.id ? "#C8A04A" : "#555", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", padding: "4px 6px" }}>
            <span style={{ fontSize: 18 }}>{n.icon}</span>
            <span style={{ fontSize: 9, fontWeight: view === n.id ? 700 : 400 }}>{n.label}</span>
          </button>
        ))}
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 76, left: "50%", transform: "translateX(-50%)", background: toast.type === "success" ? "#166534" : "#7f1d1d", color: "#fff", padding: "10px 20px", borderRadius: 12, fontSize: 14, fontWeight: 600, zIndex: 200, whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Login / Register ─────────────────────────────────────────────────────────
function LoginScreen({ db, auth, onLogin, showToast, toast }) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPass, setRegPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    setError(""); setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await onLogin(cred.user.uid);
    } catch (e) {
      setError(e.code === "auth/invalid-credential" ? "Invalid email or password." : e.message);
    }
    setBusy(false);
  };

  const handleRegister = async () => {
    setError(""); setBusy(true);
    if (!name.trim() || !regEmail.trim() || !regPass.trim()) { setError("All fields required."); setBusy(false); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, regEmail.trim(), regPass);
      await setDoc(doc(db, "users", cred.user.uid), { name: name.trim(), email: regEmail.trim(), role: "student", beltIndex: 0, joinDate: new Date().toISOString().split("T")[0], createdAt: serverTimestamp() });
      await onLogin(cred.user.uid);
    } catch (e) {
      setError(e.code === "auth/email-already-in-use" ? "Email already registered." : e.message);
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0a0a1a,#12122a)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 64, marginBottom: 10 }}>⛩️</div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "#C8A04A" }}>Dojo Tracker</h1>
        <p style={{ color: "#555", margin: "6px 0 0", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>Karate Club Attendance</p>
      </div>
      <div style={{ width: "100%", maxWidth: 360, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(200,160,74,0.2)", borderRadius: 20, padding: 28 }}>
        <div style={{ display: "flex", marginBottom: 22, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: 4 }}>
          {[["login","Sign In"],["register","New Student"]].map(([t,l]) => (
            <button key={t} onClick={() => { setTab(t); setError(""); }} style={{ flex: 1, background: tab === t ? "rgba(200,160,74,0.2)" : "none", border: "none", color: tab === t ? "#C8A04A" : "#555", padding: 8, borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
        {error && <div style={{ background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 13, color: "#fca5a5" }}>{error}</div>}
        {tab === "login" ? (
          <>
            <FInput label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
            <FInput label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            <Btn onClick={handleLogin} disabled={busy} style={{ width: "100%", marginTop: 8 }}>{busy ? "Signing in…" : "Sign In"}</Btn>
          </>
        ) : (
          <>
            <FInput label="Full Name" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
            <FInput label="Email" type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="your@email.com" />
            <FInput label="Password" type="password" value={regPass} onChange={e => setRegPass(e.target.value)} placeholder="Min 6 characters" />
            <Btn onClick={handleRegister} disabled={busy} style={{ width: "100%", marginTop: 8 }}>{busy ? "Creating…" : "Create Account"}</Btn>
          </>
        )}
      </div>
      {toast && <div style={{ marginTop: 20, background: "#166534", color: "#fff", padding: "10px 20px", borderRadius: 12, fontSize: 14 }}>{toast.msg}</div>}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardView({ userProfile, trainingDays, events, students, isInstructor }) {
  const stats = calcStudentStats(userProfile.id, trainingDays, events);
  const beltInfo = getNextBeltInfo(userProfile.beltIndex || 0, userProfile.joinDate, stats);
  const today = new Date().toISOString().split("T")[0];
  const todaySession = trainingDays.find(td => td.date === today);

  return (
    <div>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>{isInstructor ? "Dojo Overview" : "My Dashboard"}</h2>

      <Card style={{ marginBottom: 14, background: "linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))", border: "1px solid rgba(200,160,74,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div><div style={{ fontSize: 11, color: "#C8A04A", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Current Belt</div><BeltBadge beltIndex={userProfile.beltIndex || 0} size="lg" /></div>
          {beltInfo.next && <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Next Goal</div><BeltBadge beltIndex={(userProfile.beltIndex || 0) + 1} size="lg" /></div>}
        </div>
        {beltInfo.next ? (
          <>
            <ProgressBar percent={beltInfo.progress} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#aaa" }}>
              <span>{beltInfo.isYearBased ? `${beltInfo.yearsTraining?.toFixed(1)} yrs` : `${stats.trainingHours.toFixed(1)} hrs`}</span>
              <span>{beltInfo.isYearBased ? `Goal: ${beltInfo.yearsRequired} years` : `Goal: ${beltInfo.hoursNeeded} hrs`}</span>
            </div>
          </>
        ) : <div style={{ color: "#C8A04A", fontWeight: 700, marginTop: 8 }}>🏆 Highest Rank Achieved!</div>}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[["Sessions", trainingDays.filter(td => td.attendees?.includes(userProfile.id)).length], ["Hours", stats.trainingHours.toFixed(1)], ["Points", stats.totalPoints.toFixed(0)]].map(([l, v]) => (
          <Card key={l} style={{ textAlign: "center", padding: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#C8A04A" }}>{v}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{l}</div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>📅 Today — {today}</div>
        {todaySession ? <div><span style={{ color: "#4ade80", fontWeight: 700 }}>✅ Session recorded</span><span style={{ fontSize: 12, color: "#aaa", marginLeft: 8 }}>{todaySession.attendees?.length || 0} checked in</span></div> : <div style={{ color: "#555", fontSize: 13 }}>No session recorded yet.</div>}
      </Card>

      {isInstructor && (
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12, color: "#C8A04A" }}>🏅 Top Students</div>
          {[...students].sort((a, b) => calcStudentStats(b.id, trainingDays, events).totalPoints - calcStudentStats(a.id, trainingDays, events).totalPoints).slice(0, 5).map((s, i) => {
            const st = calcStudentStats(s.id, trainingDays, events);
            return (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: ["#FFD700","#C0C0C0","#CD7F32","#888","#888"][i], fontWeight: 700, width: 20 }}>#{i+1}</span>
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div><BeltBadge beltIndex={s.beltIndex || 0} /></div>
                </div>
                <div style={{ textAlign: "right" }}><div style={{ color: "#C8A04A", fontWeight: 800 }}>{st.totalPoints.toFixed(0)} pts</div><div style={{ fontSize: 11, color: "#666" }}>{st.trainingHours.toFixed(1)}h</div></div>
              </div>
            );
          })}
          {students.length === 0 && <div style={{ color: "#555", fontSize: 13 }}>No students yet.</div>}
        </Card>
      )}
    </div>
  );
}

// ─── Check-In ─────────────────────────────────────────────────────────────────
function CheckInView({ userProfile, trainingDays, setTrainingDays, students, showToast, db, isInstructor }) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState("self");
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [duration, setDuration] = useState("1.5");
  const [busy, setBusy] = useState(false);

  const session = trainingDays.find(td => td.date === date);
  const alreadyIn = session?.attendees?.includes(userProfile.id);

  const handleCheckIn = async () => {
    setBusy(true);
    try {
      let userId = userProfile.id;
      if (mode === "other") {
        if (!selectedId) { showToast("Select a student", "error"); setBusy(false); return; }
        userId = selectedId;
      } else if (mode === "new") {
        if (!newName.trim() || !newEmail.trim()) { showToast("Name and email required", "error"); setBusy(false); return; }
        // Create Firebase Auth + Firestore profile for new student
        try {
          const cred = await createUserWithEmailAndPassword(auth, newEmail.trim(), "changeme123");
          userId = cred.user.uid;
          await setDoc(doc(db, "users", userId), { name: newName.trim(), email: newEmail.trim(), role: "student", beltIndex: 0, joinDate: date, createdAt: serverTimestamp() });
        } catch (e) {
          if (e.code === "auth/email-already-in-use") { showToast("Email already registered — select from list", "error"); setBusy(false); return; }
          throw e;
        }
      }

      const sessionId = `td_${date}`;
      const existing = trainingDays.find(td => td.date === date);
      if (existing?.attendees?.includes(userId)) { showToast("Already checked in!", "error"); setBusy(false); return; }

      if (existing) {
        await updateDoc(doc(db, "trainingDays", sessionId), { attendees: [...(existing.attendees || []), userId] });
        setTrainingDays(prev => prev.map(td => td.date === date ? { ...td, attendees: [...(td.attendees || []), userId] } : td));
      } else {
        const newSession = { date, attendees: [userId], durationHours: parseFloat(duration) || 1.5, createdAt: serverTimestamp() };
        await setDoc(doc(db, "trainingDays", sessionId), newSession);
        setTrainingDays(prev => [{ id: sessionId, ...newSession }, ...prev]);
      }
      showToast("✅ Checked in!");
      setNewName(""); setNewEmail("");
    } catch (e) { showToast("Error: " + e.message, "error"); }
    setBusy(false);
  };

  const checkedIn = (session?.attendees || []).map(id => [...students, userProfile].find(u => u.id === id)).filter(Boolean);

  return (
    <div>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>Training Check-In</h2>
      <Card style={{ marginBottom: 14 }}>
        <FInput label="Training Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <FInput label="Session Duration (hours)" type="number" value={duration} onChange={e => setDuration(e.target.value)} step="0.5" min="0.5" />

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[["self","It's Me"],["other","Select Student"],["new","New Student"]].map(([m,l]) => (
            <button key={m} onClick={() => setMode(m)} style={{ flex: 1, background: mode === m ? "rgba(200,160,74,0.25)" : "rgba(255,255,255,0.05)", border: mode === m ? "1px solid rgba(200,160,74,0.6)" : "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: mode === m ? "#C8A04A" : "#777", padding: "7px 4px", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>

        {mode === "other" && (
          <FSelect label="Select Student" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            <option value="">-- Choose student --</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FSelect>
        )}
        {mode === "new" && (
          <>
            <FInput label="Full Name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Student's full name" />
            <FInput label="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="student@email.com" />
            <p style={{ fontSize: 11, color: "#666", margin: "-8px 0 12px" }}>A temporary password "changeme123" will be set — student should update in Settings.</p>
          </>
        )}
        {mode === "self" && alreadyIn && <div style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "#4ade80" }}>✅ Already checked in for this date!</div>}

        <Btn onClick={handleCheckIn} disabled={busy || (mode === "self" && alreadyIn)} style={{ width: "100%" }}>{busy ? "Checking in…" : "Check In"}</Btn>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, marginBottom: 10, color: "#C8A04A" }}>Attendance — {date}</div>
        {checkedIn.length === 0 ? <div style={{ color: "#555", fontSize: 13 }}>No one checked in yet.</div> : checkedIn.map(u => (
          <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ fontSize: 13 }}>{u.name}</span>
            <BeltBadge beltIndex={u.beltIndex || 0} />
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── Training Days ────────────────────────────────────────────────────────────
function TrainingDaysView({ trainingDays, setTrainingDays, students, userProfile, isInstructor, showToast, db }) {
  const [filterMonth, setFilterMonth] = useState("");
  const [editId, setEditId] = useState(null);

  const allUsers = [...students, userProfile];
  const filtered = filterMonth ? trainingDays.filter(td => td.date?.startsWith(filterMonth)) : trainingDays;

  const removeAttendee = async (tdId, userId) => {
    const td = trainingDays.find(t => t.id === tdId);
    const updated = (td.attendees || []).filter(a => a !== userId);
    await updateDoc(doc(db, "trainingDays", tdId), { attendees: updated });
    setTrainingDays(prev => prev.map(t => t.id === tdId ? { ...t, attendees: updated } : t));
    showToast("Removed attendee");
  };

  const deleteSession = async (id) => {
    if (!window.confirm("Delete this training session?")) return;
    await deleteDoc(doc(db, "trainingDays", id));
    setTrainingDays(prev => prev.filter(t => t.id !== id));
    showToast("Session deleted");
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>Training Days</h2>
      <FInput label="Filter by Month" type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
      {filtered.map(td => {
        const attendees = (td.attendees || []).map(id => allUsers.find(u => u.id === id)).filter(Boolean);
        return (
          <Card key={td.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div><div style={{ fontWeight: 800 }}>{td.date}</div><div style={{ fontSize: 12, color: "#888" }}>{attendees.length} attendees · {td.durationHours}h</div></div>
              {isInstructor && (
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn variant="ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setEditId(editId === td.id ? null : td.id)}>Edit</Btn>
                  <Btn variant="danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => deleteSession(td.id)}>Del</Btn>
                </div>
              )}
            </div>
            {attendees.map(u => (
              <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize: 13 }}>{u.name}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <BeltBadge beltIndex={u.beltIndex || 0} />
                  {isInstructor && editId === td.id && <button onClick={() => removeAttendee(td.id, u.id)} style={{ background: "rgba(220,38,38,0.3)", border: "none", borderRadius: 6, color: "#fca5a5", padding: "2px 8px", cursor: "pointer", fontSize: 11 }}>✕</button>}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
      {filtered.length === 0 && <div style={{ color: "#555", textAlign: "center", marginTop: 40 }}>No training sessions found.</div>}
    </div>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────
function EventsView({ events, setEvents, students, userProfile, isInstructor, showToast, db }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", hoursPerDay: 2, days: 1, isCompetition: false });
  const [participantModal, setParticipantModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleAddEvent = async () => {
    if (!form.name || !form.date) { showToast("Name and date required", "error"); return; }
    setBusy(true);
    try {
      const id = `ev_${Date.now()}`;
      const ev = { name: form.name, date: form.date, hoursPerDay: Number(form.hoursPerDay), days: Number(form.days), isCompetition: form.isCompetition, participants: {}, createdAt: serverTimestamp() };
      await setDoc(doc(db, "events", id), ev);
      setEvents(prev => [{ id, ...ev }, ...prev]);
      setForm({ name: "", date: "", hoursPerDay: 2, days: 1, isCompetition: false });
      setShowAdd(false);
      showToast("Event added!");
    } catch (e) { showToast("Error: " + e.message, "error"); }
    setBusy(false);
  };

  const deleteEvent = async (id) => {
    if (!window.confirm("Delete this event?")) return;
    await deleteDoc(doc(db, "events", id));
    setEvents(prev => prev.filter(e => e.id !== id));
    showToast("Event deleted");
  };

  const updateParticipants = async (evId, participants) => {
    await updateDoc(doc(db, "events", evId), { participants });
    setEvents(prev => prev.map(e => e.id === evId ? { ...e, participants } : e));
    if (participantModal?.id === evId) setParticipantModal(pm => ({ ...pm, participants }));
  };

  const toggleAttendance = async (evId, userId) => {
    const ev = events.find(e => e.id === evId);
    const p = { ...(ev.participants || {}) };
    if (p[userId]?.attended) { delete p[userId]; } else { p[userId] = { attended: true, placement: null }; }
    await updateParticipants(evId, p);
  };

  const setPlacement = async (evId, userId, placement) => {
    const ev = events.find(e => e.id === evId);
    const p = { ...(ev.participants || {}), [userId]: { ...(ev.participants?.[userId] || {}), placement: Number(placement) || null } };
    await updateParticipants(evId, p);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Events</h2>
        {isInstructor && <Btn onClick={() => setShowAdd(true)}>+ Add Event</Btn>}
      </div>

      {showAdd && (
        <Card style={{ marginBottom: 14, border: "1px solid rgba(200,160,74,0.4)" }}>
          <div style={{ fontWeight: 700, marginBottom: 12, color: "#C8A04A" }}>New Event</div>
          <FInput label="Event Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Fall Shiai Tournament" />
          <FInput label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FInput label="Hours/Day" type="number" value={form.hoursPerDay} onChange={e => setForm(f => ({ ...f, hoursPerDay: e.target.value }))} min="1" />
            <FInput label="Days" type="number" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} min="1" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <input type="checkbox" checked={form.isCompetition} onChange={e => setForm(f => ({ ...f, isCompetition: e.target.checked }))} id="isComp" style={{ width: 16, height: 16, accentColor: "#C8A04A" }} />
            <label htmlFor="isComp" style={{ color: "#C8A04A", fontSize: 14 }}>Competition (placement points)</label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={handleAddEvent} disabled={busy} style={{ flex: 1 }}>{busy ? "Saving…" : "Save Event"}</Btn>
            <Btn variant="ghost" onClick={() => setShowAdd(false)} style={{ flex: 1 }}>Cancel</Btn>
          </div>
        </Card>
      )}

      {events.map(ev => {
        const totalHours = ev.hoursPerDay * ev.days;
        const count = Object.values(ev.participants || {}).filter(p => p.attended).length;
        const myStatus = ev.participants?.[userProfile.id];
        return (
          <Card key={ev.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 800 }}>{ev.name}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{ev.date} · {totalHours}h{ev.isCompetition ? " 🏆" : ""}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 12, color: "#aaa" }}>{count} attended</span>
                {isInstructor && <Btn variant="danger" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => deleteEvent(ev.id)}>Del</Btn>}
              </div>
            </div>
            {totalHours >= 2 && <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 8 }}>+{totalHours} pts participation{ev.isCompetition ? " + placement bonus" : ""}</div>}
            {isInstructor
              ? <Btn variant="ghost" style={{ width: "100%", fontSize: 12 }} onClick={() => setParticipantModal(ev)}>Manage Participants</Btn>
              : myStatus?.attended
                ? <div style={{ color: "#4ade80", fontSize: 13 }}>✅ You attended{myStatus.placement ? ` · ${myStatus.placement}${["st","nd","rd","th"][myStatus.placement-1]||"th"} place 🏅` : ""}</div>
                : <div style={{ color: "#555", fontSize: 13 }}>You did not attend.</div>
            }
          </Card>
        );
      })}

      {participantModal && (
        <Modal title={`Participants: ${participantModal.name}`} onClose={() => setParticipantModal(null)}>
          {students.map(u => {
            const ev = events.find(e => e.id === participantModal.id);
            const p = ev?.participants?.[u.id];
            return (
              <div key={u.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: p?.attended && ev?.isCompetition ? 6 : 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{u.name}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <BeltBadge beltIndex={u.beltIndex || 0} />
                    <input type="checkbox" checked={!!p?.attended} onChange={() => toggleAttendance(participantModal.id, u.id)} style={{ width: 16, height: 16, accentColor: "#C8A04A" }} />
                  </div>
                </div>
                {p?.attended && ev?.isCompetition && (
                  <FSelect value={p.placement || ""} onChange={e => setPlacement(participantModal.id, u.id, e.target.value)} style={{ marginBottom: 0 }}>
                    <option value="">No placement</option>
                    <option value="1">1st (+5 pts)</option>
                    <option value="2">2nd (+3 pts)</option>
                    <option value="3">3rd (+2 pts)</option>
                    <option value="4">4th (+1 pt)</option>
                  </FSelect>
                )}
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
}

// ─── Students (Instructor) ────────────────────────────────────────────────────
function StudentsView({ students, setStudents, trainingDays, events, showToast, db }) {
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const saveEdit = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, "users", editing.id), { name: editing.name, email: editing.email, joinDate: editing.joinDate, beltIndex: Number(editing.beltIndex) });
      setStudents(prev => prev.map(s => s.id === editing.id ? { ...editing, beltIndex: Number(editing.beltIndex) } : s));
      setSelected({ ...editing, beltIndex: Number(editing.beltIndex) });
      setEditing(null);
      showToast("Student updated!");
    } catch (e) { showToast("Error: " + e.message, "error"); }
    setBusy(false);
  };

  const deleteStudent = async (id) => {
    if (!window.confirm("Delete this student? Their training records will remain.")) return;
    await deleteDoc(doc(db, "users", id));
    setStudents(prev => prev.filter(s => s.id !== id));
    setSelected(null); setEditing(null);
    showToast("Student removed");
  };

  const promoteStudent = async (s) => {
    const newIdx = Math.min((s.beltIndex || 0) + 1, BELT_LEVELS.length - 1);
    await updateDoc(doc(db, "users", s.id), { beltIndex: newIdx });
    const updated = { ...s, beltIndex: newIdx };
    setStudents(prev => prev.map(u => u.id === s.id ? updated : u));
    setSelected(updated);
    showToast(`🎉 Promoted to ${BELT_LEVELS[newIdx].name}!`);
  };

  if (editing) return (
    <div>
      <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", color: "#C8A04A", cursor: "pointer", marginBottom: 16, fontSize: 14 }}>← Back</button>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>Edit Student</h2>
      <Card>
        <FInput label="Full Name" value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))} />
        <FInput label="Email" value={editing.email} onChange={e => setEditing(ed => ({ ...ed, email: e.target.value }))} />
        <FInput label="Join Date" type="date" value={editing.joinDate} onChange={e => setEditing(ed => ({ ...ed, joinDate: e.target.value }))} />
        <FSelect label="Belt Level" value={editing.beltIndex} onChange={e => setEditing(ed => ({ ...ed, beltIndex: e.target.value }))}>
          {BELT_LEVELS.map((b, i) => <option key={i} value={i}>{b.kyu} — {b.name}</option>)}
        </FSelect>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={saveEdit} disabled={busy} style={{ flex: 1 }}>{busy ? "Saving…" : "Save"}</Btn>
          <Btn variant="danger" onClick={() => deleteStudent(editing.id)} style={{ flex: 1 }}>Delete</Btn>
        </div>
      </Card>
    </div>
  );

  if (selected) {
    const s = students.find(u => u.id === selected.id) || selected;
    const stats = calcStudentStats(s.id, trainingDays, events);
    const beltInfo = getNextBeltInfo(s.beltIndex || 0, s.joinDate, stats);
    const sessions = trainingDays.filter(td => td.attendees?.includes(s.id));
    return (
      <div>
        <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#C8A04A", cursor: "pointer", marginBottom: 16, fontSize: 14 }}>← All Students</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{s.name}</h2>
          <Btn variant="ghost" onClick={() => setEditing(s)} style={{ fontSize: 12, padding: "6px 14px" }}>Edit</Btn>
        </div>
        <Card style={{ marginBottom: 12, background: "linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))", border: "1px solid rgba(200,160,74,0.3)" }}>
          <BeltBadge beltIndex={s.beltIndex || 0} size="lg" />
          <div style={{ marginTop: 12 }}>
            <ProgressBar percent={beltInfo.progress} />
            <div style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>
              {beltInfo.isYearBased ? `${beltInfo.yearsTraining?.toFixed(1)} of ${beltInfo.yearsRequired} years` : `${stats.trainingHours.toFixed(1)} / ${beltInfo.hoursNeeded}h → ${beltInfo.next?.name || "next level"}`}
            </div>
          </div>
          {beltInfo.progress >= 100 && beltInfo.next && <Btn onClick={() => promoteStudent(s)} style={{ marginTop: 12, width: "100%" }}>🥋 Promote to {beltInfo.next.name}</Btn>}
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          {[["Sessions", sessions.length], ["Hours", stats.trainingHours.toFixed(1)], ["Points", stats.totalPoints.toFixed(0)]].map(([l, v]) => (
            <Card key={l} style={{ textAlign: "center", padding: 12 }}><div style={{ fontSize: 20, fontWeight: 900, color: "#C8A04A" }}>{v}</div><div style={{ fontSize: 10, color: "#888" }}>{l}</div></Card>
          ))}
        </div>
        <Card>
          <div style={{ fontWeight: 700, color: "#C8A04A", marginBottom: 10 }}>Training History</div>
          {sessions.slice(0, 15).map(td => (
            <div key={td.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13 }}>
              <span>{td.date}</span><span style={{ color: "#C8A04A" }}>{td.durationHours}h</span>
            </div>
          ))}
          {sessions.length === 0 && <div style={{ color: "#555", fontSize: 13 }}>No sessions yet.</div>}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>Students ({students.length})</h2>
      {students.map(s => {
        const stats = calcStudentStats(s.id, trainingDays, events);
        const beltInfo = getNextBeltInfo(s.beltIndex || 0, s.joinDate, stats);
        return (
          <Card key={s.id} style={{ marginBottom: 10 }} onClick={() => setSelected(s)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                <BeltBadge beltIndex={s.beltIndex || 0} />
                <div style={{ marginTop: 8 }}><ProgressBar percent={beltInfo.progress} /></div>
              </div>
              <div style={{ textAlign: "right", marginLeft: 14 }}><div style={{ color: "#C8A04A", fontWeight: 800, fontSize: 18 }}>{stats.totalPoints.toFixed(0)}</div><div style={{ fontSize: 10, color: "#666" }}>pts</div></div>
            </div>
          </Card>
        );
      })}
      {students.length === 0 && <div style={{ color: "#555", textAlign: "center", marginTop: 40 }}>No students yet. They'll appear here when they register.</div>}
    </div>
  );
}

// ─── Report ───────────────────────────────────────────────────────────────────
function ReportView({ students, trainingDays, events }) {
  const rows = [...students].map(s => {
    const stats = calcStudentStats(s.id, trainingDays, events);
    return { ...s, ...stats };
  }).sort((a, b) => b.totalPoints - a.totalPoints);

  const copyReport = () => {
    const lines = ["DOJO TRAINING REPORT", `Generated: ${new Date().toLocaleDateString()}`, "", ...rows.map((r, i) => {
      const bi = getNextBeltInfo(r.beltIndex || 0, r.joinDate, r);
      const belt = BELT_LEVELS[r.beltIndex || 0];
      return `#${i+1} ${r.name} | ${belt.name} | ${r.trainingPoints} sessions | ${r.trainingHours.toFixed(1)}h | ${r.eventPoints.toFixed(0)} event pts | ${r.totalPoints.toFixed(0)} total pts\n    Progress: ${bi.next ? (bi.isYearBased ? `${bi.yearsTraining?.toFixed(1)}/${bi.yearsRequired} years` : `${r.trainingHours.toFixed(1)}/${bi.hoursNeeded}h → ${bi.next.name}`) : "Max rank"}`;
    })].join("\n");
    navigator.clipboard?.writeText(lines).then(() => alert("Report copied to clipboard!")).catch(() => alert("Copy not supported — use screenshot"));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Reports</h2>
        <Btn onClick={copyReport} style={{ fontSize: 12, padding: "7px 14px" }}>📋 Copy</Btn>
      </div>
      {rows.map((r, i) => {
        const bi = getNextBeltInfo(r.beltIndex || 0, r.joinDate, r);
        return (
          <Card key={r.id} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ color: i < 3 ? "#C8A04A" : "#555", fontWeight: 800 }}>#{i+1}</span>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                </div>
                <BeltBadge beltIndex={r.beltIndex || 0} />
              </div>
              <div style={{ textAlign: "right" }}><div style={{ color: "#C8A04A", fontWeight: 900, fontSize: 20 }}>{r.totalPoints.toFixed(0)}</div><div style={{ fontSize: 10, color: "#666" }}>total pts</div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12, marginBottom: 10 }}>
              {[["Sessions", r.trainingPoints], ["Hours", r.trainingHours.toFixed(1)+"h"], ["Evt Pts", r.eventPoints.toFixed(0)]].map(([l, v]) => (
                <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "#ddd" }}>{v}</div><div style={{ color: "#666", fontSize: 10 }}>{l}</div>
                </div>
              ))}
            </div>
            {bi.next ? (
              <><ProgressBar percent={bi.progress} /><div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{bi.isYearBased ? `${bi.yearsTraining?.toFixed(1)} of ${bi.yearsRequired} years` : `${r.trainingHours.toFixed(1)} / ${bi.hoursNeeded}h → ${bi.next.name}`}</div></>
            ) : <div style={{ fontSize: 12, color: "#C8A04A", fontWeight: 700 }}>🏆 Highest rank</div>}
          </Card>
        );
      })}
      {rows.length === 0 && <div style={{ color: "#555", textAlign: "center", marginTop: 40 }}>No students to report on.</div>}
    </div>
  );
}

// ─── My Record ────────────────────────────────────────────────────────────────
function MyRecordView({ userProfile, trainingDays, events }) {
  const stats = calcStudentStats(userProfile.id, trainingDays, events);
  const beltInfo = getNextBeltInfo(userProfile.beltIndex || 0, userProfile.joinDate, stats);
  const sessions = trainingDays.filter(td => td.attendees?.includes(userProfile.id));
  const myEvents = events.filter(ev => ev.participants?.[userProfile.id]?.attended);

  return (
    <div>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>My Record</h2>
      <Card style={{ marginBottom: 14, background: "linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))", border: "1px solid rgba(200,160,74,0.3)" }}>
        <BeltBadge beltIndex={userProfile.beltIndex || 0} size="lg" />
        <div style={{ marginTop: 14 }}>
          {beltInfo.next ? (
            <>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>Progress to {beltInfo.next.name}</div>
              <ProgressBar percent={beltInfo.progress} />
              <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
                {beltInfo.isYearBased ? `${beltInfo.yearsTraining?.toFixed(1)} of ${beltInfo.yearsRequired} years training` : `${stats.trainingHours.toFixed(1)} of ${beltInfo.hoursNeeded} hours`}
              </div>
            </>
          ) : <div style={{ color: "#C8A04A", fontWeight: 700 }}>🏆 Highest Rank Achieved!</div>}
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[["Training Sessions", sessions.length, "📅"], ["Training Hours", stats.trainingHours.toFixed(1)+"h", "⏱️"], ["Event Points", stats.eventPoints.toFixed(0), "🏆"], ["Total Points", stats.totalPoints.toFixed(0), "⭐"]].map(([l, v, ic]) => (
          <Card key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 28 }}>{ic}</div><div style={{ fontSize: 22, fontWeight: 900, color: "#C8A04A" }}>{v}</div><div style={{ fontSize: 11, color: "#777" }}>{l}</div></Card>
        ))}
      </div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: "#C8A04A", marginBottom: 10 }}>Training Sessions ({sessions.length})</div>
        {sessions.map(td => (
          <div key={td.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13 }}>
            <span>{td.date}</span><span style={{ color: "#C8A04A" }}>+{td.durationHours}h</span>
          </div>
        ))}
        {sessions.length === 0 && <div style={{ color: "#555", fontSize: 13 }}>No sessions yet.</div>}
      </Card>
      <Card>
        <div style={{ fontWeight: 700, color: "#C8A04A", marginBottom: 10 }}>Events Attended</div>
        {myEvents.map(ev => {
          const p = ev.participants[userProfile.id];
          const pts = (ev.hoursPerDay * ev.days) + (ev.isCompetition && p.placement ? PLACEMENT_POINTS[p.placement - 1] : 0);
          return (
            <div key={ev.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{ev.name}</div>
              <div style={{ fontSize: 12, color: "#888" }}>{ev.date} · {ev.hoursPerDay * ev.days}h</div>
              {p.placement && <div style={{ fontSize: 12, color: "#C8A04A" }}>🏅 {p.placement}{["st","nd","rd","th"][p.placement-1]||"th"} place</div>}
              <div style={{ fontSize: 12, color: "#4ade80" }}>+{pts.toFixed(0)} pts</div>
            </div>
          );
        })}
        {myEvents.length === 0 && <div style={{ color: "#555", fontSize: 13 }}>No events attended yet.</div>}
      </Card>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsView({ userProfile, setUserProfile, authUser, db, showToast }) {
  const [newEmail, setNewEmail] = useState(userProfile.email);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [busy, setBusy] = useState(false);

  const saveEmail = async () => {
    if (!newEmail.trim() || !currentPass) { showToast("Email and current password required", "error"); return; }
    setBusy(true);
    try {
      const cred = EmailAuthProvider.credential(authUser.email, currentPass);
      await reauthenticateWithCredential(authUser, cred);
      await updateEmail(authUser, newEmail.trim());
      await updateDoc(doc(db, "users", userProfile.id), { email: newEmail.trim() });
      setUserProfile(p => ({ ...p, email: newEmail.trim() }));
      showToast("Email updated!");
      setCurrentPass("");
    } catch (e) {
      showToast(e.code === "auth/wrong-password" ? "Current password incorrect" : "Error: " + e.message, "error");
    }
    setBusy(false);
  };

  const savePassword = async () => {
    if (!currentPass || !newPass) { showToast("Both passwords required", "error"); return; }
    if (newPass.length < 6) { showToast("Password must be 6+ characters", "error"); return; }
    setBusy(true);
    try {
      const cred = EmailAuthProvider.credential(authUser.email, currentPass);
      await reauthenticateWithCredential(authUser, cred);
      await updatePassword(authUser, newPass);
      showToast("Password updated!");
      setCurrentPass(""); setNewPass("");
    } catch (e) {
      showToast(e.code === "auth/wrong-password" ? "Current password incorrect" : "Error: " + e.message, "error");
    }
    setBusy(false);
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800 }}>Settings</h2>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: "#C8A04A", marginBottom: 12 }}>Change Email</div>
        <FInput label="New Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
        <FInput label="Current Password (to confirm)" type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} />
        <Btn onClick={saveEmail} disabled={busy} style={{ width: "100%" }}>{busy ? "Updating…" : "Update Email"}</Btn>
      </Card>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: "#C8A04A", marginBottom: 12 }}>Change Password</div>
        <FInput label="Current Password" type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} />
        <FInput label="New Password" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
        <Btn onClick={savePassword} disabled={busy} style={{ width: "100%" }}>{busy ? "Updating…" : "Update Password"}</Btn>
      </Card>
      <Card style={{ background: "rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 13, color: "#555" }}>Logged in as: <span style={{ color: "#aaa" }}>{userProfile.email}</span></div>
        <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>Role: <span style={{ color: userProfile.role === "instructor" ? "#C8A04A" : "#aaa", textTransform: "capitalize" }}>{userProfile.role}</span></div>
        <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>Member since: <span style={{ color: "#aaa" }}>{userProfile.joinDate}</span></div>
      </Card>
    </div>
  );
}