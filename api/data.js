// Vercel Serverless Function — JobDiva Live Data API
// Returns processed recruiting metrics for the Talent Architect dashboard

const JOBDIVA_BASE_URL = (process.env.JOBDIVA_BASE_URL || 'https://api.jobdiva.com').trim().replace(/\/+$/, '');
const CLIENT_ID = (process.env.JOBDIVA_CLIENT_ID || '').trim();
const USERNAME = (process.env.JOBDIVA_USERNAME || '').trim();
const PASSWORD = (process.env.JOBDIVA_PASSWORD || '').trim();
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || '14', 10);

const JSM_FIRST_NAMES = ['shaily', 'akash', 'rahul', 'sahithya', 'vivek', 'shreerang', 'dhananjay', 'meenal'];

// Full-name mapping for abbreviated JobDiva last names
const NAME_MAP = {
  'Rahul K': 'Rahul Kanojiya',
  'Akash N': 'Akash Nair',
  'Shreerang T': 'Shreerang Tarte',
  'Mona P': 'Monoshree Pramanik',
};

function fullName(first, last) {
  const raw = `${first || ''} ${last || ''}`.trim();
  return NAME_MAP[raw] || raw || 'Unknown';
}

function initials(name) {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function isJSM(name) {
  const lower = name.toLowerCase();
  return JSM_FIRST_NAMES.some(r => lower.includes(r));
}

function isFlag(val) {
  if (val == null) return false;
  const s = String(val).trim().toLowerCase();
  return !['', '0', 'false', 'no', 'none', 'null'].includes(s);
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  const m = String(val).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]));
  return null;
}

function fmtDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = date.getFullYear();
  const HH = String(date.getHours()).padStart(2, '0');
  const MM = String(date.getMinutes()).padStart(2, '0');
  const SS = String(date.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yy} ${HH}:${MM}:${SS}`;
}

function dayOfWeekIndex(date) {
  // 0=Mon, 1=Tue, ..., 6=Sun
  return (date.getDay() + 6) % 7;
}

function weekStartMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? 6 : day - 1);
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── JobDiva API helpers ──

async function authenticate() {
  const params = new URLSearchParams({
    clientid: CLIENT_ID,
    username: USERNAME,
    password: PASSWORD,
  });
  const resp = await fetch(`${JOBDIVA_BASE_URL}/api/authenticate?${params}`);
  const body = await resp.text();

  // The JobDiva auth endpoint can return:
  // 1. A plain text token string (possibly quoted)
  // 2. A JSON string like "tokenvalue"
  // 3. A JSON object like {"token": "tokenvalue"}
  let token = null;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'string') {
      token = parsed;
    } else if (parsed && typeof parsed === 'object') {
      // Try common token field names
      token = parsed.token || parsed.Token || parsed.access_token || parsed.sessionId || parsed.id;
      if (!token) {
        // Try the first string value in the object
        for (const val of Object.values(parsed)) {
          if (typeof val === 'string' && val.length > 5) {
            token = val;
            break;
          }
        }
      }
    }
  } catch {
    // Not JSON — use raw body
    token = body;
  }

  if (token) {
    token = String(token).trim().replace(/^"|"$/g, '');
  }

  debugLog.push({ step: 'auth_detail', rawBodyLen: body.length, rawBodySample: body.slice(0, 100), tokenExtracted: token ? token.slice(0, 10) + '...' : null });

  return token;
}

const debugLog = [];

async function fetchRecords(token, endpoint, fromDt, toDt) {
  const all = [];
  let page = 0;
  const url0 = `${JOBDIVA_BASE_URL}${endpoint}?fromDate=${encodeURIComponent(fmtDate(fromDt))}&toDate=${encodeURIComponent(fmtDate(toDt))}&pageSize=500&pageNumber=0`;
  debugLog.push({ endpoint, fromDate: fmtDate(fromDt), toDate: fmtDate(toDt), url: url0.replace(/password=[^&]*/g, 'password=***') });

  while (true) {
    const params = new URLSearchParams({
      fromDate: fmtDate(fromDt),
      toDate: fmtDate(toDt),
      pageSize: '500',
      pageNumber: String(page),
    });
    const fetchUrl = `${JOBDIVA_BASE_URL}${endpoint}?${params}`;
    const resp = await fetch(fetchUrl, {
      headers: { Authorization: token },
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      debugLog.push({ error: `HTTP ${resp.status}`, endpoint, body: errBody.slice(0, 300) });
      break;
    }

    const bodyText = await resp.text();
    let result;
    try {
      result = JSON.parse(bodyText);
    } catch {
      debugLog.push({ error: 'JSON parse failed', body: bodyText.slice(0, 300) });
      break;
    }

    debugLog.push({
      endpoint,
      page,
      responseType: Array.isArray(result) ? 'array' : typeof result,
      hasData: result && result.data !== undefined,
      dataType: result && result.data ? (Array.isArray(result.data) ? 'array' : typeof result.data) : 'none',
      dataLength: result && Array.isArray(result.data) ? result.data.length : (Array.isArray(result) ? result.length : 0),
      message: result && result.message ? result.message.slice(0, 200) : null,
      sample: bodyText.slice(0, 200),
    });

    let raw = null;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      if (result.data === null || result.data === undefined) break;
      raw = result.data;
    } else if (Array.isArray(result)) {
      raw = result;
    }
    if (!raw || !Array.isArray(raw) || raw.length < 2) break;
    const headers = raw[0];
    const rows = raw.slice(1);
    rows.forEach(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : null; });
      all.push(obj);
    });
    if (rows.length < 500) break;
    page++;
  }
  return all;
}

// ── Data Processing ──

function processData(submittals, jobs) {
  const now = new Date();
  const fromDt = new Date(now);
  fromDt.setDate(fromDt.getDate() - LOOKBACK_DAYS);

  // Dedup submittals by ACTIVITYID
  const seenIds = new Set();
  const dedupSubs = [];
  for (const s of submittals) {
    const id = s.ACTIVITYID;
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    dedupSubs.push(s);
  }

  // Build job date lookup for TTS
  const jobDates = {};
  for (const j of jobs) {
    const jid = String(j.JOBID || '');
    for (const f of ['ISSUEDATE', 'DATECREATED', 'STARTDATE']) {
      const d = parseDate(j[f]);
      if (d) { jobDates[jid] = d; break; }
    }
  }

  // Per-recruiter stats
  const recruiterMap = {};
  for (const s of dedupSubs) {
    const name = fullName(s.USERFIRSTNAME, s.USERLASTNAME);
    if (!recruiterMap[name]) {
      recruiterMap[name] = {
        name,
        initials: initials(name),
        isCore: isJSM(name),
        submittals: 0, interviews: 0, hires: 0, rejections: 0,
        internalSubs: 0, externalSubs: 0,
        uniqueJobs: new Set(), uniqueCompanies: new Set(), uniqueCandidates: new Set(),
        dates: [], rates: [], ttsDays: [],
        rejectionDetails: [], interviewDetails: [],
        timeline: [], clientMap: {},
      };
    }
    const r = recruiterMap[name];
    const candidate = `${s.CANDIDATEFIRSTNAME || ''} ${s.CANDIDATELASTNAME || ''}`.trim();
    const role = s.JOBTITLE || 'Unknown';
    const client = s.COMPANYNAME || 'Unknown';
    const subDate = parseDate(s.SUBMITTALDATE || s.DATECREATED);

    if (isFlag(s.INTERNALSUBMITTALFLAG) || isFlag(s.EXTERNALSUBMITTALFLAG)) r.submittals++;
    if (isFlag(s.INTERNALSUBMITTALFLAG)) r.internalSubs++;
    if (isFlag(s.EXTERNALSUBMITTALFLAG)) r.externalSubs++;

    // Determine status for timeline
    let status = 'submitted';
    if (isFlag(s.INTERVIEWFLAG)) {
      status = 'interview';
      r.interviews++;
      r.interviewDetails.push({
        candidate, role, client,
        date: s.INTERVIEWDATE || s.INTERVIEWSCHEDULEDATE || '',
        scheduleDate: s.INTERVIEWSCHEDULEDATE || '',
      });
    }
    if (isFlag(s.HIREFLAG)) { status = 'hired'; r.hires++; }
    if (isFlag(s.REJECTFLAG)) {
      status = 'rejected';
      r.rejections++;
      r.rejectionDetails.push({
        candidate, role, client,
        reason: s.REJECTREASON || 'No reason given',
      });
    }

    // Timeline entry
    r.timeline.push({
      candidate, role, client, status,
      date: subDate ? subDate.toISOString() : null,
      reason: s.REJECTREASON || null,
      interviewDate: s.INTERVIEWDATE || s.INTERVIEWSCHEDULEDATE || null,
    });

    // Client tracking
    if (client !== 'Unknown') {
      if (!r.clientMap[client]) r.clientMap[client] = 0;
      r.clientMap[client]++;
    }

    if (s.JOBID) r.uniqueJobs.add(s.JOBID);
    if (s.COMPANYNAME) r.uniqueCompanies.add(s.COMPANYNAME);
    if (s.CANDIDATEID) r.uniqueCandidates.add(s.CANDIDATEID);

    if (subDate) r.dates.push(subDate);

    try {
      const rate = parseFloat(s.AGREEDBILLRATE || 0);
      if (rate > 0 && rate <= 500) r.rates.push(rate);
    } catch {}

    // Time-to-submittal
    const jid = String(s.JOBID || '');
    if (jid && jobDates[jid] && subDate) {
      const days = Math.max(0, Math.round((subDate - jobDates[jid]) / 86400000));
      r.ttsDays.push(days);
    }
  }

  // Serialize sets and compute derived metrics
  const allRecruiters = Object.values(recruiterMap).map(r => {
    const daysActive = new Set(r.dates.map(d => d.toISOString().slice(0, 10))).size;
    const avgTTS = r.ttsDays.length ? +(r.ttsDays.reduce((a, b) => a + b, 0) / r.ttsDays.length).toFixed(1) : null;
    const avgBillRate = r.rates.length ? Math.round(r.rates.reduce((a, b) => a + b, 0) / r.rates.length) : null;
    return {
      name: r.name,
      initials: r.initials,
      isCore: r.isCore,
      submittals: r.submittals,
      interviews: r.interviews,
      hires: r.hires,
      rejections: r.rejections,
      uniqueJobs: r.uniqueJobs.size,
      uniqueCompanies: r.uniqueCompanies.size,
      uniqueCandidates: r.uniqueCandidates.size,
      daysActive,
      avgTTS,
      avgBillRate,
      interviewConversion: r.submittals > 0 ? +((r.interviews / r.submittals) * 100).toFixed(1) : 0,
      rejectionDetails: r.rejectionDetails,
      interviewDetails: r.interviewDetails,
      timeline: r.timeline.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      clients: Object.entries(r.clientMap)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => ({ name, count })),
    };
  });

  // Top Submitters = top 4 by submittal count; rest go to "More Team Members"
  const sorted_by_subs = [...allRecruiters].sort((a, b) => b.submittals - a.submittals);
  const TOP_COUNT = 4;
  const coreRecruiters = sorted_by_subs.slice(0, TOP_COUNT);
  const extRecruiters = sorted_by_subs.slice(TOP_COUNT);

  // Totals
  const totalSubs = allRecruiters.reduce((s, r) => s + r.submittals, 0);
  const totalInts = allRecruiters.reduce((s, r) => s + r.interviews, 0);
  const totalHires = allRecruiters.reduce((s, r) => s + r.hires, 0);
  const totalRejects = allRecruiters.reduce((s, r) => s + r.rejections, 0);

  // Top performer (highest interviews, then submittals)
  const sorted = [...allRecruiters].sort((a, b) => {
    if (b.interviews !== a.interviews) return b.interviews - a.interviews;
    return b.submittals - a.submittals;
  });
  const topPerformer = sorted[0] || null;

  // TTS ranking (core team only, sorted fastest)
  const ttsRanking = coreRecruiters
    .filter(r => r.avgTTS !== null)
    .sort((a, b) => a.avgTTS - b.avgTTS)
    .map(r => ({
      name: r.name,
      avgDays: r.avgTTS,
      label: r.avgTTS === 0 ? 'SAME-DAY' : null,
      barWidth: r.avgTTS === 0 ? 2 : Math.min(100, Math.round((r.avgTTS / 8) * 100)),
      warning: r.avgTTS >= 5,
    }));

  // Daily activity (core team)
  const dailyMap = {};
  for (const r of Object.values(recruiterMap)) {
    if (!r.isCore) continue;
    for (const d of r.dates) {
      const key = d.toISOString().slice(0, 10);
      if (!dailyMap[key]) dailyMap[key] = { total: 0, detail: {} };
      dailyMap[key].total++;
      dailyMap[key].detail[r.name] = (dailyMap[key].detail[r.name] || 0) + 1;
    }
  }

  // Build weekly heatmap
  const weekMap = {};
  for (const [dateStr, info] of Object.entries(dailyMap)) {
    const d = new Date(dateStr + 'T12:00:00');
    const ws = weekStartMonday(d);
    const wKey = ws.toISOString().slice(0, 10);
    if (!weekMap[wKey]) weekMap[wKey] = { label: '', days: [0, 0, 0, 0, 0, 0, 0] };
    const dow = dayOfWeekIndex(d);
    weekMap[wKey].days[dow] = info.total;
  }

  // Also fill in weeks within the range that have no activity
  const cursor = new Date(weekStartMonday(fromDt));
  while (cursor <= now) {
    const wKey = cursor.toISOString().slice(0, 10);
    if (!weekMap[wKey]) weekMap[wKey] = { days: [0, 0, 0, 0, 0, 0, 0] };
    const m = cursor.toLocaleString('en-US', { month: 'short' });
    const d = cursor.getDate();
    weekMap[wKey].label = `${m} ${d}`;
    cursor.setDate(cursor.getDate() + 7);
  }

  const weeks = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  // Peak day
  let peakDay = null;
  let peakCount = 0;
  for (const [dateStr, info] of Object.entries(dailyMap)) {
    if (info.total > peakCount) {
      peakCount = info.total;
      const d = new Date(dateStr + 'T12:00:00');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
      const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const detail = Object.entries(info.detail).map(([n, c]) => `${n.split(' ')[0]}: ${c}`).join(', ');
      peakDay = { date: `${dayName} ${monthDay}`, count: peakCount, detail };
    }
  }

  // All rejections
  const allRejections = allRecruiters.flatMap(r =>
    r.rejectionDetails.map(d => ({ recruiter: r.name, ...d }))
  );

  // All interviews
  const allInterviews = allRecruiters.flatMap(r =>
    r.interviewDetails.map(d => ({ recruiter: r.name, ...d }))
  );

  // Activity feed (latest events across all recruiters)
  const activityFeed = allRecruiters
    .flatMap(r => r.timeline.map(t => ({ recruiter: r.name, ...t })))
    .filter(t => t.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15)
    .map(t => ({
      recruiter: t.recruiter,
      candidate: t.candidate,
      role: t.role,
      client: t.client,
      status: t.status,
      date: t.date,
    }));

  // Top companies
  const companyCount = {};
  for (const s of dedupSubs) {
    const co = s.COMPANYNAME || 'Unknown';
    companyCount[co] = (companyCount[co] || 0) + 1;
  }
  const topCompanies = Object.entries(companyCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Compute overall TTS avg
  const allTTS = Object.values(recruiterMap).flatMap(r => r.ttsDays);
  const avgTTSOverall = allTTS.length
    ? +(allTTS.reduce((a, b) => a + b, 0) / allTTS.length).toFixed(1)
    : null;

  // Format date range for display
  const fromStr = fromDt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const toStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const fromShort = fromDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const toShort = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return {
    meta: {
      lastUpdated: now.toISOString(),
      fromDate: fromStr,
      toDate: toStr,
      dateRangeShort: `${fromShort} \u2013 ${toShort}`,
      lookbackDays: LOOKBACK_DAYS,
    },
    totals: {
      submittals: totalSubs,
      interviews: totalInts,
      hires: totalHires,
      rejections: totalRejects,
      interviewRate: totalSubs > 0 ? +((totalInts / totalSubs) * 100).toFixed(1) : 0,
    },
    coreTeam: {
      totalSubmittals: coreRecruiters.reduce((s, r) => s + r.submittals, 0),
      recruiters: coreRecruiters,
    },
    extendedTeam: {
      totalSubmittals: extRecruiters.reduce((s, r) => s + r.submittals, 0),
      recruiters: extRecruiters,
    },
    topPerformer: topPerformer ? {
      name: topPerformer.name,
      initials: topPerformer.initials,
      submittals: topPerformer.submittals,
      interviews: topPerformer.interviews,
      conversion: topPerformer.interviewConversion,
      reason: (() => {
        const recruitersWithInterviews = allRecruiters.filter(r => r.interviews > 0);
        if (topPerformer.interviews > 0 && recruitersWithInterviews.length === 1) {
          return 'Only recruiter to secure interviews this period';
        } else if (topPerformer.interviews > 0) {
          return `Top interview performer (${topPerformer.interviews} interviews, ${topPerformer.interviewConversion}% conversion)`;
        }
        return 'Highest submittal volume this period';
      })(),
    } : null,
    ttsRanking,
    avgTTSOverall,
    dailyActivity: weeks,
    peakDay,
    rejections: allRejections,
    interviews: allInterviews,
    topCompanies,
    activityFeed,
  };
}

// ── Handler ──

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (!CLIENT_ID || !USERNAME || !PASSWORD) {
    return res.status(500).json({
      error: 'Missing JobDiva credentials. Set JOBDIVA_CLIENT_ID, JOBDIVA_USERNAME, JOBDIVA_PASSWORD in Vercel env vars.',
    });
  }

  try {
    const now = new Date();
    const fromDt = new Date(now);
    fromDt.setDate(fromDt.getDate() - LOOKBACK_DAYS);

    const token = await authenticate();
    if (!token || token.length < 5) {
      return res.status(401).json({ error: 'JobDiva authentication failed' });
    }

    debugLog.length = 0;

    const [submittals, jobs] = await Promise.all([
      fetchRecords(token, '/api/bi/NewUpdatedSubmittalInterviewHireActivityRecords', fromDt, now),
      fetchRecords(token, '/api/bi/NewUpdatedJobRecords', fromDt, now),
    ]);

    const data = processData(submittals, jobs);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
};
