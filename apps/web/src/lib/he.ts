/**
 * Single source of truth for user-facing Hebrew copy (Kursim-style convention).
 * No hardcoded strings in components — add keys here.
 */
export const he = {
  appName: "קשר",
  tagline: "בוט וואטסאפ שאוסף לידים וקובע פגישות מכירה",

  // auth
  login: "התחברות",
  register: "הרשמה",
  logout: "התנתקות",
  email: "אימייל",
  password: "סיסמה",
  orgName: "שם העסק",
  yourName: "השם שלך",
  loginCta: "התחבר",
  registerCta: "צור חשבון",
  haveAccount: "כבר יש לך חשבון?",
  noAccount: "אין לך חשבון עדיין?",
  authError: "האימייל או הסיסמה שגויים",
  emailTaken: "האימייל כבר רשום במערכת",

  // dashboard
  dashboard: "לוח בקרה",
  connections: "חיבורי וואטסאפ",
  flows: "בוטים (תסריטים)",
  leads: "לידים",
  appointments: "פגישות",
  welcome: "ברוך הבא",
  phase0Note:
    "שלד ראשוני (Phase 0) פעיל. השלב הבא: חיבור מספר וואטסאפ אמיתי (Phase 1).",

  // connections
  connectionsTitle: "חיבורי וואטסאפ",
  connectionsSubtitle: "חבר/י מספר וואטסאפ כדי שהבוט יתחיל לענות ללידים",
  addConnection: "הוסף חיבור",
  connectionLabel: "כינוי לחיבור (למשל: קו מכירות)",
  create: "צור",
  scanQr: "סרוק/י את הקוד באפליקציית וואטסאפ ← מכשירים מקושרים ← קישור מכשיר",
  waiting: "ממתין לקוד…",
  connect: "חבר",
  reconnect: "חבר מחדש",
  disconnect: "נתק",
  backToDashboard: "→ חזרה ללוח הבקרה",
  noConnections: "עדיין אין חיבורים. הוסף/י אחד כדי להתחיל.",
  statusLabel: {
    PENDING: "ממתין",
    QR: "ממתין לסריקה",
    CONNECTED: "מחובר",
    DISCONNECTED: "מנותק",
    LOGGED_OUT: "נותק מהמכשיר",
  },

  // leads / CRM
  leadsTitle: "לידים",
  leadsSubtitle: "כל מי שכתב לבוט — עם התשובות שנאספו",
  searchLeads: "חיפוש לפי שם או טלפון…",
  noLeads: "עדיין אין לידים. ברגע שמישהו יכתוב לבוט הוא יופיע כאן.",
  colName: "שם",
  colPhone: "טלפון",
  colTags: "תגיות",
  colCreated: "נוצר",
  colFields: "תשובות",
  backToLeads: "→ חזרה ללידים",
  leadDetails: "פרטי ליד",
  collectedFields: "תשובות שנאספו",
  transcript: "שיחה",
  noMessages: "אין הודעות עדיין",
  appointmentsTitle: "פגישות",
  appointmentsSubtitle: "פגישות מכירה שנקבעו דרך הבוט",
  noAppointments: "אין פגישות",
  upcoming: "הקרובות",
  past: "עברו",
  msgIn: "ליד",
  msgOut: "בוט",

  // flows
  flowsTitle: "בוטים (תסריטים)",
  flowsSubtitle: "התסריטים שהבוט מריץ מול לידים",
  noFlows: "אין תסריטים עדיין",
  active: "פעיל",
  inactive: "כבוי",
  colVersion: "גרסה",
  colSteps: "שלבים",
} as const;

export type HeKey = keyof typeof he;
