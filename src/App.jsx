import { useState, useEffect, useCallback, Component } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, updateEmail, EmailAuthProvider, reauthenticateWithCredential,
  sendPasswordResetEmail, createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp, runTransaction,
  arrayUnion, arrayRemove, increment,
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

// ─── Error Boundaries ────────────────────────────────────────────────────────
// Top-level boundary: catches anything the whole app throws.
class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ error, info }); console.error("AppErrorBoundary:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{minHeight:"100vh",background:"#0a0a1a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#fff"}}>
        <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
        <h2 style={{color:"#f87171",margin:"0 0 8px",fontSize:20}}>Something went wrong</h2>
        <p style={{color:"#ccc",fontSize:13,margin:"0 0 20px",textAlign:"center",maxWidth:360}}>The app encountered an unexpected error. Your data in Firebase is safe.</p>
        <div style={{background:"rgba(220,38,38,0.1)",border:"1px solid rgba(220,38,38,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:20,width:"100%",maxWidth:400,fontFamily:"monospace",fontSize:12,color:"#fca5a5",wordBreak:"break-word"}}>
          {msg}
        </div>
        <button onClick={()=>window.location.reload()} style={{background:"linear-gradient(135deg,#C8A04A,#E8C86A)",color:"#0a0a1a",border:"none",borderRadius:10,padding:"10px 28px",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
          Reload App
        </button>
        <p style={{color:"#ddd",fontSize:11,marginTop:16}}>v{APP_VERSION} · If this keeps happening, contact your instructor.</p>
      </div>
    );
  }
}

// Per-tab boundary: catches errors in individual tab views so one bad
// tab never kills the whole app. Shows the error inline with a way out.
class TabErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("TabErrorBoundary [" + (this.props.tab||"?") + "]:", error, info);
    this.setState({ error });
  }
  // Reset when the user switches to a different tab
  componentDidUpdate(prev) { if (prev.tab !== this.props.tab) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div style={{padding:"32px 16px",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
        <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
        <h3 style={{color:"#f87171",margin:"0 0 6px",fontSize:17}}>This tab encountered an error</h3>
        <p style={{color:"#ccc",fontSize:12,margin:"0 0 16px",textAlign:"center"}}>Other tabs are unaffected. Switch tabs or reload.</p>
        <div style={{background:"rgba(220,38,38,0.1)",border:"1px solid rgba(220,38,38,0.3)",borderRadius:10,padding:"10px 14px",marginBottom:16,width:"100%",maxWidth:400,fontFamily:"monospace",fontSize:11,color:"#fca5a5",wordBreak:"break-word"}}>
          {msg}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>{ this.setState({error:null}); if(this.props.onReset) this.props.onReset(); }} style={{background:"rgba(200,160,74,0.2)",border:"1px solid rgba(200,160,74,0.4)",borderRadius:8,color:"#C8A04A",padding:"8px 18px",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            ← Dashboard
          </button>
          <button onClick={()=>window.location.reload()} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,color:"#ddd",padding:"8px 18px",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

// ─── Fee Schedule ────────────────────────────────────────────────────────────
// Defaults used when Firebase has no custom values saved yet
const DEFAULT_FEE_SCHEDULE = [
  { label: "Student",                    academicYear: "45", semester: "35" },
  { label: "Student (Special Discount)", academicYear: "35", semester: "25" },
  { label: "Alumni / Community",         academicYear: "70", semester: "45" },
];
const DEFAULT_AAKF_FEES = [
  { label: "New Member",      amount: "35" },
  { label: "Returning Member", amount: "25" },
];
// Resolve live fee schedule from dojoSettings, falling back to defaults
function getFeeSchedule(dojoSettings) {
  return dojoSettings?.feeSchedule || DEFAULT_FEE_SCHEDULE;
}
function getAakfFees(dojoSettings) {
  return dojoSettings?.aakfFees || DEFAULT_AAKF_FEES;
}
// Return the fee schedule row for this member (legacy fallback)
function getMemberFeeRow(member, dojoSettings) {
  const schedule = getFeeSchedule(dojoSettings);
  const status  = member?.memberStatus  || "student";
  const feeType = member?.membershipFeeType || "student";
  if (status === "alumni" || status === "community") return schedule[2];
  if (feeType === "other") return schedule[1];
  return schedule[0];
}
// Return the AAKF fee row for this member
function getMemberAakfRow(member, dojoSettings) {
  const aakf = getAakfFees(dojoSettings);
  return member?.aakfType === "returning" ? aakf[1] : aakf[0];
}

// ─── Membership Fee Type System ───────────────────────────────────────────────
const MEMBERSHIP_FEE_TYPES = [
  { value: "student_year",          label: "Student — Academic Year"            },
  { value: "student_sem",           label: "Student — Semester"                 },
  { value: "student_year_discount", label: "Student — Academic Year (Discount)" },
  { value: "student_sem_discount",  label: "Student — Semester (Discount)"      },
  { value: "alumni_year",           label: "Alumni & Community — Academic Year"  },
  { value: "alumni_sem",            label: "Alumni & Community — Semester"       },
];

function getMembershipFeeLabel(feeType) {
  return MEMBERSHIP_FEE_TYPES.find(t => t.value === feeType)?.label || feeType || "—";
}

function getMembershipFeeAmount(feeType, dojoSettings) {
  const s = getFeeSchedule(dojoSettings);
  switch (feeType) {
    case "student_year":          return s[0]?.academicYear;
    case "student_sem":           return s[0]?.semester;
    case "student_year_discount": return s[1]?.academicYear;
    case "student_sem_discount":  return s[1]?.semester;
    case "alumni_year":           return s[2]?.academicYear;
    case "alumni_sem":            return s[2]?.semester;
    // Legacy fallbacks for old "student"/"other" values
    case "student": return s[0]?.academicYear;
    case "other":   return s[1]?.academicYear;
    default: return null;
  }
}

// ─── Active / Inactive ───────────────────────────────────────────────────────
// 9 months = 274 days
const INACTIVE_DAYS = 274;

function getLastActivity(userId, trainingDays, events) {
  const trainingDates = trainingDays
    .filter(td => td.attendees?.includes(userId))
    .map(td => td.date);
  const eventDates = events
    .filter(ev => ev.participants?.[userId]?.attended)
    .map(ev => ev.date);
  const all = [...trainingDates, ...eventDates].filter(Boolean).sort();
  return all.length ? all[all.length - 1] : null;
}

function isAutoInactive(userId, trainingDays, events) {
  const last = getLastActivity(userId, trainingDays, events);
  if (!last) return true; // no activity ever = inactive
  const daysSince = (Date.now() - new Date(last)) / (1000 * 60 * 60 * 24);
  return daysSince > INACTIVE_DAYS;
}

// ─── Date Formatter ───────────────────────────────────────────────────────────
function formatDateWithDay(dateStr) {
  if (!dateStr) return dateStr;
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  // Append T00:00:00 to parse as local time, avoiding UTC offset day-shift
  const d = new Date(dateStr + "T00:00:00");
  return `${dateStr} (${days[d.getDay()]})`;
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

const PLACEMENT_PTS = [8, 6, 4, 2]; // 1st, 2nd, 3rd, 4th
const PLACEMENT_LABELS = ["1st (+8 pts)", "2nd (+6 pts)", "3rd (+4 pts)", "4th (+2 pts)"];

// Backward-compatible placements accessor
// New format: p.placements = [{placement, category}]
// Old format: p.placement (number) + p.category (string)
function getParticipantPlacements(p) {
  if (!p) return [];
  if (Array.isArray(p.placements) && p.placements.length) return p.placements;
  if (p.placement >= 1) return [{ placement: p.placement, category: p.category||null }];
  return [];
}
// Sum competition point bonuses across all placements
function getParticipantPtBonus(p, isCompetition) {
  if (!isCompetition) return 0;
  return getParticipantPlacements(p).reduce((sum, pl) => {
    if (pl.placement >= 1 && pl.placement <= 4) return sum + PLACEMENT_PTS[pl.placement - 1];
    return sum;
  }, 0);
}
const DOJO_NAME = "Traditional Karatedo Academy at UMN";
const APP_VERSION = "2.6.03";

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

// Parse a belt reference from a CSV string → beltIndex or null
// Accepts: index number ("3"), belt name ("Green Belt"), kyu label ("6th Kyu"), rank code ("S3","E3")
function parseBeltFromString(str) {
  if (!str) return null;
  const s = str.trim();
  // Plain number
  const n = parseInt(s);
  if (!isNaN(n) && n >= 0 && n < BELT_LEVELS.length) return n;
  // S/E code e.g. "S3", "E6"
  const codeMatch = s.match(/^[SE](\d+)$/i);
  if (codeMatch) { const ci = BELT_CODES.indexOf(codeMatch[1]); if (ci>=0) return ci; }
  // Belt name or kyu label (case-insensitive)
  const lower = s.toLowerCase();
  const byName = BELT_LEVELS.findIndex(b => b.name.toLowerCase()===lower || b.kyu.toLowerCase()===lower);
  if (byName >= 0) return byName;
  return null;
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
    eventPoints += getParticipantPtBonus(p, ev.isCompetition);
  });
  return { trainingHours, trainingHoursSinceReset, trainingPoints, eventPoints, eventHours, totalPoints: trainingPoints + eventPoints };
}

// ─── Rank Exam Processor ─────────────────────────────────────────────────────
async function processRankExam(db, student, examBeltIndex, result, examDate, setStudents, showToast) {
  const studentRef = doc(db, "users", student.id);
  // Atomic: re-reads the student doc at commit time so a double-submit or a
  // concurrent write from elsewhere can never clobber rankHistory or the
  // extraHoursRequired counter. arrayUnion/increment are atomic server-side ops.
  const { promoted, newBeltIndex, levelsAdvanced, examEntry, mergedStudent } = await runTransaction(db, async (tx) => {
    const snap = await tx.get(studentRef);
    const current = snap.exists() ? { id: student.id, ...snap.data() } : student;
    const { promoted, newBeltIndex, levelsAdvanced } = calcPromotion(current.beltIndex||0, examBeltIndex, result);
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

    const updates = { rankHistory: arrayUnion(examEntry) };
    let mergedStudent;

    if (promoted) {
      updates.beltIndex = newBeltIndex;
      updates.beltAchievedDate = examDate;
      updates.trainingResetDate = examDate; // training hours count from here
      mergedStudent = { ...current, beltIndex: newBeltIndex, beltAchievedDate: examDate, trainingResetDate: examDate, rankHistory: [...(current.rankHistory||[]), examEntry] };
    } else {
      const extraHours = BELT_LEVELS[examBeltIndex]?.hoursRequired || 0;
      updates.extraHoursRequired = increment(extraHours);
      mergedStudent = { ...current, extraHoursRequired: (current.extraHoursRequired||0) + extraHours, rankHistory: [...(current.rankHistory||[]), examEntry] };
    }

    tx.update(studentRef, updates);
    return { promoted, newBeltIndex, levelsAdvanced, examEntry, mergedStudent };
  });

  if (showToast) {
    showToast(promoted
      ? `🎉 ${student.name} promoted to ${BELT_LEVELS[newBeltIndex]?.name}!`
      : `📋 ${student.name} — exam recorded, not promoted.`);
  }
  if (setStudents) setStudents(prev=>prev.map(s=>s.id===student.id?mergedStudent:s));
  return mergedStudent;
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
          <button onClick={onClose} style={{background:"none",border:"none",color:"#ccc",fontSize:22,cursor:"pointer"}}>✕</button>
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

// ─── Fee Payment Field ────────────────────────────────────────────────────────
// value = { paid: bool, method: string }
// waived / onWaive — optional, only passed by staff (instructor/manager).
// When waived=true the Paid/Unpaid buttons and method grid are hidden.
function FeeField({ label, value, onChange, waived, onWaive }) {
  const paid   = value?.paid   || false;
  const method = value?.method || "";
  const METHODS = ["Cash","Venmo","CashApp","Other"];
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:6,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>{label}</label>
      <div style={{display:"flex",gap:6,marginBottom:paid&&!waived?8:0}}>
        {onWaive && (
          <button type="button" onClick={()=>onWaive(!waived)} style={{flex:1,background:waived?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",border:waived?"1px solid rgba(167,139,250,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:waived?"#a78bfa":"#bbb",padding:"8px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>🎟 Waive</button>
        )}
        {waived
          ? <div style={{flex:2,background:"rgba(167,139,250,0.15)",border:"1px solid rgba(167,139,250,0.4)",borderRadius:8,padding:"8px",textAlign:"center",fontSize:12,fontWeight:700,color:"#a78bfa"}}>🎟 Fee Waived</div>
          : [true,false].map(v=>(
              <button key={String(v)} type="button" onClick={()=>onChange({paid:v,method:v?method:""})} style={{flex:1,background:paid===v?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.05)",border:paid===v?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:paid===v?"#C8A04A":"#bbb",padding:"8px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                {v?"✅ Paid":"❌ Unpaid"}
              </button>
            ))
        }
      </div>
      {paid && !waived && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {METHODS.map(m=>(
            <button key={m} type="button" onClick={()=>onChange({paid:true,method:m.toLowerCase()})} style={{background:method===m.toLowerCase()?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.04)",border:method===m.toLowerCase()?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:method===m.toLowerCase()?"#C8A04A":"#ccc",padding:"6px 8px",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>{m}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Fee Status Display (read-only) ──────────────────────────────────────────
// Simplified one-row display: "Student — Academic Year · $45  ✅ Paid  [Cash]"
function FeeStatusDisplay({ label, amount, fee, waived, border }) {
  const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : "";
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:border?"1px solid rgba(255,255,255,0.06)":"none"}}>
      <div>
        <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{label}</span>
        {amount && <span style={{fontSize:13,color:"#4ade80",fontWeight:700}}> · ${amount}</span>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        {waived
          ? <span style={{fontSize:12,fontWeight:700,color:"#a78bfa"}}>🎟 Waived</span>
          : <>
              <span style={{fontSize:12,fontWeight:700,color:fee?.paid?"#4ade80":"#f87171"}}>{fee?.paid?"✅ Paid":"❌ Unpaid"}</span>
              {fee?.paid && fee?.method && <span style={{fontSize:11,background:"rgba(200,160,74,0.15)",color:"#C8A04A",padding:"1px 7px",borderRadius:6}}>{cap(fee.method)}</span>}
            </>
        }
      </div>
    </div>
  );
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
function KarateAppInner() {
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
      // Keep all non-system users so instructors/managers appear in dropdowns
      setStudents(usSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.role==="student"||u.role==="instructor"||u.role==="manager"));
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
  const isManager    = profile.role === "manager";
  const isStaff      = isInstructor || isManager; // staff can see member list

  const navItems = isInstructor
    ? [{id:"dashboard",label:"Dashboard",icon:"⛩️"},{id:"checkin",label:"Check-In",icon:"✅"},{id:"training",label:"Training",icon:"📅"},{id:"events",label:"Events",icon:"🏆"},{id:"students",label:"Students",icon:"👥"},{id:"report",label:"Reports",icon:"📊"},{id:"settings",label:"Settings",icon:"⚙️"}]
    : isManager
      ? [{id:"dashboard",label:"Dashboard",icon:"⛩️"},{id:"checkin",label:"Check-In",icon:"✅"},{id:"training",label:"Training",icon:"📅"},{id:"events",label:"Events",icon:"🏆"},{id:"members",label:"Members",icon:"👥"},{id:"myrecord",label:"My Record",icon:"📋"},{id:"settings",label:"Settings",icon:"⚙️"}]
      : [{id:"dashboard",label:"Dashboard",icon:"⛩️"},{id:"checkin",label:"Check-In",icon:"✅"},{id:"training",label:"Training",icon:"📅"},{id:"myrecord",label:"My Record",icon:"📋"},{id:"settings",label:"Settings",icon:"⚙️"}];

  const shared = { profile, trainingDays, setTrainingDays, events, setEvents, students, setStudents, showToast, db, auth, secondaryAuth, isInstructor, isManager, isStaff, loadData, dojoSettings, setDojoSettings };

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#0a0a1a 0%,#12122a 50%,#0d0d20 100%)",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto"}}>
      <div style={{background:"rgba(0,0,0,0.4)",borderBottom:"1px solid rgba(200,160,74,0.3)",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div>
          <div style={{fontSize:10,color:"#C8A04A",letterSpacing:"0.15em",textTransform:"uppercase"}}>{DOJO_NAME}</div>
          <div style={{fontSize:17,fontWeight:800}}>⛩️ {profile.name}</div>
          <div style={{fontSize:11,color:"#ccc",letterSpacing:"0.08em",fontWeight:500}}>v{APP_VERSION}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <BeltBadge beltIndex={profile.beltIndex||0} />
          <button onClick={()=>{ signOut(auth); setView("dashboard"); }} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#ddd",padding:"5px 10px",cursor:"pointer",fontSize:11}}>Logout</button>
        </div>
      </div>

      <div style={{flex:1,padding:"16px 16px 100px",overflowY:"auto"}}>
        {!dataLoaded ? <Spinner /> : (
          <TabErrorBoundary tab={view} onReset={()=>setView("dashboard")}>
            {view==="dashboard" && <DashboardView {...shared} />}
            {view==="checkin"  && <CheckInView {...shared} />}
            {view==="training" && <TrainingDaysView {...shared} />}
            {view==="events"   && <EventsView {...shared} />}
            {view==="students" && isInstructor && <StudentsView {...shared} />}
            {view==="members"  && isManager    && <MembersView {...shared} />}
            {view==="report"   && isInstructor && <ReportView {...shared} dojoSettings={dojoSettings} setStudents={setStudents} />}
            {view==="myrecord" && <MyRecordView {...shared} />}
            {view==="settings" && <SettingsView {...shared} authUser={authUser} setProfile={setProfile} students={students} setStudents={setStudents} trainingDays={trainingDays} events={events} />}
          </TabErrorBoundary>
        )}
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

// Top-level export wraps with AppErrorBoundary so any uncaught crash
// shows a readable screen instead of a blank white page.
export default function KarateApp() {
  return (
    <AppErrorBoundary>
      <KarateAppInner />
    </AppErrorBoundary>
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
        <p style={{color:"#bbb",margin:"4px 0 0",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>{DOJO_NAME}</p>
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
            <p style={{color:"#ddd",fontSize:13,marginBottom:16}}>Enter your email and we'll send a reset link.</p>
            {error && <InfoBox type="error">{error}</InfoBox>}
            <FInput label="Email" type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="your@email.com" />
            <Btn onClick={handleReset} disabled={busy} style={{width:"100%",marginBottom:12}}>{busy?"Sending…":"Send Reset Email"}</Btn>
            <button onClick={()=>{setForgotMode(false);setError("");}} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:13,width:"100%",textAlign:"center"}}>← Back to Sign In</button>
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
        <div style={{fontSize:12,color:"#ccc",textAlign:"center"}}>{yearlyRange.name}: {yearlyRange.start} → {yearlyRange.end}</div>
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
  const stats = calcStats(profile.id, trainingDays, events, profile.trainingResetDate);
  const beltInfo = getBeltProgress(profile.beltIndex||0, profile.joinDate, profile.beltAchievedDate, stats, profile);
  const today = getLocalToday();
  const todaySession = trainingDays.find(td=>td.date===today);
  // Default: semester if configured, yearly if configured, otherwise alltime
  const defaultMode = (dojoSettings?.semesters?.length > 0) ? "semester"
    : dojoSettings?.yearlyStart ? "yearly" : "alltime";
  const [mode, setMode] = useState(defaultMode);
  const [selectedSemester, setSelectedSemester] = useState(0);

  const range = getActiveRange(mode, dojoSettings, selectedSemester);

  const ranked = [...students]
    .filter(s => s.role !== "instructor")   // instructors excluded from leaderboard
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
          {beltInfo.next && <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#ccc",marginBottom:4}}>Next Goal</div><BeltBadge beltIndex={(profile.beltIndex||0)+1} size="lg" /></div>}
        </div>
        {beltInfo.next ? (<>
          <ProgressBar percent={beltInfo.progress} />
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:12,color:"#ddd"}}>
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
          <Card key={l} style={{textAlign:"center",padding:14}}><div style={{fontSize:20,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:10,color:"#ccc",marginTop:2}}>{l}</div></Card>
        ))}
      </div>

      {/* Today */}
      <Card style={{marginBottom:14}}>
        <div style={{fontSize:12,color:"#ccc",marginBottom:6}}>📅 Today — {today}</div>
        {todaySession
          ?<div><span style={{color:"#4ade80",fontWeight:700}}>✅ Session active</span><span style={{fontSize:12,color:"#ddd",marginLeft:8}}>{todaySession.attendees?.length||0} checked in</span></div>
          :<div style={{color:"#bbb",fontSize:13}}>No session recorded yet.</div>}
      </Card>

      {/* Leaderboard */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A"}}>🏅 Top 10</div>
          <div style={{fontSize:11,color:"#ccc"}}>{range.label}</div>
        </div>

        <PeriodSelector dojoSettings={dojoSettings} mode={mode} setMode={setMode} selectedSemester={selectedSemester} setSelectedSemester={setSelectedSemester} />

        {ranked.length===0 && <div style={{color:"#bbb",fontSize:13,textAlign:"center",padding:"20px 0"}}>No data for this period yet.</div>}
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
                <div style={{fontSize:10,color:"#bbb"}}>{s.trainingPts}t + {s.eventPts.toFixed(0)}e pts</div>
              </div>
            </div>
          );
        })}
        {!isInstructor && myRank===0 && ranked.length>0 && (
          <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(255,255,255,0.06)",fontSize:12,color:"#ccc",textAlign:"center"}}>
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
  const [geoAccuracy, setGeoAccuracy] = useState(null);

  const session = trainingDays.find(td=>td.date===today);
  // students array already includes instructors/managers — no need to add profile separately
  const checkedIn = (session?.attendees||[]).map(id=>students.find(u=>u.id===id)).filter(Boolean);
  const alreadyIn = session?.attendees?.includes(selectedId);

  const verifyLocation = () => {
    if (!dojoSettings?.lat || !dojoSettings?.lng) { setGeoStatus("noGeo"); setCheckedGeo(true); return; }
    if (!navigator.geolocation) { setGeoStatus("unsupported"); setCheckedGeo(true); return; }
    setGeoStatus("checking");
    navigator.geolocation.getCurrentPosition(
      pos => {
        const dist = getDistance(pos.coords.latitude, pos.coords.longitude, dojoSettings.lat, dojoSettings.lng);
        const accuracy = pos.coords.accuracy || 0;
        // Browser geolocation returns a radius of uncertainty (pos.coords.accuracy),
        // not a pinpoint — especially indoors, and especially on devices with no GPS
        // chip (e.g. Wi-Fi-only iPads), that radius can be hundreds of meters. Give
        // the geofence that much benefit of the doubt, capped so a wildly inaccurate
        // reading can't trivially defeat the check.
        const tolerance = Math.min(accuracy, 300);
        setGeoAccuracy(Math.round(accuracy));
        setGeoStatus(dist <= 100 + tolerance ? "ok" : "blocked");
        setCheckedGeo(true);
      },
      err => {
        // Distinguish real causes instead of collapsing everything into "too far away".
        const status = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
        setGeoStatus(status);
        setCheckedGeo(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  };

  const canCheckIn = isInstructor || geoStatus === "ok" || geoStatus === "noGeo";

  const handleCheckIn = async () => {
    if (!canCheckIn) { showToast("Location verification required","error"); return; }
    if (alreadyIn) { showToast("Already checked in!","error"); return; }
    setBusy(true);
    try {
      const sessionId = `td_${today}`;
      const sessionRef = doc(db,"trainingDays",sessionId);
      // Atomic read-modify-write: runTransaction re-reads server-side at commit
      // time and retries on conflict, so two simultaneous check-ins can never
      // overwrite each other. arrayUnion is itself an atomic add.
      const outcome = await runTransaction(db, async (tx) => {
        const snap = await tx.get(sessionRef);
        if (snap.exists()) {
          const data = snap.data();
          if ((data.attendees||[]).includes(selectedId)) {
            return { skipped: true, doc: { id: sessionId, ...data } };
          }
          tx.update(sessionRef, { attendees: arrayUnion(selectedId) });
          return { skipped: false, doc: { id: sessionId, ...data, attendees: [...(data.attendees||[]), selectedId] } };
        }
        const nd = { date: today, attendees: [selectedId], durationHours: parseFloat(duration)||1.5, createdAt: serverTimestamp() };
        tx.set(sessionRef, nd);
        return { skipped: false, doc: { id: sessionId, ...nd } };
      });

      if (outcome.skipped) {
        showToast("Already checked in!","error");
      } else {
        setTrainingDays(prev => {
          const exists = prev.some(td=>td.id===sessionId);
          return exists ? prev.map(td=>td.id===sessionId?outcome.doc:td) : [outcome.doc,...prev];
        });
        showToast("✅ Checked in successfully!");
      }
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Training Check-In</h2>
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>📅 Today: {today}</div>
        <div style={{fontSize:12,color:"#ccc",marginBottom:14}}>Check-in is only available for today's session.</div>

        {isInstructor && (
          <>
            <FSelect label="Check in member" value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
              <option value={profile.id}>{profile.name} (You)</option>
              {students.filter(s=>s.id!==profile.id && s.isActive!==false).sort((a,b)=>a.name.localeCompare(b.name)).map(s=>(
                <option key={s.id} value={s.id}>
                  {s.role==="instructor"?"** ":s.role==="manager"?"* ":""}{s.name}
                </option>
              ))}
            </FSelect>
            <FInput label="Session Duration (hours)" type="number" value={duration} onChange={e=>setDuration(e.target.value)} step="0.5" min="0.5" />
          </>
        )}

        {!isInstructor && (
          <>
            {!checkedGeo && (
              <div style={{textAlign:"center",marginBottom:14}}>
                <div style={{fontSize:13,color:"#ddd",marginBottom:12}}>You must verify your location before checking in.</div>
                <Btn onClick={verifyLocation} disabled={geoStatus==="checking"} style={{width:"100%"}}>
                  {geoStatus==="checking"?"📡 Checking location…":"📍 Verify My Location"}
                </Btn>
              </div>
            )}
            {geoStatus==="ok" && <InfoBox type="success">✅ Location verified — you are at the dojo!{geoAccuracy?` (±${geoAccuracy}m accuracy)`:""}</InfoBox>}
            {geoStatus==="blocked" && <InfoBox type="error">❌ You are not within range of the dojo{geoAccuracy?` (±${geoAccuracy}m accuracy)`:""}. Check-in is only allowed on premises.</InfoBox>}
            {geoStatus==="denied" && <InfoBox type="error">❌ Location permission was denied for this site. Check your browser's site settings and allow location access, then try again.</InfoBox>}
            {geoStatus==="timeout" && <InfoBox type="warn">⚠️ Location request timed out — your signal may be weak indoors. Try again, ideally near a window or door.</InfoBox>}
            {geoStatus==="unavailable" && <InfoBox type="warn">⚠️ Could not determine your location right now. Try again in a moment.</InfoBox>}
            {geoStatus==="unsupported" && <InfoBox type="error">❌ This browser doesn't support location services. Try a different browser.</InfoBox>}
            {geoStatus==="noGeo" && <InfoBox type="warn">⚠️ Dojo location not configured yet. Contact your instructor.</InfoBox>}
            {checkedGeo && !["ok","noGeo"].includes(geoStatus) && (
              <Btn variant="ghost" onClick={verifyLocation} disabled={geoStatus==="checking"} style={{width:"100%",marginTop:4}}>
                {geoStatus==="checking"?"📡 Checking location…":"🔄 Try Again"}
              </Btn>
            )}
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
          ?<div style={{color:"#bbb",fontSize:13}}>No one checked in yet.</div>
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
  const allUsers = students; // already includes instructors and managers
  const filtered = filterMonth ? trainingDays.filter(td=>td.date?.startsWith(filterMonth)) : trainingDays;

  const toggleExpand = id => setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));

  const removeAttendee = async (tdId, userId) => {
    await updateDoc(doc(db,"trainingDays",tdId),{attendees:arrayRemove(userId)});
    setTrainingDays(prev=>prev.map(t=>t.id===tdId?{...t,attendees:(t.attendees||[]).filter(a=>a!==userId)}:t));
    showToast("Removed attendee");
  };

  const addAttendee = async (tdId) => {
    if (!addStudentId) { showToast("Select a student","error"); return; }
    const td = trainingDays.find(t=>t.id===tdId);
    if (td.attendees?.includes(addStudentId)) { showToast("Already in this session","error"); return; }
    await updateDoc(doc(db,"trainingDays",tdId),{attendees:arrayUnion(addStudentId)});
    setTrainingDays(prev=>prev.map(t=>t.id===tdId?{...t,attendees:[...(t.attendees||[]),addStudentId]}:t));
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
                <div style={{fontWeight:800,fontSize:15}}>{formatDateWithDay(td.date)}</div>
                <div style={{fontSize:12,color:"#ccc",marginTop:2}}>
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
                <span style={{color:"#bbb",fontSize:16,display:"inline-block",transform:isExpanded?"rotate(180deg)":"rotate(0deg)"}}>⌄</span>
              </div>
            </div>

            {/* Collapsible attendee list */}
            {isExpanded && (
              <div style={{marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:8}}>
                {attendees.length===0
                  ?<div style={{fontSize:12,color:"#bbb",marginBottom:8}}>No attendees recorded.</div>
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
                          {notAttending.filter(u=>u.isActive!==false).sort((a,b)=>(a.name.split(' ')[0]||'').localeCompare(b.name.split(' ')[0]||'')).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
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
      {filtered.length===0 && <div style={{color:"#bbb",textAlign:"center",marginTop:40}}>No sessions found.</div>}
    </div>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────
function EventsView({ events, setEvents, students, setStudents, profile, isInstructor, showToast, db }) {
  const [subview, setSubview] = useState("list"); // list | add
  const [editingEv, setEditingEv] = useState(null);

  // ── List
  const today = getLocalToday();

  // Send event participation email to all active members + instructors
  const sendEventNotification = ev => {
    const recipients = students.filter(s => s.email && (s.isActive !== false || s.role === 'instructor'));
    if (!recipients.length) { showToast('No email addresses found.', 'error'); return; }
    const bcc     = recipients.map(s => s.email).join(',');
    const subject = encodeURIComponent(`Upcoming: ${ev.name} — Traditional Karatedo Academy at UMN`);
    const body    = encodeURIComponent(
`Dear Karateka,

We have an upcoming event and hope you will join us!

📅 ${ev.name}
📆 Date: ${ev.date}
⏱ Duration: ${ev.hours} hour${ev.hours !== 1 ? 's' : ''}${ev.isCompetition ? '\n🏆 This is a COMPETITION — placement points will be awarded!' : ''}

Please mark your calendar and confirm your participation with your instructor.

We look forward to seeing everyone there!

Osu!

Traditional Karatedo Academy at UMN`);
    window.open(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${subject}&body=${body}`);
  };

  if (subview === "list") return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Events</h2>
        {isInstructor && <Btn onClick={()=>setSubview("add")}>+ Add Event</Btn>}
      </div>
      {events.map(ev => {
        const count = Object.values(ev.participants||{}).filter(p=>p.attended).length;
        const myStatus = ev.participants?.[profile.id];
        const myPts = myStatus?.attended ? (parseFloat(myStatus.hoursAttended||ev.hours||0) + getParticipantPtBonus(myStatus, ev.isCompetition)) : 0;
        const isFuture = ev.date >= today;
        return (
          <Card key={ev.id} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <div>
                <div style={{fontWeight:800,fontSize:15}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#ccc"}}>{ev.date} · {ev.hours}h{ev.isCompetition?" 🏆 Competition":""}</div>
                <div style={{fontSize:12,color:"#4ade80",marginTop:2}}>{ev.hours} attendance pts{ev.isCompetition?" + placement bonus":""}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,color:"#ddd"}}>{count} attended</div>
                {isInstructor && (
                  <div style={{display:"flex",gap:4,marginTop:6,justifyContent:"flex-end"}}>
                    {isFuture && (
                      <Btn variant="ghost" style={{padding:"2px 8px",fontSize:10}} onClick={()=>sendEventNotification(ev)}>📧 Notify</Btn>
                    )}
                    <Btn variant="ghost" style={{padding:"2px 8px",fontSize:10}} onClick={()=>{ setEditingEv(ev); setSubview("add"); }}>Edit</Btn>
                    <Btn variant="danger" style={{padding:"2px 8px",fontSize:10}} onClick={async()=>{ if(!window.confirm("Delete event?"))return; await deleteDoc(doc(db,"events",ev.id)); setEvents(prev=>prev.filter(e=>e.id!==ev.id)); showToast("Event deleted"); }}>Del</Btn>
                  </div>
                )}
              </div>
            </div>
            {!isInstructor && myStatus?.attended && (
              <div style={{background:"rgba(200,160,74,0.1)",border:"1px solid rgba(200,160,74,0.2)",borderRadius:8,padding:"8px 12px",marginTop:8}}>
                <div style={{fontSize:13,color:"#4ade80",fontWeight:600}}>✅ You attended · {myStatus.hoursAttended||ev.hours}h</div>
                {getParticipantPlacements(myStatus).map((pl,i)=>(
                  <div key={i} style={{fontSize:12,color:"#C8A04A"}}>🏅 {pl.placement}{["st","nd","rd","th"][pl.placement-1]||"th"} place{pl.category?` — ${pl.category}`:""}</div>
                ))}
                <div style={{fontSize:12,color:"#4ade80"}}>+{myPts.toFixed(0)} total pts earned</div>
              </div>
            )}
            {!isInstructor && !myStatus?.attended && <div style={{fontSize:12,color:"#bbb",marginTop:4}}>You did not attend this event.</div>}
            {isInstructor && count > 0 && (
              <div style={{marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:10}}>
                {Object.entries(ev.participants||{}).filter(([,p])=>p.attended).map(([uid,p])=>{
                  const s = students.find(st=>st.id===uid);
                  if (!s) return null;
                  const pts = parseFloat(p.hoursAttended||ev.hours||0) + getParticipantPtBonus(p, ev.isCompetition);
                  return (
                    <div key={uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:12}}>
                      <span>{s.name}{p.category?<span style={{color:"#ccc"}}> · {p.category}</span>:""}</span>
                      <div style={{textAlign:"right"}}>
                        {getParticipantPlacements(p).map((pl,i)=><span key={i} style={{color:"#C8A04A",marginRight:8}}>🏅 {pl.placement}{["st","nd","rd","th"][pl.placement-1]}{pl.category?" "+pl.category:""}</span>)}
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
      {events.length===0 && <div style={{color:"#bbb",textAlign:"center",marginTop:40}}>No events yet.</div>}
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
  const [indivPlacements, setIndivPlacements] = useState([]); // [{placement,category}]
  const [newPlacement, setNewPlacement] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editingUid, setEditingUid] = useState(null);   // uid being edited in participant list
  const [editPlacements, setEditPlacements] = useState([]);
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);

  const addPlacementToList = () => {
    if (!newPlacement) return;
    setIndivPlacements(prev => [...prev, { placement: parseInt(newPlacement), category: newCategory.trim()||null }]);
    setNewPlacement(""); setNewCategory("");
  };

  const addIndividual = () => {
    if (!indivId) { showToast("Select a student","error"); return; }
    if (form.type==="rankExam") {
      if (newPlacement==="") { showToast("Select belt level being tested","error"); return; }
      if (!newCategory) { showToast("Select S or E result","error"); return; }
      setParticipants(prev => ({
        ...prev,
        [indivId]: { attended: true, examBeltIndex: Number(newPlacement), result: newCategory }
      }));
    } else {
      // Store placements array; also keep first placement flat for backward compat
      const pls = indivPlacements.length ? indivPlacements : [];
      setParticipants(prev => ({
        ...prev,
        [indivId]: {
          attended: true,
          hoursAttended: parseFloat(form.hours)||0,
          placements: pls,
          placement: pls[0]?.placement || null,   // backward compat
          category:  pls[0]?.category  || null,
        }
      }));
    }
    setIndivId(""); setIndivPlacements([]); setNewPlacement(""); setNewCategory("");
    showToast("Student added to event");
  };

  const removeParticipant = uid => {
    setParticipants(prev => { const n={...prev}; delete n[uid]; return n; });
  };

  const handleCSV = () => {
    const rows = parseCSV(csvText);
    let added=0, notFound=[], errors=[];
    const newP = {...participants};

    rows.forEach(row => {
      // Identify the student by name or email (column header "student" or "name" or "email")
      const emailVal = (row.email||row.student||"").toLowerCase().trim();
      const nameVal  = (row.name ||row.student||"").toLowerCase().trim();
      const student  = students.find(s =>
        (emailVal && s.email?.toLowerCase()===emailVal) ||
        (nameVal  && s.name?.toLowerCase()===nameVal)
      );
      if (!student) { notFound.push(row.student||row.email||row.name||"unknown"); return; }

      if (form.type === "rankExam") {
        // Rank exam CSV columns: student, current_rank, result, total_fee
        const rankStr  = row.current_rank || row.currentrank || row.rank || "";
        const result   = (row.result||"").toUpperCase().trim();
        const feeAmt   = parseFloat(row.total_fee||row.totalfee||row.fee||0)||0;
        const beltIdx  = parseBeltFromString(rankStr);

        if (!beltIdx && beltIdx !== 0) { errors.push(`${student.name}: could not parse rank "${rankStr}"`); return; }
        if (result !== "S" && result !== "E") { errors.push(`${student.name}: result must be S or E, got "${result}"`); return; }
        if (!isKyuRank(beltIdx)) { errors.push(`${student.name}: rank exams only for Kyu ranks (White–Brown III)`); return; }

        newP[student.id] = {
          attended: true,
          examBeltIndex: beltIdx,
          result,
          examFee: feeAmt || null,
        };
      } else {
        // Regular event CSV columns: name, email, placement, category
        newP[student.id] = {
          attended: true,
          hoursAttended: parseFloat(form.hours)||0,
          placement: parseInt(row.placement)||null,
          category: (row.category||"").trim()||null,
        };
      }
      added++;
    });

    setParticipants(newP);
    const msg = `Added ${added}${notFound.length?`. Not found: ${notFound.slice(0,2).join(", ")}`:""} ${errors.length?`. Errors: ${errors.slice(0,2).join("; ")}`:""}`;
    showToast(msg, added>0?"success":"error");
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
                {PLACEMENT_LABELS.map(l=>(
                  <div key={l} style={{color:"#ddd",padding:"2px 0"}}>🏅 {l}</div>
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
            <div style={{fontSize:12,color:"#ccc"}}>{form.date} · {form.hours}h · {participantList.length} participants{form.isCompetition?" · Competition":""}</div>
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
              {/* Sorted by first name */}
              <FSelect label="Select Student" value={indivId} onChange={e=>{ setIndivId(e.target.value); setIndivPlacements([]); setNewPlacement(""); setNewCategory(""); }}>
                <option value="">-- Choose student --</option>
                {students.filter(s=>!participants[s.id]?.attended && s.isActive!==false)
                  .sort((a,b)=>(a.name.split(' ')[0]||'').localeCompare(b.name.split(' ')[0]||''))
                  .map(s=><option key={s.id} value={s.id}>{s.name} — {BELT_LEVELS[s.beltIndex||0]?.name}</option>)}
              </FSelect>

              {form.type==="rankExam" && indivId && (<>
                <FSelect label="Belt Level Being Tested" value={newPlacement} onChange={e=>setNewPlacement(e.target.value)}>
                  <option value="">-- Select belt level tested --</option>
                  {BELT_LEVELS.map((_,i)=> isKyuRank(i) ? <option key={i} value={i}>{beltDropdownLabel(i)}</option> : null)}
                </FSelect>
                {newPlacement !== "" && (
                  <div style={{marginBottom:14}}>
                    <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:6,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Result</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {[["S","S — Satisfactory"],["E","E — Exceeding"]].map(([val,label])=>(
                        <div key={val} onClick={()=>setNewCategory(val)} style={{background:newCategory===val?"rgba(200,160,74,0.2)":"rgba(255,255,255,0.04)",border:newCategory===val?"2px solid #C8A04A":"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px",cursor:"pointer",textAlign:"center",fontSize:13,fontWeight:700,color:newCategory===val?"#C8A04A":"#ccc"}}>{label}</div>
                      ))}
                    </div>
                  </div>
                )}
                {newPlacement !== "" && newCategory && (() => {
                  const student = students.find(s=>s.id===indivId);
                  const { promoted, levelsAdvanced } = calcPromotion(student?.beltIndex||0, Number(newPlacement), newCategory);
                  return (
                    <div style={{background:promoted?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)",border:`1px solid ${promoted?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12}}>
                      <strong style={{color:promoted?"#4ade80":"#f87171"}}>{getRankCode(Number(newPlacement),newCategory)}</strong>
                      <span style={{color:"#ddd",marginLeft:8}}>{promoted?`✅ Will promote${levelsAdvanced>1?" (+2 levels)":""}` : "❌ No promotion"}</span>
                    </div>
                  );
                })()}
              </>)}

              {/* Multiple placements for competition events */}
              {form.type==="regular" && form.isCompetition && indivId && (<>
                {indivPlacements.length > 0 && (
                  <div style={{marginBottom:8}}>
                    {indivPlacements.map((pl,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'rgba(200,160,74,0.08)',borderRadius:8,padding:'6px 10px',marginBottom:4}}>
                        <span style={{fontSize:12,color:'#C8A04A'}}>🏅 {["1st","2nd","3rd","4th"][pl.placement-1]} place{pl.category?" — "+pl.category:""} <span style={{color:'#4ade80'}}>+{PLACEMENT_PTS[pl.placement-1]} pts</span></span>
                        <button onClick={()=>setIndivPlacements(prev=>prev.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#f87171',cursor:'pointer',fontSize:14,padding:'0 4px'}}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'10px',marginBottom:10}}>
                  <div style={{fontSize:11,color:'#C8A04A',fontWeight:600,marginBottom:8,letterSpacing:'0.06em',textTransform:'uppercase'}}>Add Placement</div>
                  <FSelect label="Place" value={newPlacement} onChange={e=>setNewPlacement(e.target.value)} style={{marginBottom:6}}>
                    <option value="">-- Select place --</option>
                    {PLACEMENT_LABELS.map((l,i)=><option key={i} value={i+1}>{l}</option>)}
                  </FSelect>
                  {newPlacement && <FInput label="Category (e.g. Kumite Under 70kg)" value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="e.g. Kata, Kumite Under 70kg" />}
                  <Btn variant="ghost" onClick={addPlacementToList} disabled={!newPlacement} style={{width:'100%',fontSize:12,padding:'6px'}}>+ Add This Placement</Btn>
                </div>
              </>)}
              <Btn onClick={addIndividual} disabled={!indivId} style={{width:"100%"}}>+ Add to Event</Btn>
            </Card>
          )}

          {/* CSV add */}
          {addMode==="csv" && (
            <Card style={{marginBottom:14}}>
              {form.type==="rankExam" ? (
                <InfoBox type="info">
                  <strong>Rank Exam CSV columns:</strong><br/>
                  <code style={{fontSize:11}}>student, current_rank, result, total_fee</code><br/><br/>
                  <strong>student:</strong> name or email address<br/>
                  <strong>current_rank:</strong> belt name (e.g. <code style={{fontSize:11}}>Green Belt</code>), kyu label (<code style={{fontSize:11}}>6th Kyu</code>), or index number (0–8)<br/>
                  <strong>result:</strong> <code style={{fontSize:11}}>S</code> (Satisfactory) or <code style={{fontSize:11}}>E</code> (Exceeding)<br/>
                  <strong>total_fee:</strong> exam fee collected (e.g. <code style={{fontSize:11}}>25</code>)
                </InfoBox>
              ) : (
                <InfoBox type="info">
                  CSV columns: <code style={{fontSize:11}}>name, email, placement, category</code><br/>
                  Leave placement/category blank for non-placers.
                </InfoBox>
              )}
              <div style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Upload CSV</label>
                <input type="file" accept=".csv" onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f); }} style={{color:"#fff",fontSize:13}} />
              </div>
              {csvText && <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:10,fontSize:11,color:"#ccc",maxHeight:100,overflowY:"auto",fontFamily:"monospace"}}>{csvText.slice(0,300)}</div>}
              <Btn onClick={handleCSV} disabled={!csvText} style={{width:"100%"}}>Import from CSV</Btn>
            </Card>
          )}

          {/* Participant list */}
          {participantList.length > 0 && (
            <Card style={{marginBottom:14}}>
              <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Participants ({participantList.length})</div>
              {participantList.map(([uid,p])=>{
                const s=students.find(st=>st.id===uid);
                const isEditing = editingUid===uid;

                if (form.type==="rankExam") {
                  const code = p.examBeltIndex!==undefined&&p.result ? getRankCode(Number(p.examBeltIndex),p.result) : "?";
                  const { promoted } = p.examBeltIndex!==undefined&&p.result ? calcPromotion(s?.beltIndex||0,Number(p.examBeltIndex),p.result) : {promoted:false};
                  return (
                    <div key={uid} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600}}>{s?.name||uid}</div>
                        <div style={{fontSize:12,color:"#ccc"}}>{BELT_LEVELS[s?.beltIndex||0]?.name} → testing {BELT_LEVELS[Number(p.examBeltIndex)]?.name}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:14,fontWeight:800,color:promoted?"#4ade80":"#f87171"}}>{code}</span>
                        <button onClick={()=>removeParticipant(uid)} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                      </div>
                    </div>
                  );
                }

                // Regular event — supports multiple placements
                const pls  = getParticipantPlacements(p);
                const pts  = parseFloat(p.hoursAttended||form.hours||0) + getParticipantPtBonus(p, form.isCompetition);

                return (
                  <div key={uid} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                    {/* Name row — tap to toggle edit */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:form.isCompetition?"pointer":"default"}} onClick={()=>{ if(!form.isCompetition)return; if(isEditing){setEditingUid(null);}else{setEditingUid(uid);setEditPlacements(pls.map(pl=>({...pl})));} }}>
                      <div>
                        <span style={{fontSize:13,fontWeight:600}}>{s?.name||uid}</span>
                        {form.isCompetition && <span style={{fontSize:11,color:"#C8A04A",marginLeft:6}}>{isEditing?"▲ close":"✏️ edit placements"}</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:"#4ade80",fontSize:13,fontWeight:700}}>+{pts.toFixed(0)} pts</span>
                        <button onClick={e=>{e.stopPropagation();removeParticipant(uid);}} style={{background:"rgba(220,38,38,0.3)",border:"none",borderRadius:6,color:"#fca5a5",padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>
                      </div>
                    </div>
                    {/* Placement badges */}
                    {!isEditing && pls.map((pl,i)=>(
                      <div key={i} style={{fontSize:11,color:"#C8A04A",marginTop:3}}>🏅 {["1st","2nd","3rd","4th"][pl.placement-1]||pl.placement+"th"} place{pl.category?" — "+pl.category:""} <span style={{color:"#4ade80"}}>+{PLACEMENT_PTS[pl.placement-1]||0} pts</span></div>
                    ))}
                    {/* Inline edit panel */}
                    {isEditing && (
                      <div style={{background:"rgba(200,160,74,0.06)",border:"1px solid rgba(200,160,74,0.2)",borderRadius:8,padding:"10px",marginTop:8}}>
                        {editPlacements.map((pl,i)=>(
                          <div key={i} style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
                            <select value={pl.placement} onChange={e=>setEditPlacements(prev=>prev.map((x,idx)=>idx===i?{...x,placement:parseInt(e.target.value)}:x))} style={{background:"#1a1a2e",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,padding:"5px 8px",color:"#fff",fontSize:12,fontFamily:"inherit",outline:"none"}}>
                              {[1,2,3,4].map(n=><option key={n} value={n}>{["1st","2nd","3rd","4th"][n-1]}</option>)}
                            </select>
                            <input value={pl.category||""} onChange={e=>setEditPlacements(prev=>prev.map((x,idx)=>idx===i?{...x,category:e.target.value}:x))} placeholder="Category" style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,padding:"5px 8px",color:"#fff",fontSize:12,fontFamily:"inherit",outline:"none"}} />
                            <button onClick={()=>setEditPlacements(prev=>prev.filter((_,idx)=>idx!==i))} style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:14,flexShrink:0}}>✕</button>
                          </div>
                        ))}
                        <div style={{display:"flex",gap:6,marginTop:6}}>
                          <button onClick={()=>setEditPlacements(prev=>[...prev,{placement:1,category:""}])} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,color:"#ccc",padding:"5px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>+ Add Placement</button>
                          <button onClick={()=>{
                            const updated={...p,placements:editPlacements,placement:editPlacements[0]?.placement||null,category:editPlacements[0]?.category||null};
                            setParticipants(prev=>({...prev,[uid]:updated}));
                            setEditingUid(null);
                          }} style={{flex:1,background:"rgba(200,160,74,0.2)",border:"1px solid rgba(200,160,74,0.4)",borderRadius:6,color:"#C8A04A",padding:"5px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>Save</button>
                        </div>
                      </div>
                    )}
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
      {csvText&&<div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:14,fontSize:11,color:"#ccc",maxHeight:120,overflowY:"auto",fontFamily:"monospace"}}>{csvText.slice(0,400)}</div>}
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={handleSubmit} disabled={busy||!csvText} style={{flex:1}}>{busy?"Importing…":"Import"}</Btn>
        <Btn variant="ghost" onClick={onClose} style={{flex:1}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── Students ─────────────────────────────────────────────────────────────────
function StudentsView({ students, setStudents, trainingDays, events, showToast, db, secondaryAuth, dojoSettings }) {
  const [view, setView] = useState("list"); // list | add | edit | detail | csv
  const [selected, setSelected] = useState(null);
  const memberListSort = useState("last"); // ["last"|"first"|"rank", setter]
  const [studentSortDir, setStudentSortDir] = useState("asc"); // asc|desc
  const [search, setSearch] = useState("");
  const [activeCollapsed,   setActiveCollapsed]   = useState(false);
  const [inactiveCollapsed, setInactiveCollapsed] = useState(false);
  const emptyForm = {
    name:"", email:"", phone:"", dob:"",
    role:"student",                    // student | manager | instructor
    beltIndex:0, joinDate:getLocalToday(), beltAchievedDate:getLocalToday(),
    memberStatus:"student",            // student | alumni | community
    membershipFeeType:"student_year",  // see MEMBERSHIP_FEE_TYPES
    membershipFee:{paid:false,method:""},
    aakfType:"new",                    // new | returning
    aakfFee:{paid:false,method:""},
    membershipFeeWaived:false,         // instructor/manager can waive the membership fee
    isActive:true,                     // true by default; instructor/manager can set false
  };
  const [form, setForm] = useState(emptyForm);
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
      const newProfile = {
        name:form.name.trim(), email:form.email.trim(), phone:form.phone.trim(),
        dob:form.dob, role:form.role||"student", beltIndex:Number(form.beltIndex),
        joinDate:form.joinDate, beltAchievedDate:form.beltAchievedDate,
        memberStatus:form.memberStatus, membershipFeeType:form.membershipFeeType,
        membershipFee:form.membershipFee, aakfType:form.aakfType, aakfFee:form.aakfFee,
        membershipFeeWaived: form.membershipFeeWaived || false,
        isActive: form.isActive !== false,
        createdAt:serverTimestamp(),
      };
      await setDoc(doc(db,"users",uid),newProfile);
      await sendPasswordResetEmail(secondaryAuth, form.email.trim());
      await signOut(secondaryAuth); // sign out secondary, instructor session untouched
      setStudents(prev=>[...prev,{id:uid,...newProfile}]);
      showToast(`✅ ${form.name} added! Welcome email sent.`);
      setForm(emptyForm);
      setView("list");
    } catch(e) {
      showToast(e.code==="auth/email-already-in-use"?"Email already registered":e.message,"error");
    }
    setBusy(false);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const updates={
        name:selected.name, email:selected.email, phone:selected.phone||"",
        dob:selected.dob||"", role:selected.role||"student", beltIndex:Number(selected.beltIndex),
        joinDate:selected.joinDate, beltAchievedDate:selected.beltAchievedDate,
        memberStatus:selected.memberStatus||"student",
        membershipFeeType:selected.membershipFeeType||"student",
        membershipFee:selected.membershipFee||{paid:false,method:""},
        aakfType:selected.aakfType||"new",
        aakfFee:selected.aakfFee||{paid:false,method:""},
        membershipFeeWaived: selected.membershipFeeWaived||false,
        isActive: selected.isActive !== false,
      };
      await updateDoc(doc(db,"users",selected.id),updates);
      setStudents(prev=>prev.map(s=>s.id===selected.id?{...s,...updates}:s));
      showToast("✅ Member updated!");
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
    let created=0, updated=0, errors=[];

    for (const row of rows) {
      const email = (row.email||"").toLowerCase().trim();
      if (!email) { errors.push("row missing email"); continue; }

      // ── Parse all fields from the CSV row (normalize header variants)
      const csvFields = {
        name:               (row.name||"").trim() || null,
        phone:              (row.phone||"").trim() || null,
        dob:                (row.dob||row.dateofbirth||"").trim() || null,
        beltIndex:          row.beltindex!==undefined ? parseInt(row.beltindex)||0 : null,
        joinDate:           (row.joindate||"").trim() || null,
        beltAchievedDate:   (row.beltachieveddate||row.beltdate||"").trim() || null,
        memberStatus:       (row.memberstatus||"").toLowerCase().trim() || null,
        membershipFeeType:  (row.membershipfeetype||row.feetype||"").toLowerCase().trim() || null,
        membershipFeePaid:  (row.membershipfeepaid||row.feepaid||"").toLowerCase().trim() || null,
        membershipFeeMethod:(row.membershipfeemethod||row.feemethod||"").toLowerCase().trim() || null,
        aakfType:           (row.aakftype||"").toLowerCase().trim() || null,
        aakfFeePaid:        (row.aakffeepaid||row.aakfpaid||"").toLowerCase().trim() || null,
        aakfFeeMethod:      (row.aakffeemethod||row.aakfmethod||"").toLowerCase().trim() || null,
      };

      // ── Helper: parse paid/method from CSV into fee object
      const parseFee = (paidStr, methodStr) => {
        if (!paidStr) return null; // not in CSV — don't touch
        const paid = ["yes","true","paid","1"].includes(paidStr);
        const method = ["cash","venmo","cashapp","other"].includes(methodStr) ? methodStr : "";
        return { paid, method };
      };

      const membershipFeeFromCSV = parseFee(csvFields.membershipFeePaid, csvFields.membershipFeeMethod);
      const aakfFeeFromCSV = parseFee(csvFields.aakfFeePaid, csvFields.aakfFeeMethod);

      // ── Check if this student already exists
      const existing = students.find(s => s.email?.toLowerCase() === email);

      if (existing) {
        // UPDATE: only fill in fields that are blank/missing on the existing record
        const updates = {};
        if (csvFields.name && !existing.name)                       updates.name = csvFields.name;
        if (csvFields.phone && !existing.phone)                     updates.phone = csvFields.phone;
        if (csvFields.dob && !existing.dob)                         updates.dob = csvFields.dob;
        if (csvFields.beltIndex !== null && existing.beltIndex===0) updates.beltIndex = csvFields.beltIndex;
        if (csvFields.joinDate && !existing.joinDate)               updates.joinDate = csvFields.joinDate;
        if (csvFields.beltAchievedDate && !existing.beltAchievedDate) updates.beltAchievedDate = csvFields.beltAchievedDate;
        if (csvFields.memberStatus && !existing.memberStatus)       updates.memberStatus = csvFields.memberStatus;
        if (csvFields.membershipFeeType && !existing.membershipFeeType) updates.membershipFeeType = csvFields.membershipFeeType;
        if (membershipFeeFromCSV && !existing.membershipFee?.paid)  updates.membershipFee = membershipFeeFromCSV;
        if (csvFields.aakfType && !existing.aakfType)               updates.aakfType = csvFields.aakfType;
        if (aakfFeeFromCSV && !existing.aakfFee?.paid)             updates.aakfFee = aakfFeeFromCSV;

        if (Object.keys(updates).length > 0) {
          try {
            await updateDoc(doc(db,"users",existing.id), updates);
            setStudents(prev=>prev.map(s=>s.id===existing.id?{...s,...updates}:s));
            updated++;
          } catch(e) { errors.push(`${email}: update failed — ${e.message}`); }
        }
        // If nothing to update, silently skip (not an error)

      } else {
        // CREATE: new student
        if (!csvFields.name) { errors.push(`${email}: name required for new student`); continue; }
        try {
          const tempPass = "Welcome@"+Math.floor(1000+Math.random()*9000);
          const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPass);
          const uid = cred.user.uid;
          const today = getLocalToday();
          const p = {
            name: csvFields.name,
            email,
            phone: csvFields.phone || "",
            dob: csvFields.dob || "",
            role: "student",
            beltIndex: csvFields.beltIndex ?? 0,
            joinDate: csvFields.joinDate || today,
            beltAchievedDate: csvFields.beltAchievedDate || csvFields.joinDate || today,
            memberStatus: csvFields.memberStatus || "student",
            membershipFeeType: csvFields.membershipFeeType || "student",
            membershipFee: membershipFeeFromCSV || { paid:false, method:"" },
            aakfType: csvFields.aakfType || "new",
            aakfFee: aakfFeeFromCSV || { paid:false, method:"" },
            isActive: true, // new members always start Active
            createdAt: serverTimestamp(),
          };
          await setDoc(doc(db,"users",uid), p);
          await sendPasswordResetEmail(secondaryAuth, email);
          await signOut(secondaryAuth);
          setStudents(prev=>[...prev,{id:uid,...p}]);
          created++;
        } catch(e) {
          errors.push(`${email}: ${e.code==="auth/email-already-in-use"?"auth account exists but not in roster — check Firebase Auth":e.message}`);
        }
      }
    }

    const summary = [
      created > 0 ? `${created} created` : null,
      updated > 0 ? `${updated} updated` : null,
      errors.length > 0 ? `${errors.length} error(s)` : null,
    ].filter(Boolean).join(", ");
    showToast(`✅ Import done — ${summary || "nothing changed"}`, errors.length>0?"error":"success");
    if (errors.length) console.warn("CSV import errors:", errors);
    setCsvText(""); setView("list");
    setBusy(false);
  };

  // ── List view
  if (view==="list") {
    const [sortBy, setSortBy] = memberListSort;
    // Helper: parse last name (last word) for sorting
    const lastName = name => name?.trim().split(" ").slice(-1)[0]||"";
    const firstName = name => name?.trim().split(" ")[0]||"";
    const sortedMembers = [...students].sort((a,b)=>{
      let cmp = 0;
      if (sortBy==="rank")       cmp = (a.beltIndex||0) - (b.beltIndex||0);
      else if (sortBy==="first") cmp = firstName(a.name).localeCompare(firstName(b.name));
      else                       cmp = lastName(a.name).localeCompare(lastName(b.name));
      return studentSortDir==="asc" ? cmp : -cmp;
    });
    // Role marker
    const roleMarker = s => s.role==="instructor"?"** ":s.role==="manager"?"* ":"";
    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Members ({students.length})</h2>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="ghost" onClick={()=>setView("csv")} style={{fontSize:12,padding:"7px 12px"}}>📥 CSV</Btn>
            <Btn onClick={()=>setView("add")} style={{fontSize:12,padding:"7px 12px"}}>+ Add</Btn>
          </div>
        </div>
        {/* Search box */}
        <div style={{position:"relative",marginBottom:12}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search by name…" style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"9px 14px",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}} />
          {search && <button onClick={()=>setSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#ccc",fontSize:16,cursor:"pointer"}}>✕</button>}
        </div>
        {/* Sort controls — tap active key again to toggle direction */}
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["last","Last Name"],["first","First Name"],["rank","Rank"]].map(([k,l])=>(
            <button key={k} onClick={()=>{ if(sortBy===k){setStudentSortDir(d=>d==="asc"?"desc":"asc");}else{memberListSort[1](k);setStudentSortDir("asc");} }} style={{flex:1,background:sortBy===k?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:sortBy===k?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:sortBy===k?"#C8A04A":"#666",padding:"6px 4px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
              {l}{sortBy===k?(studentSortDir==="asc"?" ↑":" ↓"):""}
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:"#bbb",marginBottom:10}}>** Instructor &nbsp;· &nbsp;* Manager</div>
        {(()=>{
          const q = search.toLowerCase();
          const visible = q ? sortedMembers.filter(s=>s.name?.toLowerCase().includes(q)) : sortedMembers;
          const active   = visible.filter(s => s.isActive !== false);
          const inactive = visible.filter(s => s.isActive === false);
          const renderCard = s => {
            const st=calcStats(s.id,trainingDays,events);
            const bi=getBeltProgress(s.beltIndex||0,s.joinDate,s.beltAchievedDate,st);
            const marker=roleMarker(s);
            return (
              <Card key={s.id} style={{marginBottom:10,opacity:s.isActive===false?0.6:1}} onClick={()=>{setSelected(s);setView("detail");}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontWeight:700,fontSize:15}}>{marker&&<span style={{color:"#C8A04A"}}>{marker}</span>}{s.name}</span>
                      {s.isActive===false&&<span style={{fontSize:10,background:"rgba(156,163,175,0.2)",color:"#9ca3af",padding:"1px 7px",borderRadius:10,fontWeight:600}}>Inactive</span>}
                    </div>
                    <BeltBadge beltIndex={s.beltIndex||0} />
                    <div style={{marginTop:8}}><ProgressBar percent={bi.progress} /></div>
                  </div>
                  <div style={{textAlign:"right",marginLeft:14}}><div style={{color:"#C8A04A",fontWeight:800,fontSize:18}}>{st.totalPoints.toFixed(0)}</div><div style={{fontSize:10,color:"#bbb"}}>pts</div></div>
                </div>
              </Card>
            );
          };
          const SectionHeader = ({label, count, color, collapsed, onToggle}) => (
            <div onClick={onToggle} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none",padding:"6px 0",marginBottom:collapsed?0:8}}>
              <div style={{fontSize:11,color,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>{label} ({count})</div>
              <span style={{color,fontSize:14,transition:"transform 0.2s",display:"inline-block",transform:collapsed?"rotate(-90deg)":"rotate(0deg)"}}>⌄</span>
            </div>
          );
          return (<>
            {active.length>0&&<>
              <SectionHeader label="● Active" count={active.length} color="#4ade80" collapsed={activeCollapsed} onToggle={()=>setActiveCollapsed(c=>!c)} />
              {!activeCollapsed && active.map(renderCard)}
            </>}
            {inactive.length>0&&<>
              <SectionHeader label="○ Inactive" count={inactive.length} color="#9ca3af" collapsed={inactiveCollapsed} onToggle={()=>setInactiveCollapsed(c=>!c)} />
              {!inactiveCollapsed && inactive.map(renderCard)}
            </>}
            {students.length===0&&<div style={{color:"#bbb",textAlign:"center",marginTop:40}}>No members yet.</div>}
          </>);
        })()}
      </div>
    );
  }

  // ── Add student
  if (view==="add") return (
    <div>
      <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Add Student</h2>
      <Card>
        <FInput label="Full Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Student's full name" />
        <FInput label="Email" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="student@email.com" />
        <FInput label="Phone Number" type="tel" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="(612) 555-0100" />
        <FInput label="Date of Birth" type="date" value={form.dob} onChange={e=>setForm(f=>({...f,dob:e.target.value}))} />
        <FSelect label="App Role" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
          <option value="student">Student</option>
          <option value="manager">Manager (* can update membership info)</option>
          <option value="instructor">Instructor (** full access)</option>
        </FSelect>
        <FSelect label="Member Status" value={form.memberStatus} onChange={e=>setForm(f=>({...f,memberStatus:e.target.value}))}>
          <option value="student">Student</option>
          <option value="alumni">Alumni</option>
          <option value="community">Community</option>
        </FSelect>
        <FSelect label="Current Belt" value={form.beltIndex} onChange={e=>setForm(f=>({...f,beltIndex:e.target.value}))}>
          {BELT_LEVELS.map((_,i)=><option key={i} value={i}>{beltDropdownLabel(i)}</option>)}
        </FSelect>
        <FInput label="Join Date" type="date" value={form.joinDate} onChange={e=>setForm(f=>({...f,joinDate:e.target.value}))} />
        <FInput label="Date Belt Was Achieved" type="date" value={form.beltAchievedDate} onChange={e=>setForm(f=>({...f,beltAchievedDate:e.target.value}))} />
        <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:14,marginTop:4}}>
          <div style={{fontSize:12,color:"#C8A04A",fontWeight:700,marginBottom:10,letterSpacing:"0.08em",textTransform:"uppercase"}}>💰 Fees</div>
          <FSelect label="Membership Fee Type" value={form.membershipFeeType} onChange={e=>setForm(f=>({...f,membershipFeeType:e.target.value}))}>{MEMBERSHIP_FEE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</FSelect>
          <FeeField label="Membership Fee" value={form.membershipFee} onChange={v=>setForm(f=>({...f,membershipFee:v}))} waived={form.membershipFeeWaived||false} onWaive={w=>setForm(f=>({...f,membershipFeeWaived:w}))} />
          <FSelect label="AAKF Fee Type" value={form.aakfType} onChange={e=>setForm(f=>({...f,aakfType:e.target.value}))}>
            <option value="new">New Member</option>
            <option value="returning">Returning Member</option>
          </FSelect>
          <FeeField label="AAKF Fee" value={form.aakfFee} onChange={v=>setForm(f=>({...f,aakfFee:v}))} />
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:"1px solid rgba(255,255,255,0.1)"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600}}>Member Status</div>
            <div style={{fontSize:11,color:"#bbb"}}>New members are Active by default</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            {[true,false].map(v=>(
              <button key={String(v)} type="button" onClick={()=>setForm(f=>({...f,isActive:v}))} style={{background:form.isActive===v?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:form.isActive===v?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:form.isActive===v?"#C8A04A":"#666",padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                {v?"Active":"Inactive"}
              </button>
            ))}
          </div>
        </div>
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
          <strong>How it works:</strong><br/>
          • If email matches an existing student → fills in any <em>missing</em> fields only (never overwrites existing data)<br/>
          • If email is not found → creates a new student and sends welcome email<br/><br/>
          <strong>Column headers (first row):</strong><br/>
          <code style={{fontSize:11,lineHeight:1.8}}>
            name, email, phone, dob, beltIndex, joinDate, beltAchievedDate,<br/>
            memberStatus, membershipFeeType, membershipFeePaid, membershipFeeMethod,<br/>
            aakfType, aakfFeePaid, aakfFeeMethod
          </code><br/><br/>
          <strong>Values:</strong><br/>
          <code style={{fontSize:11,lineHeight:1.8}}>
            beltIndex: 0=White 1=Orange 2=Red 3=Green 4=Purple 5=Purple II 6=Brown 7=Brown II 8=Brown III 9=Shodan…<br/>
            memberStatus: student · alumni · community<br/>
            membershipFeeType: student · other<br/>
            membershipFeePaid / aakfFeePaid: yes · no<br/>
            membershipFeeMethod / aakfFeeMethod: cash · venmo · cashapp · other<br/>
            aakfType: new · returning
          </code><br/><br/>
          All columns are optional except <strong>email</strong> (and <strong>name</strong> for new students). Leave any column blank to skip it.
        </InfoBox>
        <div style={{marginBottom:14}}>
          <label style={{display:"block",fontSize:12,color:"#C8A04A",marginBottom:4,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Upload CSV File</label>
          <input type="file" accept=".csv" onChange={e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(f); }} style={{color:"#fff",fontSize:13}} />
        </div>
        {csvText && (
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:10,marginBottom:14,fontSize:11,color:"#ccc",maxHeight:120,overflowY:"auto",fontFamily:"monospace"}}>
            {csvText.slice(0,500)}{csvText.length>500?"…":""}
          </div>
        )}
        <Btn onClick={handleCSVImport} disabled={busy||!csvText} style={{width:"100%"}}>{busy?"Importing…":"Import / Update Students"}</Btn>
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
        <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← All Members</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{s.name}</h2>
            {s.isActive===false && <span style={{fontSize:11,background:"rgba(156,163,175,0.2)",color:"#9ca3af",padding:"2px 8px",borderRadius:10,fontWeight:600,marginTop:4,display:"inline-block"}}>Inactive</span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
            {s.isActive===false && (
              <Btn variant="green" style={{fontSize:11,padding:"5px 10px"}} onClick={async()=>{
                await updateDoc(doc(db,"users",s.id),{isActive:true});
                const updated={...s,isActive:true};
                setStudents(prev=>prev.map(u=>u.id===s.id?updated:u));
                setSelected(updated);
                showToast(`✅ ${s.name} reactivated!`);
              }}>Reactivate</Btn>
            )}
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
                return <div style={{fontSize:11,color:"#ccc"}}>Code: {displayCode}</div>;
              })()}
            </div>
          </div>
          {s.beltAchievedDate&&<div style={{fontSize:11,color:"#ccc",marginBottom:8}}>Achieved: {s.beltAchievedDate}</div>}
          {bi.next && (<>
            <ProgressBar percent={bi.progress} />
            <div style={{fontSize:12,color:"#ddd",marginTop:6}}>
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
            <Card key={l} style={{textAlign:"center",padding:12}}><div style={{fontSize:20,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:10,color:"#ccc"}}>{l}</div></Card>
          ))}
        </div>

        {/* Rank Exam History */}
        <Card style={{marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>🥋 Rank Examination History</div>
          {rankHistory.length===0
            ?<div style={{color:"#bbb",fontSize:13}}>No rank exams recorded yet.</div>
            :rankHistory.map((r,i)=>(
              <div key={i} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <span style={{fontSize:15,fontWeight:800,color:r.promoted?"#4ade80":"#f87171",marginRight:8}}>{r.code}</span>
                    <span style={{fontSize:12,color:"#ddd"}}>{r.beltTestedName}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:12,color:"#ccc"}}>{r.date}</div>
                    <div style={{fontSize:11,fontWeight:700,color:r.promoted?"#4ade80":"#f87171"}}>
                      {r.promoted?`✅ Promoted${r.levelsAdvanced>1?" (+2 levels)":""}`:"❌ Not promoted"}
                    </div>
                  </div>
                </div>
                <div style={{fontSize:11,color:"#bbb",marginTop:2}}>
                  {r.result==="S"?"Satisfactory":"Exceeding"} — tested for {r.beltTestedName}
                </div>
              </div>
            ))
          }
        </Card>

        {/* Member Info */}
        {(()=>{
          const isInstr = s.role === "instructor";
          const feeAmt  = !isInstr ? getMembershipFeeAmount(s.membershipFeeType, dojoSettings) : null;
          const aakfRow = !isInstr ? getMemberAakfRow(s, dojoSettings) : null;
          return (
          <Card style={{marginBottom:12}}>
            <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>👤 Member Info</div>
            {[
              ["Email", s.email||"—"],
              ["Phone", s.phone||"—"],
              ["Date of Birth", s.dob||"—"],
              ["Member Status", s.memberStatus ? s.memberStatus.charAt(0).toUpperCase()+s.memberStatus.slice(1) : "Student"],
            ].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
                <span style={{color:"#ccc",flexShrink:0}}>{l}</span>
                <span style={{color:"#fff",wordBreak:"break-all",textAlign:"right",paddingLeft:8}}>{v}</span>
              </div>
            ))}
            <div style={{marginTop:10}}>
              {isInstr
              ? <div style={{fontSize:12,color:"#ccc",fontStyle:"italic",padding:"8px 0"}}>Fee not applicable for instructors.</div>
              : (<>
                  <FeeStatusDisplay label={getMembershipFeeLabel(s.membershipFeeType)} amount={feeAmt} fee={s.membershipFee} waived={s.membershipFeeWaived} border />
                  <FeeStatusDisplay label={aakfRow?.label+' (AAKF)'} amount={aakfRow?.amount} fee={s.aakfFee} waived={false} border={false} />
                </>)
            }
            </div>
          </Card>
          );
        })()}

        {/* Training Sessions */}
        <Card style={{marginBottom:12}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Training Sessions ({sessions.length})</div>
          {sessions.slice(0,15).map(td=>(
            <div key={td.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
              <span>{td.date}</span><span style={{color:"#C8A04A"}}>{td.durationHours}h</span>
            </div>
          ))}
          {sessions.length===0&&<div style={{color:"#bbb",fontSize:13}}>No sessions yet.</div>}
        </Card>

        {/* Events */}
        <Card>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Events Attended</div>
          {myEvents.map(ev=>{
            const p=ev.participants[s.id];
            const h=parseFloat(p.hoursAttended||ev.hours||0);
            const pts=h+getParticipantPtBonus(p,ev.isCompetition);
            return (
              <div key={ev.id} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontSize:14,fontWeight:600}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#ccc"}}>{ev.date} · {h}h</div>
                {getParticipantPlacements(p).map((pl,i)=><div key={i} style={{fontSize:12,color:"#C8A04A"}}>🏅 {pl.placement}{["st","nd","rd","th"][pl.placement-1]||"th"} place{pl.category?" — "+pl.category:""}</div>)}
                <div style={{fontSize:12,color:"#4ade80"}}>+{pts.toFixed(0)} pts</div>
              </div>
            );
          })}
          {myEvents.length===0&&<div style={{color:"#bbb",fontSize:13}}>No events yet.</div>}
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
        <FInput label="Phone Number" type="tel" value={selected.phone||""} onChange={e=>setSelected(s=>({...s,phone:e.target.value}))} placeholder="(612) 555-0100" />
        <FInput label="Date of Birth" type="date" value={selected.dob||""} onChange={e=>setSelected(s=>({...s,dob:e.target.value}))} />
        <FSelect label="App Role" value={selected.role||"student"} onChange={e=>setSelected(s=>({...s,role:e.target.value}))}>
          <option value="student">Student</option>
          <option value="manager">Manager (* can update membership info)</option>
          <option value="instructor">Instructor (** full access)</option>
        </FSelect>
        <FSelect label="Member Status" value={selected.memberStatus||"student"} onChange={e=>setSelected(s=>({...s,memberStatus:e.target.value}))}>
          <option value="student">Student</option>
          <option value="alumni">Alumni</option>
          <option value="community">Community</option>
        </FSelect>
        <FSelect label="Belt Level" value={selected.beltIndex} onChange={e=>setSelected(s=>({...s,beltIndex:Number(e.target.value)}))}>
          {BELT_LEVELS.map((_,i)=><option key={i} value={i}>{beltDropdownLabel(i)}</option>)}
        </FSelect>
        <FInput label="Join Date" type="date" value={selected.joinDate} onChange={e=>setSelected(s=>({...s,joinDate:e.target.value}))} />
        <FInput label="Belt Achieved Date" type="date" value={selected.beltAchievedDate||""} onChange={e=>setSelected(s=>({...s,beltAchievedDate:e.target.value}))} />
        <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:14,marginTop:4}}>
          <div style={{fontSize:12,color:"#C8A04A",fontWeight:700,marginBottom:10,letterSpacing:"0.08em",textTransform:"uppercase"}}>💰 Fees</div>
          <FSelect label="Membership Fee Type" value={selected.membershipFeeType||"student_year"} onChange={e=>setSelected(s=>({...s,membershipFeeType:e.target.value}))}>
            {MEMBERSHIP_FEE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </FSelect>
          <FeeField label="Membership Fee" value={selected.membershipFee||{paid:false,method:""}} onChange={v=>setSelected(s=>({...s,membershipFee:v}))} waived={selected.membershipFeeWaived||false} onWaive={w=>setSelected(s=>({...s,membershipFeeWaived:w}))} />
          <FSelect label="AAKF Fee Type" value={selected.aakfType||"new"} onChange={e=>setSelected(s=>({...s,aakfType:e.target.value}))}>
            <option value="new">New Member</option>
            <option value="returning">Returning Member</option>
          </FSelect>
          <FeeField label="AAKF Fee" value={selected.aakfFee||{paid:false,method:""}} onChange={v=>setSelected(s=>({...s,aakfFee:v}))} />
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:"1px solid rgba(255,255,255,0.1)"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600}}>Active Status</div>
            <div style={{fontSize:11,color:"#bbb"}}>Only instructor can reactivate</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            {[true,false].map(v=>(
              <button key={String(v)} type="button" onClick={()=>setSelected(s=>({...s,isActive:v}))} style={{background:(selected.isActive!==false)===v?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:(selected.isActive!==false)===v?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:(selected.isActive!==false)===v?"#C8A04A":"#666",padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
              {v?"Active":"Inactive"}
            </button>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:4}}>
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
      <div style={{fontSize:13,color:"#ccc",marginBottom:18}}>{student.name}</div>

      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{fontSize:12,color:"#ccc"}}>Current rank:</div>
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
                <div style={{fontSize:10,color:"#bbb",marginTop:2}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{fontSize:13,color:"#ccc",marginBottom:6}}>Result code: <span style={{fontSize:16,fontWeight:900,color:"#C8A04A"}}>{code}</span></div>
          <div style={{fontSize:13,color:"#ccc",marginBottom:4}}>Testing for: <span style={{color:"#fff",fontWeight:600}}>{targetBelt?.name} ({targetBelt?.kyu})</span></div>
          {promoted ? (
            <div style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:8,padding:"8px 12px",marginTop:8}}>
              <div style={{color:"#4ade80",fontWeight:700}}>✅ Will be promoted!</div>
              <div style={{fontSize:12,color:"#ddd",marginTop:2}}>
                {levelsAdvanced===2?"Advancing 2 levels (E — Exceeding)":"Advancing 1 level"} → <strong style={{color:"#fff"}}>{BELT_LEVELS[examBeltIndex]?.name}</strong>
              </div>
              <div style={{fontSize:11,color:"#ccc",marginTop:2}}>Training hours will reset from {examDate}</div>
            </div>
          ) : (
            <div style={{background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:8,padding:"8px 12px",marginTop:8}}>
              <div style={{color:"#f87171",fontWeight:700}}>❌ Not promoted</div>
              <div style={{fontSize:12,color:"#ddd",marginTop:2}}>
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

// ─── Members View (Manager role) ─────────────────────────────────────────────
function MembersView({ profile, students, setStudents, showToast, db, secondaryAuth, dojoSettings }) {
  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sortBy, setSortBy] = useState("last");
  const [addingNew, setAddingNew] = useState(false);

  const lastName  = n => n?.trim().split(" ").slice(-1)[0]||"";
  const firstName = n => n?.trim().split(" ")[0]||"";
  const roleMarker = s => s.role==="instructor"?"** ":s.role==="manager"?"* ":"";

  const sorted = [...students].sort((a,b)=>{
    if (sortBy==="rank")  return (a.beltIndex||0) - (b.beltIndex||0);
    if (sortBy==="first") return firstName(a.name).localeCompare(firstName(b.name));
    return lastName(a.name).localeCompare(lastName(b.name));
  });

  const saveEdit = async () => {
    if (!editForm) return;
    setBusy(true);
    const isSelf = editForm.id === profile.id;
    const updates = isSelf
      // Manager editing themselves: personal info only
      ? { phone: editForm.phone||"", dob: editForm.dob||"" }
      // Manager editing others: membership info only
      : {
          phone: editForm.phone||"",
          dob: editForm.dob||"",
          memberStatus: editForm.memberStatus||"student",
          membershipFeeType: editForm.membershipFeeType||"student_year",
          membershipFee: editForm.membershipFee||{paid:false,method:""},
          membershipFeeWaived: editForm.membershipFeeWaived||false,
          aakfType: editForm.aakfType||"new",
          aakfFee: editForm.aakfFee||{paid:false,method:""},
        };
    try {
      await updateDoc(doc(db,"users",editForm.id), updates);
      setStudents(prev=>prev.map(s=>s.id===editForm.id?{...s,...updates}:s));
      showToast("✅ Updated!");
      setSelected({...editForm,...updates});
      setEditForm(null);
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  // ── Edit form
  if (editForm) {
    const isSelf = editForm.id === profile.id;
    return (
      <div>
        <button onClick={()=>setEditForm(null)} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
        <h2 style={{margin:"0 0 6px",fontSize:20,fontWeight:800}}>{editForm.name}</h2>
        {isSelf && <InfoBox type="warn">You can only edit your personal info. Contact the instructor to change status or fees.</InfoBox>}
        <Card>
          <FInput label="Phone Number" type="tel" value={editForm.phone||""} onChange={e=>setEditForm(f=>({...f,phone:e.target.value}))} placeholder="(612) 555-0100" />
          <FInput label="Date of Birth" type="date" value={editForm.dob||""} onChange={e=>setEditForm(f=>({...f,dob:e.target.value}))} />
          {!isSelf && (<>
            <FSelect label="Member Status" value={editForm.memberStatus||"student"} onChange={e=>setEditForm(f=>({...f,memberStatus:e.target.value}))}>
              <option value="student">Student</option>
              <option value="alumni">Alumni</option>
              <option value="community">Community</option>
            </FSelect>
            <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:14,marginTop:4}}>
              <div style={{fontSize:12,color:"#C8A04A",fontWeight:700,marginBottom:10,letterSpacing:"0.08em",textTransform:"uppercase"}}>💰 Fees</div>
              <FSelect label="Membership Fee Type" value={editForm.membershipFeeType||"student_year"} onChange={e=>setEditForm(f=>({...f,membershipFeeType:e.target.value}))}>{MEMBERSHIP_FEE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</FSelect>
              <FeeField label="Membership Fee" value={editForm.membershipFee||{paid:false,method:""}} onChange={v=>setEditForm(f=>({...f,membershipFee:v}))} waived={editForm.membershipFeeWaived||false} onWaive={w=>setEditForm(f=>({...f,membershipFeeWaived:w}))} />
              <FSelect label="AAKF Fee Type" value={editForm.aakfType||"new"} onChange={e=>setEditForm(f=>({...f,aakfType:e.target.value}))}>
                <option value="new">New Member</option>
                <option value="returning">Returning Member</option>
              </FSelect>
              <FeeField label="AAKF Fee" value={editForm.aakfFee||{paid:false,method:""}} onChange={v=>setEditForm(f=>({...f,aakfFee:v}))} />
            </div>
          </>)}
          <Btn onClick={saveEdit} disabled={busy} style={{width:"100%",marginTop:4}}>{busy?"Saving…":"Save"}</Btn>
        </Card>
      </div>
    );
  }

  // ── Detail view
  if (selected) {
    const s = students.find(u=>u.id===selected.id)||selected;
    // Manager can edit students and themselves, but NOT other instructors
    const canEdit = s.id === profile.id || s.role !== "instructor";
    return (
      <div>
        <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← All Members</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:800}}>{roleMarker(s)}{s.name}</h2>
          {canEdit
            ? <Btn variant="ghost" onClick={()=>setEditForm({...s})} style={{fontSize:12,padding:"6px 14px"}}>Edit</Btn>
            : <span style={{fontSize:11,color:"#bbb"}}>Instructor — view only</span>
          }
        </div>
        <Card style={{marginBottom:12}}>
          <BeltBadge beltIndex={s.beltIndex||0} size="lg" />
        </Card>
        <Card>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>👤 Membership</div>
          {[
            ["Email", s.email||"—"],
            ["Phone", s.phone||"—"],
            ["Date of Birth", s.dob||"—"],
            ["Status", s.memberStatus ? s.memberStatus.charAt(0).toUpperCase()+s.memberStatus.slice(1) : "Student"],
            ["App Role", s.role==="instructor"?"** Instructor":s.role==="manager"?"* Manager":"Student"],
            ["Member Since", s.joinDate||"—"],
          ].map(([l,v])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
              <span style={{color:"#ccc",flexShrink:0}}>{l}</span>
              <span style={{color:"#fff",wordBreak:"break-all",textAlign:"right",paddingLeft:8}}>{v}</span>
            </div>
          ))}
          {(()=>{
            const isInstr = s.role === "instructor";
            const feeAmt  = !isInstr ? getMembershipFeeAmount(s.membershipFeeType, dojoSettings) : null;
            const aakfRow = !isInstr ? getMemberAakfRow(s, dojoSettings) : null;
            return (
            <div style={{marginTop:10}}>
              {isInstr
              ? <div style={{fontSize:12,color:"#ccc",fontStyle:"italic",padding:"8px 0"}}>Fee not applicable for instructors.</div>
              : (<>
                  <FeeStatusDisplay label={getMembershipFeeLabel(s.membershipFeeType)} amount={feeAmt} fee={s.membershipFee} waived={s.membershipFeeWaived} border />
                  <FeeStatusDisplay label={aakfRow?.label+' (AAKF)'} amount={aakfRow?.amount} fee={s.aakfFee} waived={false} border={false} />
                </>)
            }
            </div>
            );
          })()}
        </Card>
      </div>
    );
  }

  // ── Add member (manager can add new members)
  if (addingNew) {
    return <ManagerAddMember db={db} secondaryAuth={secondaryAuth} students={students} setStudents={setStudents} showToast={showToast} onBack={()=>setAddingNew(false)} />;
  }

  // ── List view
  // Non-paying card shown above the list
  const nonPayingSection = <NonPayingMembers students={students} dojoSettings={dojoSettings} />;
  const active   = sorted.filter(s => s.isActive !== false);
  const inactive = sorted.filter(s => s.isActive === false);
  const renderCard = s => (
    <Card key={s.id} style={{marginBottom:10,opacity:s.isActive===false?0.6:1}} onClick={()=>setSelected(s)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <span style={{fontWeight:700,fontSize:15}}>{roleMarker(s)&&<span style={{color:"#C8A04A"}}>{roleMarker(s)}</span>}{s.name}</span>
            {s.isActive===false&&<span style={{fontSize:10,background:"rgba(156,163,175,0.2)",color:"#9ca3af",padding:"1px 7px",borderRadius:10,fontWeight:600}}>Inactive</span>}
          </div>
          <BeltBadge beltIndex={s.beltIndex||0} />
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,marginLeft:14}}>
          <span style={{fontSize:12,fontWeight:700,color:s.membershipFee?.paid?"#4ade80":"#f87171"}}>{s.membershipFee?.paid?"✅":"❌"} Fee</span>
          <span style={{fontSize:12,fontWeight:700,color:s.aakfFee?.paid?"#4ade80":"#f87171"}}>{s.aakfFee?.paid?"✅":"❌"} AAKF</span>
        </div>
      </div>
    </Card>
  );
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Members ({students.length})</h2>
        <Btn onClick={()=>setAddingNew(true)} style={{fontSize:12,padding:"7px 12px"}}>+ Add</Btn>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["last","Last Name"],["first","First Name"],["rank","Rank"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSortBy(k)} style={{flex:1,background:sortBy===k?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:sortBy===k?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:sortBy===k?"#C8A04A":"#666",padding:"6px 4px",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      <div style={{fontSize:11,color:"#bbb",marginBottom:10}}>** Instructor &nbsp;· &nbsp;* Manager</div>
      {nonPayingSection}
      {active.length>0&&<><div style={{fontSize:11,color:"#4ade80",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>● Active ({active.length})</div>{active.map(renderCard)}</>}
      {inactive.length>0&&<><div style={{fontSize:11,color:"#9ca3af",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",margin:"16px 0 8px"}}>○ Inactive ({inactive.length})</div>{inactive.map(renderCard)}</>}
      {students.length===0&&<div style={{color:"#bbb",textAlign:"center",marginTop:40}}>No members yet.</div>}
    </div>
  );
}

// ─── Manager Add Member ───────────────────────────────────────────────────────
function ManagerAddMember({ db, secondaryAuth, students, setStudents, showToast, onBack }) {
  const [form, setForm] = useState({
    name:"", email:"", phone:"", dob:"",
    memberStatus:"student", membershipFeeType:"student",
    membershipFee:{paid:false,method:""}, aakfType:"new",
    aakfFee:{paid:false,method:""}, isActive:true,
  });
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (!form.name.trim()||!form.email.trim()) { showToast("Name and email required","error"); return; }
    setBusy(true);
    try {
      const tempPass = "Welcome@"+Math.floor(1000+Math.random()*9000);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email.trim(), tempPass);
      const uid = cred.user.uid;
      const today = getLocalToday();
      const p = {
        name:form.name.trim(), email:form.email.trim(), phone:form.phone.trim(),
        dob:form.dob, role:"student", beltIndex:0,
        joinDate:today, beltAchievedDate:today,
        memberStatus:form.memberStatus, membershipFeeType:form.membershipFeeType,
        membershipFee:form.membershipFee, membershipFeeWaived:form.membershipFeeWaived||false,
        aakfType:form.aakfType, aakfFee:form.aakfFee,
        isActive: form.isActive !== false,
        createdAt:serverTimestamp(),
      };
      await setDoc(doc(db,"users",uid),p);
      await sendPasswordResetEmail(secondaryAuth, form.email.trim());
      await signOut(secondaryAuth);
      setStudents(prev=>[...prev,{id:uid,...p}]);
      showToast(`✅ ${form.name} added! Welcome email sent.`);
      onBack();
    } catch(e) {
      showToast(e.code==="auth/email-already-in-use"?"Email already registered":e.message,"error");
    }
    setBusy(false);
  };

  return (
    <div>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#C8A04A",cursor:"pointer",marginBottom:16,fontSize:14}}>← Back</button>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>Add Member</h2>
      <Card>
        <FInput label="Full Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Member's full name" />
        <FInput label="Email" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="member@email.com" />
        <FInput label="Phone Number" type="tel" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="(612) 555-0100" />
        <FInput label="Date of Birth" type="date" value={form.dob} onChange={e=>setForm(f=>({...f,dob:e.target.value}))} />
        <FSelect label="Member Status" value={form.memberStatus} onChange={e=>setForm(f=>({...f,memberStatus:e.target.value}))}>
          <option value="student">Student</option>
          <option value="alumni">Alumni</option>
          <option value="community">Community</option>
        </FSelect>
        <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:14,marginTop:4}}>
          <div style={{fontSize:12,color:"#C8A04A",fontWeight:700,marginBottom:10,letterSpacing:"0.08em",textTransform:"uppercase"}}>💰 Fees</div>
          <FSelect label="Membership Fee Type" value={form.membershipFeeType} onChange={e=>setForm(f=>({...f,membershipFeeType:e.target.value}))}>{MEMBERSHIP_FEE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</FSelect>
          <FeeField label="Membership Fee" value={form.membershipFee} onChange={v=>setForm(f=>({...f,membershipFee:v}))} waived={form.membershipFeeWaived||false} onWaive={w=>setForm(f=>({...f,membershipFeeWaived:w}))} />
          <FSelect label="AAKF Fee Type" value={form.aakfType} onChange={e=>setForm(f=>({...f,aakfType:e.target.value}))}>
            <option value="new">New Member</option>
            <option value="returning">Returning Member</option>
          </FSelect>
          <FeeField label="AAKF Fee" value={form.aakfFee} onChange={v=>setForm(f=>({...f,aakfFee:v}))} />
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:"1px solid rgba(255,255,255,0.1)",marginTop:8}}>
          <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>Active Status</div><div style={{fontSize:11,color:"#bbb"}}>New members are Active by default</div></div>
          <div style={{display:"flex",gap:6}}>
            {[true,false].map(v=>(
              <button key={String(v)} type="button" onClick={()=>setForm(f=>({...f,isActive:v}))} style={{background:form.isActive===v?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:form.isActive===v?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:form.isActive===v?"#C8A04A":"#666",padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit"}}>
                {v?"Active":"Inactive"}
              </button>
            ))}
          </div>
        </div>
        <InfoBox type="info">A welcome email will be sent automatically.</InfoBox>
        <Btn onClick={handleAdd} disabled={busy} style={{width:"100%"}}>{busy?"Adding…":"Add Member & Send Email"}</Btn>
      </Card>
    </div>
  );
}

// ─── Non-Paying Members ───────────────────────────────────────────────────────
// Shared by ReportView (instructor) and MembersView (manager)
function NonPayingMembers({ students, dojoSettings }) {
  const [expanded, setExpanded] = useState(true);

  const nonPaying = students.filter(s =>
    s.role !== 'instructor' &&
    s.isActive !== false &&
    !s.membershipFeeWaived &&
    !s.membershipFee?.paid
  ).sort((a,b) => a.name.localeCompare(b.name));

  const sendReminder = () => {
    const recipients = nonPaying.filter(s => s.email);
    if (!recipients.length) { alert('No email addresses found for non-paying members.'); return; }
    const bcc     = recipients.map(s => s.email).join(',');
    const subject = encodeURIComponent('Membership Fee Reminder — Traditional Karatedo Academy at UMN');
    const body    = encodeURIComponent(
`Dear Karateka,

This is a friendly reminder that your membership fee for Traditional Karatedo Academy at UMN has not yet been received for the current semester.

Please arrange payment at your earliest convenience. We accept Cash, Venmo, and CashApp.

If you have already paid or have questions about your account, please contact your instructor.

We appreciate your continued commitment to the club and look forward to seeing you on the mat!

Osu!

Traditional Karatedo Academy at UMN`);
    window.open(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${subject}&body=${body}`);
  };

  return (
    <Card style={{marginBottom:14,border:'1px solid rgba(248,113,113,0.3)'}}>
      {/* Collapsible header */}
      <div onClick={()=>setExpanded(e=>!e)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',marginBottom:expanded?12:0}}>
        <div>
          <span style={{fontWeight:700,color:'#f87171'}}>💰 Non-Paying Active Members</span>
          <span style={{marginLeft:8,background:'rgba(248,113,113,0.2)',color:'#f87171',fontSize:11,fontWeight:700,padding:'1px 8px',borderRadius:10}}>{nonPaying.length}</span>
        </div>
        <span style={{color:'#f87171',fontSize:14,transform:expanded?'rotate(0deg)':'rotate(-90deg)',transition:'transform 0.2s'}}>⌄</span>
      </div>

      {expanded && (<>
        {nonPaying.length === 0 ? (
          <div style={{fontSize:13,color:'#4ade80',textAlign:'center',padding:'10px 0'}}>✅ All active members have paid!</div>
        ) : (<>
          {nonPaying.map(s => {
            const feeAmt = getMembershipFeeAmount(s.membershipFeeType, dojoSettings);
            return (
              <div key={s.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{s.name}</div>
                  <div style={{fontSize:11,color:'#bbb'}}>{getMembershipFeeLabel(s.membershipFeeType)}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#f87171'}}>{feeAmt ? `$${feeAmt} owed` : 'Unpaid'}</div>
                  <div style={{fontSize:10,color:'#bbb'}}>{s.memberStatus||'student'}</div>
                </div>
              </div>
            );
          })}
          <Btn onClick={sendReminder} variant="danger" style={{width:'100%',marginTop:12,fontSize:12}}>
            📧 Email Reminder to {nonPaying.filter(s=>s.email).length} Member{nonPaying.filter(s=>s.email).length!==1?'s':''}
          </Btn>
        </>)}
      </>)}
    </Card>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function ReportView({ students, trainingDays, events, dojoSettings, setStudents }) {
  const [sortBy,           setSortBy]           = useState("points");
  const [sortDir,          setSortDir]          = useState("desc");
  const [search,           setSearch]           = useState("");
  const [selectMode,       setSelectMode]       = useState(false);
  const [selectedIds,      setSelectedIds]      = useState(new Set());
  const [activeCollapsed,  setActiveCollapsed]  = useState(false);
  const [inactiveCollapsed,setInactiveCollapsed]= useState(false);

  // ── Period selector (mirrors Dashboard) ────────────────────────────────────
  const defaultMode = (dojoSettings?.semesters?.length > 0) ? "semester"
    : dojoSettings?.yearlyStart ? "yearly" : "alltime";
  const [periodMode,     setPeriodMode]     = useState(defaultMode);
  const [periodSemester, setPeriodSemester] = useState(0);
  const activeRange = getActiveRange(periodMode, dojoSettings, periodSemester);

  // ── Period ranges for per-column breakdown ─────────────────────────────────
  const today = getLocalToday();
  const semesters = dojoSettings?.semesters || [];
  const currentSem = semesters.find(s => today >= s.start && today <= s.end)
    || [...semesters].sort((a,b) => b.start.localeCompare(a.start))[0] || null;
  const yearRange = dojoSettings?.yearlyStart ? getYearlyRange(dojoSettings) : null;

  const lastName  = n => n?.trim().split(" ").slice(-1)[0]||"";
  const firstName = n => n?.trim().split(" ")[0]||"";

  const allRows = [...students].map(s=>{
    const st      = calcStats(s.id,trainingDays,events);
    const semSt   = currentSem
      ? calcStatsForRange(s.id,trainingDays,events,currentSem.start,currentSem.end)
      : null;
    const yearSt  = yearRange
      ? calcStatsForRange(s.id,trainingDays,events,yearRange.start,yearRange.end)
      : null;
    const periodSt = calcStatsForRange(s.id,trainingDays,events,activeRange.start,activeRange.end);
    return {
      ...s, ...st,
      semPts:    semSt?.totalPoints  || 0,
      yearPts:   yearSt?.totalPoints || 0,
      periodPts: periodSt.totalPoints,      // pts for the currently selected period
    };
  });

  const filtered = search
    ? allRows.filter(r=>r.name?.toLowerCase().includes(search.toLowerCase()))
    : allRows;

  const sorted = [...filtered].sort((a,b)=>{
    let cmp = 0;
    if (sortBy==="points") cmp = b.periodPts - a.periodPts;   // uses active period
    else if (sortBy==="rank")  cmp = (b.beltIndex||0) - (a.beltIndex||0);
    else if (sortBy==="last")  cmp = lastName(a.name).localeCompare(lastName(b.name));
    else if (sortBy==="first") cmp = firstName(a.name).localeCompare(firstName(b.name));
    return sortDir==="asc" ? -cmp : cmp;
  });

  const SORT_OPTS = [["points","Points"],["last","Last Name"],["first","First Name"],["rank","Rank"]];

  // Build a CSV row for one member
  const memberToCSV = r => {
    const belt = BELT_LEVELS[r.beltIndex||0];
    const escape = v => `"${String(v||"").replace(/"/g,'""')}"`;
    return [
      r.name, r.email||"", r.phone||"", r.dob||"",
      belt?.name||"", belt?.kyu||"",
      r.memberStatus||"student",
      r.membershipFeeType||"student",
      r.membershipFee?.paid?"Yes":"No", r.membershipFee?.method||"",
      r.aakfType||"new",
      r.aakfFee?.paid?"Yes":"No", r.aakfFee?.method||"",
      r.joinDate||"", r.beltAchievedDate||"",
      r.trainingPoints, r.trainingHours.toFixed(1),
      r.eventPoints.toFixed(1), r.totalPoints.toFixed(1),
      r.isActive===false?"Inactive":"Active",
    ].map(escape).join(",");
  };

  const CSV_HEADERS = [
    "Name","Email","Phone","DOB",
    "Belt","Kyu",
    "Member Status",
    "Membership Fee Type","Membership Fee Paid","Membership Fee Method",
    "AAKF Type","AAKF Fee Paid","AAKF Fee Method",
    "Join Date","Belt Achieved Date",
    "Sessions","Hours","Event Points","Total Points","Active Status",
  ].join(",");

  const downloadCSV = (rows, filename) => {
    const csv = [CSV_HEADERS, ...rows.map(memberToCSV)].join("\n");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll      = () => downloadCSV(sorted, `dojo-report-${getLocalToday()}.csv`);
  const exportActive   = () => downloadCSV(sorted.filter(r=>r.isActive!==false), `dojo-active-${getLocalToday()}.csv`);
  const exportInactive = () => downloadCSV(sorted.filter(r=>r.isActive===false),  `dojo-inactive-${getLocalToday()}.csv`);
  const exportSelected = () => {
    const sel = sorted.filter(r=>selectedIds.has(r.id));
    if (!sel.length) { alert("No members selected."); return; }
    downloadCSV(sel, `dojo-selected-${getLocalToday()}.csv`);
    setSelectMode(false); setSelectedIds(new Set());
  };

  const toggleSelect = id => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Auto-select students with 0 activity in the past 14 days (ignore instructors)
  const selectInactive2Weeks = () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const qualifying = allRows.filter(r => {
      if (r.role === "instructor") return false;
      const last = getLastActivity(r.id, trainingDays, events);
      return !last || last < cutoffStr;
    });
    setSelectedIds(new Set(qualifying.map(r => r.id)));
    setSelectMode(true);
  };

  // Send encouraging email via mailto to selected members (BCC for privacy)
  const sendEncouragingEmail = () => {
    const recipients = sorted.filter(r => selectedIds.has(r.id) && r.email && r.role !== "instructor");
    if (!recipients.length) { alert("No members with email addresses selected."); return; }
    const bcc  = recipients.map(r => r.email).join(",");
    const subject = encodeURIComponent("We Missed You at Traditional Karatedo Academy at UMN Training!");
    const body = encodeURIComponent(
`Dear Karateka,

We noticed you haven't been at club training recently, and we wanted to reach out personally to let you know — we missed you!

Training is a journey, not a sprint. Whether life has been busy with school, work, or other commitments, we completely understand. What matters is that you know the door is always open and your fellow students are always ready to train alongside you.

Even one class can re-ignite that energy. Come back, bow in, and remember why you started.

We look forward to seeing you at Traditional Karatedo Academy at UMN training very soon.

Osu!

Traditional Karatedo Academy at UMN`);
    window.open(`mailto:?bcc=${encodeURIComponent(bcc)}&subject=${subject}&body=${body}`);
  };

  const copyReport=()=>{
    const activeRows   = sorted.filter(r => r.isActive !== false);
    const inactiveRows = sorted.filter(r => r.isActive === false);
    const formatRow = (r,i,showRank) => {
      const bi=getBeltProgress(r.beltIndex||0,r.joinDate,r.beltAchievedDate,r);
      const rank = showRank ? `#${i+1} ` : "     ";
      return `${rank}${r.name} | ${BELT_LEVELS[r.beltIndex||0].name} | ${r.periodPts.toFixed(0)} pts (${activeRange.label}) | ${r.trainingPoints} sessions | ${r.trainingHours.toFixed(1)}h | Total: ${r.totalPoints.toFixed(0)} pts\n    Progress: ${bi.next?(bi.isYearBased?`${bi.years?.toFixed(1)}/${bi.yearsRequired} yrs`:`${r.trainingHours.toFixed(1)}/${bi.hoursNeeded}h → ${bi.next.name}`):"Max rank"}`;
    };
    const lines=[
      "DOJO TRAINING REPORT",
      `${DOJO_NAME}`,
      `Generated: ${new Date().toLocaleDateString()} | Period: ${activeRange.label}`,
      "",
      `── ACTIVE MEMBERS (${activeRows.length}) ──`,
      ...activeRows.map((r,i)=>formatRow(r,i,true)),
      ...(inactiveRows.length>0 ? [
        "",
        `── INACTIVE MEMBERS (${inactiveRows.length}) ──`,
        ...inactiveRows.map((r,i)=>formatRow(r,i,false)),
      ] : []),
    ].join("\n");
    navigator.clipboard?.writeText(lines).then(()=>alert("Report copied!")).catch(()=>alert("Copy not supported"));
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800}}>Reports</h2>
        <Btn onClick={copyReport} variant="ghost" style={{fontSize:11,padding:"6px 10px"}}>📋 Copy</Btn>
      </div>

      <NonPayingMembers students={students} dojoSettings={dojoSettings} />
      {/* Action bar */}
      {!selectMode ? (
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",gap:6,marginBottom:6}}>
            <Btn onClick={exportAll}      variant="ghost" style={{fontSize:11,padding:"6px 8px",flex:1}}>📥 All</Btn>
            <Btn onClick={exportActive}   variant="ghost" style={{fontSize:11,padding:"6px 8px",flex:1}}>📥 Active</Btn>
            <Btn onClick={exportInactive} variant="ghost" style={{fontSize:11,padding:"6px 8px",flex:1}}>📥 Inactive</Btn>
          </div>
          <div style={{display:"flex",gap:6}}>
            <Btn onClick={()=>{ setSelectMode(true); setSelectedIds(new Set()); }} variant="ghost" style={{fontSize:11,padding:"6px 8px",flex:1}}>☑ Select</Btn>
            <Btn onClick={selectInactive2Weeks} variant="ghost" style={{fontSize:11,padding:"6px 8px",flex:1}}>⏱ 2-Wk Inactive</Btn>
          </div>
        </div>
      ) : (
        <div style={{marginBottom:14}}>
          <InfoBox type="info">Tap members to select/deselect. {selectedIds.size} selected.</InfoBox>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <Btn onClick={exportSelected} style={{fontSize:11,padding:"6px 10px",flex:1}}>📥 Export ({selectedIds.size})</Btn>
            <Btn onClick={sendEncouragingEmail} variant="green" style={{fontSize:11,padding:"6px 10px",flex:1}}>📧 Email ({selectedIds.size})</Btn>
            <Btn variant="ghost" onClick={()=>{ setSelectMode(false); setSelectedIds(new Set()); }} style={{fontSize:11,padding:"6px 10px",flex:1}}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Period selector — drives Points sort and copy */}
      <Card style={{marginBottom:12,padding:14}}>
        <div style={{fontSize:11,color:"#C8A04A",fontWeight:700,marginBottom:8,letterSpacing:"0.08em",textTransform:"uppercase"}}>📊 Points Period</div>
        <PeriodSelector dojoSettings={dojoSettings} mode={periodMode} setMode={setPeriodMode} selectedSemester={periodSemester} setSelectedSemester={setPeriodSemester} />
        <div style={{fontSize:11,color:"#ccc",textAlign:"center",marginTop:4}}>Sorting by points uses: <span style={{color:"#C8A04A",fontWeight:600}}>{activeRange.label}</span></div>
      </Card>

      {/* Search */}
      <div style={{position:"relative",marginBottom:10}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search by name…" style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"9px 14px",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}} />
        {search && <button onClick={()=>setSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#ccc",fontSize:16,cursor:"pointer"}}>✕</button>}
      </div>

      {/* Sort controls */}
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        {SORT_OPTS.map(([k,l])=>(
          <button key={k} onClick={()=>{ if(sortBy===k){setSortDir(d=>d==="asc"?"desc":"asc");}else{setSortBy(k);setSortDir(k==="points"||k==="rank"?"desc":"asc");} }} style={{flex:1,background:sortBy===k?"rgba(200,160,74,0.25)":"rgba(255,255,255,0.05)",border:sortBy===k?"1px solid rgba(200,160,74,0.6)":"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:sortBy===k?"#C8A04A":"#666",padding:"6px 2px",cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"inherit"}}>
            {l}{sortBy===k?(sortDir==="asc"?" ↑":" ↓"):""}
          </button>
        ))}
      </div>
      <div style={{fontSize:11,color:"#bbb",marginBottom:14,textAlign:"right"}}>{sorted.length} member{sorted.length!==1?"s":""}{search?` matching "${search}`:""}</div>

      {(()=>{
        const activeRows   = sorted.filter(r => r.isActive !== false);
        const inactiveRows = sorted.filter(r => r.isActive === false);

        const renderReportCard = (r, i, showRank) => {
          const bi = getBeltProgress(r.beltIndex||0,r.joinDate,r.beltAchievedDate,r);
          const isSelected = selectedIds.has(r.id);
          return (
            <Card key={r.id} style={{marginBottom:10,cursor:selectMode?"pointer":"default",border:isSelected?"1px solid rgba(200,160,74,0.7)":"1px solid rgba(255,255,255,0.1)",background:isSelected?"rgba(200,160,74,0.08)":"rgba(255,255,255,0.05)",opacity:r.isActive===false?0.75:1}} onClick={()=>selectMode&&toggleSelect(r.id)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  {selectMode && (
                    <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${isSelected?"#C8A04A":"rgba(255,255,255,0.3)"}`,background:isSelected?"#C8A04A":"transparent",display:"flex",alignItems:"center",justifyContent:"center",marginTop:2,flexShrink:0}}>
                      {isSelected&&<span style={{color:"#0a0a1a",fontSize:13,fontWeight:900,lineHeight:1}}>✓</span>}
                    </div>
                  )}
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      {!selectMode&&showRank&&<span style={{color:i<3?"#C8A04A":"#bbb",fontWeight:800}}>#{i+1}</span>}
                      <span style={{fontWeight:700}}>{r.name}</span>
                    </div>
                    <BeltBadge beltIndex={r.beltIndex||0} />
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:"#C8A04A",fontWeight:900,fontSize:20}}>{r.periodPts.toFixed(0)}</div>
                  <div style={{fontSize:10,color:"#bbb"}}>{activeRange.label}</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12,marginBottom:10}}>
                {[["Sessions",r.trainingPoints],["Hours",r.trainingHours.toFixed(1)+"h"],["Evt Pts",r.eventPoints.toFixed(0)]].map(([l,v])=>(
                  <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"6px 8px",textAlign:"center"}}><div style={{fontWeight:700,color:"#ddd"}}>{v}</div><div style={{color:"#bbb",fontSize:10}}>{l}</div></div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                {[
                  ["semester", currentSem?`Sem: ${currentSem.name}`:"Semester", r.semPts.toFixed(0), !!currentSem],
                  ["yearly",   yearRange?`Year: ${yearRange.name||"Acad."}`:"Acad. Year", r.yearPts.toFixed(0), !!yearRange],
                  ["alltime",  "Total", r.totalPoints.toFixed(0), true],
                ].map(([pid,l,v,hasData])=>{
                  const isActivePeriod = periodMode===pid;
                  return (
                    <div key={pid} style={{background:isActivePeriod?"rgba(200,160,74,0.18)":"rgba(255,255,255,0.04)",border:isActivePeriod?"1px solid rgba(200,160,74,0.5)":"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:"6px 8px",textAlign:"center"}}>
                      <div style={{fontWeight:800,color:hasData?isActivePeriod?"#E8C86A":"#C8A04A":"#bbb",fontSize:14}}>{hasData?v:"—"}</div>
                      <div style={{color:isActivePeriod?"#C8A04A":"#bbb",fontSize:9,marginTop:2,lineHeight:1.3}}>{l}</div>
                    </div>
                  );
                })}
              </div>
              {bi.next?(<><ProgressBar percent={bi.progress}/><div style={{fontSize:11,color:"#ccc",marginTop:4}}>{bi.isYearBased?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} yrs`:`${r.trainingHours.toFixed(1)}/${bi.hoursNeeded}h → ${bi.next.name}`}</div></>):<div style={{fontSize:12,color:"#C8A04A",fontWeight:700}}>🏆 Highest rank</div>}
            </Card>
          );
        };

        const SectionHeader = ({label, count, color, collapsed, onToggle}) => (
          <div onClick={onToggle} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none",padding:"6px 0",marginBottom:collapsed?0:8}}>
            <div style={{fontSize:11,color,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>{label} ({count})</div>
            <span style={{color,fontSize:14,display:"inline-block",transition:"transform 0.2s",transform:collapsed?"rotate(-90deg)":"rotate(0deg)"}}>⌄</span>
          </div>
        );
        return (<>
          {activeRows.length > 0 && (<>
            <SectionHeader label="● Active" count={activeRows.length} color="#4ade80" collapsed={activeCollapsed} onToggle={()=>setActiveCollapsed(c=>!c)} />
            {!activeCollapsed && activeRows.map((r,i) => renderReportCard(r,i,true))}
          </>)}
          {inactiveRows.length > 0 && (<>
            <div style={{paddingTop:activeRows.length>0&&!activeCollapsed?14:0,marginTop:activeRows.length>0?8:0,borderTop:activeRows.length>0?"1px solid rgba(255,255,255,0.08)":"none"}}>
              <SectionHeader label="○ Inactive" count={inactiveRows.length} color="#9ca3af" collapsed={inactiveCollapsed} onToggle={()=>setInactiveCollapsed(c=>!c)} />
              {!inactiveCollapsed && inactiveRows.map((r,i) => renderReportCard(r,i,false))}
            </div>
          </>)}
          {sorted.length===0&&<div style={{color:"#bbb",textAlign:"center",marginTop:40}}>{search?"No members match your search.":"No members yet."}</div>}
        </>);
      })()}
    </div>
  );
}

// ─── My Record ────────────────────────────────────────────────────────────────
function MyRecordView({ profile, trainingDays, events, dojoSettings, students }) {
  const defaultMode = (dojoSettings?.semesters?.length > 0) ? "semester"
    : dojoSettings?.yearlyStart ? "yearly" : "alltime";
  const [mode, setMode] = useState(defaultMode);
  const [selectedSemester, setSelectedSemester] = useState(0);
  const range = getActiveRange(mode, dojoSettings, selectedSemester);
  const { filteredTd, filteredEv } = filterByRange(trainingDays, events, range.start, range.end);
  const stats = calcStats(profile.id, filteredTd, filteredEv);
  const allTimeStats = calcStats(profile.id, trainingDays, events, profile.trainingResetDate);
  const bi = getBeltProgress(profile.beltIndex||0, profile.joinDate, profile.beltAchievedDate, allTimeStats, profile);
  const mySessions = filteredTd.filter(td=>td.attendees?.includes(profile.id));
  const myEvents = filteredEv.filter(ev=>ev.participants?.[profile.id]?.attended);

  return (
    <div>
      <h2 style={{margin:"0 0 18px",fontSize:22,fontWeight:800}}>My Record</h2>

      {/* Belt progress - always all time */}
      <Card style={{marginBottom:14,background:"linear-gradient(135deg,rgba(200,160,74,0.15),rgba(200,160,74,0.05))",border:"1px solid rgba(200,160,74,0.3)"}}>
        <BeltBadge beltIndex={profile.beltIndex||0} size="lg" />
        {profile.beltAchievedDate&&<div style={{fontSize:11,color:"#ccc",marginTop:4}}>Achieved: {profile.beltAchievedDate}</div>}
        <div style={{marginTop:12}}>
          {bi.next?(<>
            <div style={{fontSize:13,color:"#ddd",marginBottom:8}}>Progress to {bi.next.name}</div>
            <ProgressBar percent={bi.progress} />
            <div style={{fontSize:12,color:"#ccc",marginTop:6}}>
              {bi.isYearBased?`${bi.years?.toFixed(1)} of ${bi.yearsRequired} years since last promotion`:`${allTimeStats.trainingHours.toFixed(1)} of ${bi.hoursNeeded} hours (all time)`}
            </div>
          </>):<div style={{color:"#C8A04A",fontWeight:700,marginTop:8}}>🏆 Highest Rank Achieved!</div>}
        </div>
      </Card>

      {/* Member Info */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>👤 My Membership</div>
        {[
          ["Email", profile.email||"—"],
          ["Phone", profile.phone||"—"],
          ["Date of Birth", profile.dob||"—"],
          ["Status", profile.memberStatus ? profile.memberStatus.charAt(0).toUpperCase()+profile.memberStatus.slice(1) : "Student"],
          ["Member Since", profile.joinDate||"—"],
        ].map(([l,v])=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:13}}>
            <span style={{color:"#ccc",flexShrink:0}}>{l}</span>
            <span style={{color:"#fff",wordBreak:"break-all",textAlign:"right",paddingLeft:8}}>{v}</span>
          </div>
        ))}
        {(()=>{
          const isInstr = profile.role === "instructor";
          const feeAmt  = !isInstr ? getMembershipFeeAmount(profile.membershipFeeType, dojoSettings) : null;
          const aakfRow = !isInstr ? getMemberAakfRow(profile, dojoSettings) : null;
          return (
          <div style={{marginTop:10}}>
            {isInstr
              ? <div style={{fontSize:12,color:"#ccc",fontStyle:"italic",padding:"8px 0"}}>Fee not applicable for instructors.</div>
              : (<>
                  <FeeStatusDisplay label={getMembershipFeeLabel(profile.membershipFeeType)} amount={feeAmt} fee={profile.membershipFee} waived={profile.membershipFeeWaived} border />
                  <FeeStatusDisplay label={aakfRow?.label+' (AAKF)'} amount={aakfRow?.amount} fee={profile.aakfFee} waived={false} border={false} />
                </>)
            }
          </div>
          );
        })()}
      </Card>

      {/* Period selector */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>📊 View Period</div>
        <PeriodSelector dojoSettings={dojoSettings} mode={mode} setMode={setMode} selectedSemester={selectedSemester} setSelectedSemester={setSelectedSemester} />
        <div style={{fontSize:12,color:"#ccc",textAlign:"center"}}>Showing: <span style={{color:"#C8A04A",fontWeight:600}}>{range.label}</span>{range.start?` (${range.start} → ${range.end})`:""}</div>
      </Card>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        {[["Training Sessions",mySessions.length,"📅"],["Training Hours",stats.trainingHours.toFixed(1)+"h","⏱️"],["Event Points",stats.eventPoints.toFixed(0),"🏆"],["Total Points",stats.totalPoints.toFixed(0),"⭐"]].map(([l,v,ic])=>(
          <Card key={l} style={{textAlign:"center"}}><div style={{fontSize:28}}>{ic}</div><div style={{fontSize:22,fontWeight:900,color:"#C8A04A"}}>{v}</div><div style={{fontSize:11,color:"#ccc"}}>{l}</div></Card>
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
              {sub&&<div style={{fontSize:11,color:"#bbb"}}>{sub}</div>}
            </div>
            <div style={{fontSize:15,fontWeight:i===3?900:600,color:i===3?"#C8A04A":"#aaa"}}>{v}</div>
          </div>
        ))}
      </Card>

      {/* Training sessions */}
      <Card style={{marginBottom:14}}>
        <div style={{fontWeight:700,color:"#C8A04A",marginBottom:10}}>Training Sessions ({mySessions.length})</div>
        {mySessions.length===0
          ?<div style={{color:"#bbb",fontSize:13}}>No sessions in this period.</div>
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
          ?<div style={{color:"#bbb",fontSize:13}}>No events in this period.</div>
          :myEvents.map(ev=>{
            const p=ev.participants[profile.id];
            const h=parseFloat(p.hoursAttended||ev.hours||0);
            const placementPts=getParticipantPtBonus(p,ev.isCompetition);
            return (
              <div key={ev.id} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontSize:14,fontWeight:600}}>{ev.name}</div>
                <div style={{fontSize:12,color:"#ccc"}}>{ev.date}</div>
                <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,background:"rgba(74,222,128,0.15)",color:"#4ade80",padding:"2px 8px",borderRadius:6}}>+{h} attendance pts</span>
                  {getParticipantPlacements(p).map((pl,i)=><span key={i} style={{fontSize:12,background:"rgba(200,160,74,0.15)",color:"#C8A04A",padding:"2px 8px",borderRadius:6,marginRight:4}}>🏅 {pl.placement}{["st","nd","rd","th"][pl.placement-1]}{pl.category?" ("+pl.category+")":""} +{PLACEMENT_PTS[pl.placement-1]||0}pts</span>)}
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
          ?<div style={{color:"#bbb",fontSize:13}}>No rank exams recorded yet.</div>
          :[...(profile.rankHistory||[])].sort((a,b)=>b.date?.localeCompare(a.date)).map((r,i)=>(
            <div key={i} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <span style={{fontSize:18,fontWeight:900,color:r.promoted?"#4ade80":"#f87171",marginRight:10}}>{r.code}</span>
                  <span style={{fontSize:13,color:"#ddd"}}>{r.beltTestedName}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,color:"#ccc"}}>{r.date}</div>
                  <div style={{fontSize:11,fontWeight:700,color:r.promoted?"#4ade80":"#f87171"}}>
                    {r.promoted?`✅ Promoted${r.levelsAdvanced>1?" (+2 levels)":""}`:"❌ Not promoted"}
                  </div>
                </div>
              </div>
              <div style={{fontSize:11,color:"#bbb",marginTop:4}}>
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

// ─── Fee Schedule Editor ──────────────────────────────────────────────────────
function FeeScheduleEditor({ dojoSettings, setDojoSettings, db, showToast, canEdit }) {
  const liveFees  = getFeeSchedule(dojoSettings);
  const liveAakf  = getAakfFees(dojoSettings);
  const [editing, setEditing] = useState(false);
  const [fees,    setFees]    = useState(liveFees);
  const [aakf,    setAakf]    = useState(liveAakf);
  const [busy,    setBusy]    = useState(false);

  const startEdit = () => { setFees(liveFees); setAakf(liveAakf); setEditing(true); };
  const cancelEdit = () => setEditing(false);

  const saveFees = async () => {
    setBusy(true);
    try {
      await setDoc(doc(db,"settings","dojo"), { feeSchedule: fees, aakfFees: aakf }, { merge: true });
      setDojoSettings(s => ({ ...s, feeSchedule: fees, aakfFees: aakf }));
      setEditing(false);
      showToast("✅ Fee schedule saved!");
    } catch(e) { showToast("Error: "+e.message,"error"); }
    setBusy(false);
  };

  const updateFee = (i, field, val) => setFees(f => f.map((r,idx)=>idx===i?{...r,[field]:val}:r));
  const updateAakf = (i, val) => setAakf(f => f.map((r,idx)=>idx===i?{...r,amount:val}:r));

  return (
    <Card style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,color:"#C8A04A"}}>💰 Membership Fee Schedule</div>
        {canEdit && !editing && <Btn variant="ghost" onClick={startEdit} style={{fontSize:11,padding:"4px 12px"}}>Edit</Btn>}
      </div>

      {/* Membership fees table */}
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
        <thead>
          <tr>{["Member Type","Academic Year","Semester"].map(h=>(
            <th key={h} style={{textAlign:"left",padding:"5px 6px",borderBottom:"1px solid rgba(255,255,255,0.1)",color:"#C8A04A",fontWeight:700,fontSize:11}}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {(editing ? fees : liveFees).map((row,i)=>(
            <tr key={i}>
              <td style={{padding:"6px",borderBottom:"1px solid rgba(255,255,255,0.06)",color:"#ddd",fontSize:11}}>{row.label}</td>
              {editing ? (<>
                <td style={{padding:"4px 6px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><input value={row.academicYear} onChange={e=>updateFee(i,"academicYear",e.target.value)} style={{width:52,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(200,160,74,0.4)",borderRadius:6,padding:"3px 6px",color:"#fff",fontSize:12,fontFamily:"inherit",outline:"none"}} /></td>
                <td style={{padding:"4px 6px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><input value={row.semester} onChange={e=>updateFee(i,"semester",e.target.value)} style={{width:52,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(200,160,74,0.4)",borderRadius:6,padding:"3px 6px",color:"#fff",fontSize:12,fontFamily:"inherit",outline:"none"}} /></td>
              </>) : (<>
                <td style={{padding:"6px",borderBottom:"1px solid rgba(255,255,255,0.06)",color:"#4ade80",fontWeight:700}}>${row.academicYear}</td>
                <td style={{padding:"6px",borderBottom:"1px solid rgba(255,255,255,0.06)",color:"#4ade80",fontWeight:700}}>${row.semester}</td>
              </>)}
            </tr>
          ))}
        </tbody>
      </table>

      {/* AAKF fees */}
      <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:10}}>
        <div style={{fontSize:11,color:"#C8A04A",fontWeight:700,marginBottom:6}}>AAKF Registration Fee</div>
        {(editing ? aakf : liveAakf).map((f,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
            <span style={{fontSize:12,color:"#ddd"}}>{f.label}</span>
            {editing
              ? <input value={f.amount} onChange={e=>updateAakf(i,e.target.value)} style={{width:52,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(200,160,74,0.4)",borderRadius:6,padding:"3px 6px",color:"#fff",fontSize:12,fontFamily:"inherit",outline:"none",textAlign:"right"}} />
              : <span style={{color:"#4ade80",fontWeight:700,fontSize:12}}>${f.amount}</span>
            }
          </div>
        ))}
      </div>

      {editing && (
        <div style={{display:"flex",gap:10,marginTop:14}}>
          <Btn onClick={saveFees} disabled={busy} style={{flex:2}}>{busy?"Saving…":"Save Fee Schedule"}</Btn>
          <Btn variant="ghost" onClick={cancelEdit} style={{flex:1}}>Cancel</Btn>
        </div>
      )}
      {!canEdit && <div style={{fontSize:11,color:"#bbb",marginTop:8,textAlign:"center"}}>Contact your instructor to update fees.</div>}
    </Card>
  );
}

// ─── Venmo CSV Import ─────────────────────────────────────────────────────────
function parseVenmoCSV(text) {
  // Strip BOM and normalize line endings
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
  const lines = cleaned.split('\n');

  // Venmo exports have account-info rows before the real header.
  // Find the row that has both "from" and "type" column headers.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('from') && l.includes('type') && l.includes('amount')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) return { error: 'Could not find Venmo data headers. Make sure you exported a Venmo statement CSV from venmo.com → Settings → Statements.' };

  // Proper CSV row parser — handles quoted values containing commas
  const parseRow = line => {
    const vals = []; let cur = ''; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    return vals;
  };

  // Normalize header names: "Amount (total)" → "amounttotal"
  const headers = parseRow(lines[headerIdx]).map(h =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );
  const col = name => headers.indexOf(headers.find(h => h.includes(name)) || '');

  const fromCol    = col('from');
  const typeCol    = col('type');
  const statusCol  = col('status');
  const amtCol     = col('amounttotal') !== -1 ? headers.indexOf(headers.find(h=>h==='amounttotal')) : col('amount');
  const noteCol    = col('note');
  const dateCol    = col('datetime') !== -1 ? headers.indexOf(headers.find(h=>h.includes('datetime'))) : col('date');

  const payments = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseRow(line).map(v => v.replace(/^"|"$/g,'').trim());

    const type   = (vals[typeCol]   || '').toLowerCase();
    const status = (vals[statusCol] || '').toLowerCase();
    const amtRaw = vals[amtCol] || '';
    const amt    = parseFloat(amtRaw.replace(/[^0-9.-]/g, ''));
    const from   = vals[fromCol]  || '';

    // Include payments TO the account that are complete
    if (!type.includes('payment')) continue;
    if (status && !status.includes('complete')) continue;
    if (isNaN(amt) || amt <= 0) continue;   // negative = money sent out

    payments.push({
      from:   from,
      amount: amt,
      note:   vals[noteCol]  || '',
      date:   (vals[dateCol] || '').slice(0, 10),  // YYYY-MM-DD
    });
  }
  return { payments };
}

function matchVenmoToMember(venmoName, members) {
  if (!venmoName) return null;
  const vn = venmoName.toLowerCase().replace(/[-_]/g,' ').trim();
  const vParts = vn.split(/\s+/);
  const vFirst = vParts[0] || '';
  const vLast  = vParts[vParts.length - 1] || '';

  const scored = members
    .filter(m => m.role !== 'instructor')
    .map(m => {
      const mn     = m.name.toLowerCase().trim();
      const mParts = mn.split(/\s+/);
      const mFirst = mParts[0] || '';
      const mLast  = mParts[mParts.length - 1] || '';
      let score = 0;
      if (mn === vn)                                        score = 100;
      else if (mFirst === vFirst && mLast === vLast)        score = 90;
      else if (mn.includes(vn) || vn.includes(mn))         score = 80;
      else if (mLast === vLast && mLast.length > 2)         score = 65;
      else if (mFirst === vFirst && mFirst.length > 2)      score = 45;
      else if (vn.includes(mLast) || mLast.includes(vLast)) score = 30;
      return { member: m, score };
    })
    .filter(s => s.score >= 30)
    .sort((a,b) => b.score - a.score);

  return scored[0] || null;  // { member, score } or null
}

function VenmoImport({ students, db, setStudents, showToast, dojoSettings }) {
  // Auto-detect current semester start as default cutoff
  const today = getLocalToday();
  const semesters = dojoSettings?.semesters || [];
  const currentSem = semesters.find(s => today >= s.start && today <= s.end)
    || [...semesters].sort((a,b) => b.start.localeCompare(a.start))[0] || null;

  const [csvText,    setCsvText]    = useState('');
  const [feeTarget,  setFeeTarget]  = useState('membership');
  const [cutoffDate, setCutoffDate] = useState(currentSem?.start || '');
  const [decisions,  setDecisions]  = useState(null); // array of decision objects
  const [busy,       setBusy]       = useState(false);
  const [applied,    setApplied]    = useState(false);

  const handleFile = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => { setCsvText(ev.target.result); setDecisions(null); setApplied(false); };
    r.readAsText(f);
  };

  const handleParse = () => {
    const { payments, error } = parseVenmoCSV(csvText);
    if (error) { showToast(error, 'error'); return; }

    // Apply semester cutoff filter
    const filtered = cutoffDate
      ? payments.filter(p => !p.date || p.date >= cutoffDate)
      : payments;

    if (!filtered.length) {
      showToast(cutoffDate
        ? `No payments found on or after ${cutoffDate}. Try adjusting the date filter.`
        : 'No incoming payments found in this file.', 'error');
      return;
    }

    // Build unified decision list
    const memberList = [...students].filter(s => s.role !== 'instructor')
      .sort((a,b) => a.name.localeCompare(b.name));

    const built = filtered.map((p, i) => {
      const hit = matchVenmoToMember(p.from, memberList);
      return {
        ...p,
        key: i,
        autoMatch:        hit,               // { member, score } | null
        selectedMemberId: hit?.member.id || '', // editable
        included:         !!hit,             // auto-include matched, skip unmatched
      };
    });
    setDecisions(built);
    setApplied(false);
  };

  const update = (key, changes) =>
    setDecisions(prev => prev.map(d => d.key === key ? { ...d, ...changes } : d));

  const readyCount = (decisions||[]).filter(d => d.included && d.selectedMemberId).length;

  const handleApply = async () => {
    setBusy(true);
    const field = feeTarget === 'aakf' ? 'aakfFee' : 'membershipFee';
    const toCommit = decisions.filter(d => d.included && d.selectedMemberId);
    let count = 0;
    for (const d of toCommit) {
      const member = students.find(s => s.id === d.selectedMemberId);
      if (!member) continue;
      const upd = { [field]: { paid: true, method: 'venmo' } };
      try {
        await updateDoc(doc(db, 'users', member.id), upd);
        setStudents(prev => prev.map(s => s.id === member.id ? { ...s, ...upd } : s));
        count++;
      } catch(e) { console.error('Failed to update', member.name, e); }
    }
    showToast(`✅ ${count} member${count !== 1 ? 's' : ''} marked paid via Venmo!`);
    setApplied(true);
    setBusy(false);
  };

  const confColor = s => s >= 90 ? '#4ade80' : s >= 60 ? '#facc15' : '#fb923c';
  const confLabel = s => s >= 90 ? 'High' : s >= 60 ? 'Med' : 'Low';
  const sortedMembers = [...students].filter(s => s.role !== 'instructor').sort((a,b) => a.name.localeCompare(b.name));

  return (
    <Card style={{marginBottom:14,border:'1px solid rgba(200,160,74,0.3)'}}>
      <div style={{fontWeight:700,color:'#C8A04A',marginBottom:12}}>💸 Venmo Payment Import</div>

      {/* Fee target */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:'#C8A04A',fontWeight:600,marginBottom:6,letterSpacing:'0.08em',textTransform:'uppercase'}}>Apply to</div>
        <div style={{display:'flex',gap:6}}>
          {[['membership','Membership Fee'],['aakf','AAKF Fee']].map(([v,l])=>(
            <button key={v} onClick={()=>setFeeTarget(v)} style={{flex:1,background:feeTarget===v?'rgba(200,160,74,0.2)':'rgba(255,255,255,0.05)',border:feeTarget===v?'1px solid rgba(200,160,74,0.6)':'1px solid rgba(255,255,255,0.1)',borderRadius:8,color:feeTarget===v?'#C8A04A':'#bbb',padding:'7px',cursor:'pointer',fontSize:12,fontWeight:700,fontFamily:'inherit'}}>{l}</button>
          ))}
        </div>
      </div>

      {/* Semester date cutoff */}
      <div style={{marginBottom:12}}>
        <label style={{display:'block',fontSize:11,color:'#C8A04A',marginBottom:4,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase'}}>
          Only include payments on or after
        </label>
        <input type="date" value={cutoffDate} onChange={e=>setCutoffDate(e.target.value)}
          style={{width:'100%',background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',borderRadius:8,padding:'9px 14px',color:'#fff',fontSize:14,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}} />
        {currentSem && <div style={{fontSize:11,color:'#bbb',marginTop:4}}>Auto-set from {currentSem.name} ({currentSem.start})</div>}
        {!currentSem && <div style={{fontSize:11,color:'#bbb',marginTop:4}}>No semester configured — set a date or leave blank for all payments</div>}
      </div>

      <InfoBox type="info">
        Export from <strong>venmo.com → Settings → Statements → Download CSV</strong>.
      </InfoBox>

      {/* File upload */}
      <div style={{marginBottom:12}}>
        <label style={{display:'block',fontSize:12,color:'#C8A04A',marginBottom:4,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase'}}>Upload Venmo CSV</label>
        <input type="file" accept=".csv" onChange={handleFile} style={{color:'#fff',fontSize:13}} />
      </div>

      {csvText && !decisions && (
        <Btn onClick={handleParse} style={{width:'100%',marginBottom:4}}>🔍 Parse & Match Payments</Btn>
      )}

      {/* Decision list */}
      {decisions && !applied && (<>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,marginTop:4}}>
          <div style={{fontSize:12,color:'#bbb'}}>{decisions.length} payment{decisions.length!==1?'s':''} found{cutoffDate?` after ${cutoffDate}`:''}</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setDecisions(prev=>prev.map(d=>({...d,included:!!d.selectedMemberId})))} style={{background:'none',border:'none',color:'#4ade80',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>All ✅</button>
            <button onClick={()=>setDecisions(prev=>prev.map(d=>({...d,included:false})))} style={{background:'none',border:'none',color:'#f87171',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>None ❌</button>
          </div>
        </div>

        {decisions.map(d => {
          const assignedMember = d.selectedMemberId ? students.find(s=>s.id===d.selectedMemberId) : null;
          const isAutoMatch = d.autoMatch && d.selectedMemberId === d.autoMatch.member.id;
          const borderColor = d.included
            ? 'rgba(74,222,128,0.35)'
            : 'rgba(255,255,255,0.08)';
          const bgColor = d.included
            ? 'rgba(74,222,128,0.06)'
            : 'rgba(255,255,255,0.02)';

          return (
            <div key={d.key} style={{background:bgColor,border:`1px solid ${borderColor}`,borderRadius:10,padding:'10px 12px',marginBottom:8,opacity:d.included?1:0.55,transition:'all 0.15s'}}>
              {/* Row 1: toggle + name + amount */}
              <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                {/* Include/Skip toggle */}
                <button onClick={()=>update(d.key,{included:!d.included})} style={{flexShrink:0,background:'none',border:'none',fontSize:20,cursor:'pointer',lineHeight:1,marginTop:1,padding:0}}>
                  {d.included ? '✅' : '❌'}
                </button>
                <div style={{flex:1,minWidth:0}}>
                  {/* Venmo sender + date */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:'#fff'}}>{d.from || 'Unknown sender'}</div>
                      <div style={{fontSize:11,color:'#bbb'}}>
                        {d.date || ''}
                        {d.note ? <span style={{marginLeft:6,fontStyle:'italic'}}>"{d.note}"</span> : ''}
                      </div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                      <div style={{fontSize:15,fontWeight:800,color:d.included?'#4ade80':'#bbb'}}>${d.amount.toFixed(2)}</div>
                      {d.autoMatch && isAutoMatch && (
                        <div style={{fontSize:10,color:confColor(d.autoMatch.score)}}>{confLabel(d.autoMatch.score)} match</div>
                      )}
                    </div>
                  </div>
                  {/* Member assignment dropdown */}
                  <div style={{marginTop:8}}>
                    <select
                      value={d.selectedMemberId}
                      onChange={e=>update(d.key,{selectedMemberId:e.target.value,included:!!e.target.value})}
                      style={{width:'100%',background:'#1a1a2e',border:`1px solid ${d.selectedMemberId?'rgba(200,160,74,0.4)':'rgba(255,255,255,0.15)'}`,borderRadius:8,padding:'6px 10px',color:d.selectedMemberId?'#fff':'#bbb',fontSize:12,fontFamily:'inherit',outline:'none'}}
                    >
                      <option value="">— Assign to member —</option>
                      {sortedMembers.map(s=>(
                        <option key={s.id} value={s.id}>
                          {s.name}{d.autoMatch?.member.id===s.id?' ← auto-match':''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Summary + commit */}
        <div style={{background:'rgba(200,160,74,0.08)',border:'1px solid rgba(200,160,74,0.2)',borderRadius:10,padding:'10px 14px',marginTop:8,marginBottom:12}}>
          <div style={{fontSize:13,color:'#C8A04A',fontWeight:700}}>
            {readyCount} of {decisions.length} payment{decisions.length!==1?'s':''} will be committed
          </div>
          <div style={{fontSize:11,color:'#bbb',marginTop:2}}>
            {feeTarget==='aakf'?'AAKF Fee':'Membership Fee'} → Paid · Venmo
          </div>
          {decisions.filter(d=>d.included&&!d.selectedMemberId).length > 0 && (
            <div style={{fontSize:11,color:'#fb923c',marginTop:4}}>
              ⚠️ {decisions.filter(d=>d.included&&!d.selectedMemberId).length} included row{decisions.filter(d=>d.included&&!d.selectedMemberId).length!==1?'s':''} missing a member assignment — they will be skipped
            </div>
          )}
        </div>
        <Btn onClick={handleApply} disabled={busy||readyCount===0} style={{width:'100%'}}>
          {busy ? 'Committing…' : `Commit ${readyCount} Payment${readyCount!==1?'s':''}`}
        </Btn>
      </>)}

      {applied && (
        <div style={{marginTop:8}}>
          <InfoBox type="success">Import complete! Upload another CSV to continue.</InfoBox>
          <Btn variant="ghost" onClick={()=>{setCsvText('');setDecisions(null);setApplied(false);}} style={{width:'100%',marginTop:6}}>Import Another CSV</Btn>
        </div>
      )}
    </Card>
  );
}

// ─── Activity Checker ─────────────────────────────────────────────────────────
function ActivityChecker({ students, setStudents, trainingDays, events, db, showToast }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const runCheck = async () => {
    setBusy(true);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INACTIVE_DAYS);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const toFlag = [];
    const toKeep = [];

    students.forEach(s => {
      if (s.role === "instructor") return; // never auto-flag instructors
      const last = getLastActivity(s.id, trainingDays, events);
      const autoInactive = !last || last < cutoffStr;
      if (autoInactive && s.isActive !== false) toFlag.push(s);
      else toKeep.push(s);
    });

    // Update Firestore and local state for all flagged members
    for (const s of toFlag) {
      await updateDoc(doc(db,"users",s.id), { isActive: false });
      setStudents(prev=>prev.map(u=>u.id===s.id?{...u,isActive:false}:u));
    }

    setResult({ flagged: toFlag.length, names: toFlag.map(s=>s.name) });
    showToast(toFlag.length > 0
      ? `Marked ${toFlag.length} member${toFlag.length>1?"s":""} Inactive`
      : "All members are active — no changes made"
    );
    setBusy(false);
  };

  return (
    <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.3)"}}>
      <div style={{fontWeight:700,color:"#C8A04A",marginBottom:8}}>📋 Member Activity Check</div>
      <div style={{fontSize:12,color:"#ccc",marginBottom:12}}>
        Scans all members and marks anyone with no training or events in the past 9 months as Inactive. Instructors are never auto-flagged.
      </div>
      {result && (
        <div style={{marginBottom:12}}>
          {result.flagged > 0
            ? <InfoBox type="warn">{result.flagged} member{result.flagged>1?"s":""} marked Inactive: {result.names.join(", ")}</InfoBox>
            : <InfoBox type="success">All members have recent activity — no changes made.</InfoBox>
          }
        </div>
      )}
      <Btn onClick={runCheck} disabled={busy} style={{width:"100%"}}>
        {busy?"Checking…":"Check Member Activity"}
      </Btn>
    </Card>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsView({ profile, setProfile, authUser, db, showToast, isInstructor, isManager, dojoSettings, setDojoSettings, students, setStudents, trainingDays, events }) {
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
          {yearlyForm.start && <div style={{fontSize:12,color:"#ccc",marginBottom:10}}>Period: {yearlyForm.start} → {(() => { const d=new Date(yearlyForm.start); d.setFullYear(d.getFullYear()+1); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; })()}</div>}
          <Btn onClick={saveYearly} style={{width:"100%"}}>Save Yearly Period</Btn>
        </Card>

        {/* Semesters */}
        <Card style={{marginBottom:14,border:"1px solid rgba(200,160,74,0.3)"}}>
          <div style={{fontWeight:700,color:"#C8A04A",marginBottom:12}}>🗓️ Semesters</div>
          {semesters.length===0
            ?<div style={{color:"#bbb",fontSize:13,marginBottom:12}}>No semesters added yet.</div>
            :semesters.map((s,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{s.name}</div>
                  <div style={{fontSize:11,color:"#ccc"}}>{s.start} → {s.end}</div>
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

      {/* Fee Schedule — display to all, editable by instructor/manager */}
      <FeeScheduleEditor dojoSettings={dojoSettings} setDojoSettings={setDojoSettings} db={db} showToast={showToast} canEdit={isInstructor||isManager} />

      {/* Venmo Payment Import — instructor only */}
      {isInstructor && (
        <VenmoImport students={students} setStudents={setStudents} db={db} showToast={showToast} dojoSettings={dojoSettings} />
      )}

      {/* Activity Check — instructor only */}
      {isInstructor && (
        <ActivityChecker students={students} setStudents={setStudents} trainingDays={trainingDays} events={events} db={db} showToast={showToast} />
      )}

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
        <div style={{fontSize:13,color:"#bbb"}}>Logged in as: <span style={{color:"#ddd"}}>{profile.email}</span></div>
        <div style={{fontSize:13,color:"#bbb",marginTop:4}}>Role: <span style={{color:profile.role==="instructor"?"#C8A04A":"#aaa",textTransform:"capitalize"}}>{profile.role}</span></div>
        <div style={{fontSize:13,color:"#bbb",marginTop:4}}>Member since: <span style={{color:"#ddd"}}>{profile.joinDate}</span></div>
      </Card>

      <div style={{textAlign:"center",marginTop:24,paddingBottom:8}}>
        <div style={{fontSize:11,color:"#fff",letterSpacing:"0.1em",textTransform:"uppercase"}}>{DOJO_NAME}</div>
      </div>
    </div>
  );
}
