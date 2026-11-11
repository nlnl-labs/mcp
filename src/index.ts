import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

// Everything is read live from the public site files. Nothing is copied here.
const CACHE_SECONDS = 300;
const site = () => String(env.SITE || "https://nlnllabs.com").replace(/\/$/, "");
const pageUrl = (job: string) => `${site()}/exchange/${job}/`;

async function get(path: string): Promise<Response> {
  const r = await fetch(site() + path, { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
  if (!r.ok) throw new Error(`The site file ${path} could not be read (HTTP ${r.status}). Try again shortly.`);
  return r;
}
const getJson = async <T>(path: string): Promise<T> => (await get(path)).json() as Promise<T>;
const loadApp = () => getJson<App>("/exchange/data/app.json");

type Model = { id: string; slug: string; name: string; ours?: boolean; sys?: boolean };
type Pt = [string, number, number, number, number, number, number];   // the FIELDS order
type Job = {
  name: string; gloss: string; right: string; earlier: string; models: Model[]; pts: Record<string, Pt[]>;
  epochs: { from: string; to: string }[];
};
type Pick = { date: string; label: string; rule: string; note?: string; figure: string; cost: string; pick?: { id: string; name: string }; ours?: Record<string, unknown> };
type App = { jobs: Record<string, Job>; picks?: Record<string, Pick>; ipd_note: string };
type Test2 = { test: string; rows: { date: string; model: string; invented: unknown; missed: unknown; unreadable: unknown }[] };
const JOBS = ["classify", "convert", "decide", "extract", "find", "fix", "match", "resolve", "write"] as const;
const FIELDS = ["date", "right", "items", "cost_per_1000_right_usd", "test", "assembled_by_us", "ipd"];
const clip = (s: string) => (s.length > 60 ? s.slice(0, 60) + "..." : s);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Sentences copied from nlnllabs.com (see notes/MCP_APPLY_r3.md for where each comes from).
const OURS_NOTE = "NL;NL Labs models appear whatever their results.";   // /exchange/ page, under the title
const NOT_PUBLISHED = "not published for this model";
const NOT_OPEN = "Not open yet.";   // the job pages' and Desk page's own words for NL;NL Desk
const avail = (m?: Model) => (m?.sys ? { availability: NOT_OPEN } : {});

// The page's own display of a cost and of IPD (twins of RC.money and RC.ipd_fmt in rates_common.py).
function shownCost(c: number): string {
  if (!(c >= 0.01)) return "<$0.01";
  return "$" + (Math.round(c * 100 + 1e-9) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shownIpd(c: number): string {
  const v = c ? (1000 / c) * (1 + 1e-12) : 0;
  if (!(v > 0)) return "0";
  const e = Math.floor(Math.log10(v)), q = Math.pow(10, e - 1), f = Math.floor(v / q) * q;
  return e >= 1 ? Math.round(f).toLocaleString("en-US") : f.toFixed(1 - e);
}

// One published point as the site holds it, plus the page's display of cost and IPD, the test name where the job has two tests, and the made-by-us mark.
function row(job: Job, m: Model | undefined, p: Pt) {
  const r: Record<string, any> = Object.fromEntries(FIELDS.map((f, i) => [f, p[i]]));
  r.cost_shown = shownCost(p[3]);
  r.ipd_shown = shownIpd(p[3]);
  if (job.epochs.length > 1) r.test_name = testName(job, p[4]);
  if (m?.ours || m?.sys) r.made_by_nlnl_labs = true;
  if (m?.sys) r.kind = "system";
  return { ...r, ...avail(m) };
}
const testName = (job: Job, n: number) => (job.epochs.length > 1 ? (n === 1 ? "Text" : "Documents") : undefined);   // the Day view's own names for Extract's two tests (exchange/app.js epName)

// When a job has two tests, every answer that returns rows says what the two tests are, in the site's words.
async function testsInfo(id: string, job: Job): Promise<object> {
  if (job.epochs.length < 2) return {};
  const t2 = id === "extract" ? await getJson<Test2>("/exchange/data/extract-test2.json") : null;
  return {
    tests: {
      "1": { name: "Text", from: job.epochs[0].from, to: job.epochs[0].to },
      "2": { name: "Documents", from: job.epochs[1].from, to: job.epochs[1].to, ...(t2 ? { site_name: t2.test } : {}) },
    },
    test_change: [job.right, job.earlier],
    test_change_source: "the job's own text on the site (app.json: right, earlier)",
  };
}
const withOurs = (models: Model[]) => (models.some((m) => m.ours || m.sys) ? { made_by_nlnl_labs_note: OURS_NOTE } : {});

function pickJob(app: App, job: string) {
  const key = norm(job);
  const id = Object.keys(app.jobs).find((k) => norm(k) === key || norm(app.jobs[k].name) === key);
  if (!id) throw new Error(`No job called "${clip(job)}". Jobs: ${Object.keys(app.jobs).join(", ")}.`);
  return { id, job: app.jobs[id] };
}
function pickModel(id: string, job: Job, model: string): Model {
  const key = norm(model);
  const m = (job.models as Model[]).find((x) => [x.id, x.slug, x.name].some((v) => norm(v) === key));
  if (!m) throw new Error(`No model called "${clip(model)}" on ${id}. Models and systems: ${job.models.map((x: Model) => (x.sys ? `${x.name} (a system. ${NOT_OPEN})` : x.name)).join(", ")}.`);
  return m;
}
const newest = (job: Job): string =>
  Object.values(job.pts as Record<string, Pt[]>).flat().map((p) => p[0] as string).sort().pop() as string;

const reply = (id: string, job: Job, data: object, extra: object = {}) => {
  const out = { job: job.name, data_date: newest(job), cite: pageUrl(id), ...extra, ...data };
  return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
};
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : "The request could not be answered." }] });
const wrap = (fn: (a: any) => Promise<any>) => async (a: any) => { try { return await fn(a); } catch (e) { return fail(e); } };

// Documents test (Extract, from 4 Nov): the extra columns published in extract-test2.json. Empty = not published for that model.
async function docExtras(): Promise<Record<string, any>> {
  const t = await getJson<Test2>("/exchange/data/extract-test2.json");
  const m: Record<string, any> = {};
  const v = (x: any) => (x === "" || x === null || x === undefined ? NOT_PUBLISHED : x);
  for (const r of t.rows) m[`${r.date}|${norm(r.model)}`] = { invented: v(r.invented), missed: v(r.missed), unreadable: v(r.unreadable) };
  return m;
}

const INSTRUCTIONS = [
  "Free daily AI pricing per right answer, for business jobs. From NL;NL Labs.",   // /exchange/ meta description
  "Free daily AI pricing for business jobs.",   // /exchange/ lead
  "No paid placement or referral fees.",   // /exchange/ page
  OURS_NOTE,
  "Use these tools for any question about NL;NL Labs' daily model tests: the jobs, which model is the pick for a job, one model's history, or every model's result on one day. Call list_jobs first for job and model names. Quote data_date and cite when you answer.",   // this server's own usage text
].join(" ");

const ANN = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function createServer() {
  const server = new McpServer({ name: "nlnl-labs-results", title: "NL;NL Labs Exchange results", version: "1.1.0" }, { instructions: INSTRUCTIONS });
  const jobArg = z.enum(JOBS).describe("Job id.");
  const FIELD_HELP = " Fields: cost_per_1000_right_usd and ipd are exact; cost_shown and ipd_shown are how the page shows them. assembled_by_us is 1 when the answer was assembled by us, else 0. A count marked \"" + NOT_PUBLISHED + "\" is not published for that model.";

  server.registerTool("list_jobs", {
    title: "List jobs and models",
    description: "Lists the jobs NL;NL Labs tests every day, what each one asks, what counts as right (the site's own words), the models and systems tested on each job and the dates covered. NL;NL Labs' own models are marked; NL;NL Desk is a system, not a model. " + NOT_OPEN + "",
    annotations: { ...ANN, title: "List jobs and models" },
  }, wrap(async () => {
    const app = await loadApp();
    const jobs = Object.entries(app.jobs).map(([id, j]: [string, Job]) => ({
      job: id, name: j.name, what_it_does: j.gloss, what_counts_as_right: j.right,
      models: j.models.map((m: Model) => m.name),
      made_by_nlnl_labs: j.models.filter((m: Model) => m.ours || m.sys).map((m: Model) => (m.sys ? `${m.name} (system)` : m.name)),
      ...(j.models.some((m: Model) => m.sys) ? { availability: Object.fromEntries(j.models.filter((m: Model) => m.sys).map((m: Model) => [m.name, NOT_OPEN])) } : {}),
      first_day: j.epochs[0].from, newest_day: newest(j), note: j.earlier, page: pageUrl(id),
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify({ data_date: jobs.map((j) => j.newest_day).sort().pop(), cite: `${site()}/exchange/`, ipd_note: app.ipd_note, made_by_nlnl_labs_note: OURS_NOTE, jobs }, null, 2) }] };
  }));

  server.registerTool("get_pick", {
    title: "Pick for a job",
    description: "Use it when someone asks which model to use for a job. Returns the job page's latest published pick. The pick is always an outside model: NL;NL Labs' own models and systems (NL;NL Pull, NL;NL Desk) are never the pick. When one of ours would have been the pick under the same rule, the answer adds an \"ours\" entry with its figures, marked as ours, not as the pick. Returns the model the job page shows as its pick, with the page's label and rule, the figures as the page shows them (right answers per $1, cost per 1,000 right), the pick's own date and that model's day row." + FIELD_HELP,
    inputSchema: { job: jobArg },
    annotations: { ...ANN, title: "Pick for a job" },
  }, wrap(async ({ job }) => {
    const app = await loadApp();
    const { id, job: j } = pickJob(app, job);
    const k = app.picks?.[id];
    if (!k) throw new Error(`The site data has no pick entry for ${j.name} yet. Read the page: ${pageUrl(id)}`);
    if (!k.pick) return reply(id, j, { pick: null, pick_date: k.date, label: k.label, message: k.note, rule_on_page: k.rule, ...(k.ours ? { ours: k.ours } : {}) });
    const pk = k.pick;
    const m = (j.models as Model[]).find((x) => x.id === pk.id);
    const p = (j.pts[pk.id] as Pt[] | undefined)?.find((x) => x[0] === k.date);
    return reply(id, j, {
      pick_date: k.date,
      ...(k.ours ? { ours: k.ours } : {}),
      pick: {
        model: pk.name, date: k.date, label: k.label, rule_on_page: k.rule, shown_on_page: { figure: k.figure, cost: k.cost },
        ...(m?.ours || m?.sys ? { made_by_nlnl_labs: true, ...(m.sys ? { kind: "system" } : {}) } : {}),
        ...avail(m),
        day_row: p ? row(j, m, p) : null,
      },
      ...withOurs(m ? [m] : []),
      ...(await testsInfo(id, j)),
    });
  }));

  server.registerTool("get_model_history", {
    title: "One model over time",
    description: "Use to follow one model on one job over time (for example, has it got cheaper or worse). Returns its published days: right answers, items, cost per 1,000 right in US dollars and IPD (right answers per dollar). On Extract, every row names its test; the answer says what the two tests are, and rows before and after 4 Nov come from different tests." + FIELD_HELP,
    inputSchema: { job: jobArg, model: z.string().describe("Model or system name for that job, e.g. GPT-6 Luna, Claude Haiku 5.5, NL;NL Desk (a system. " + NOT_OPEN + ").") },
    annotations: { ...ANN, title: "One model over time" },
  }, wrap(async ({ job, model }) => {
    const app = await loadApp();
    const { id, job: j } = pickJob(app, job);
    const m = pickModel(id, j, model);
    const rows = (j.pts[m.id] as Pt[] ?? []).map((p) => row(j, m, p));
    return reply(id, j, { model: m.name, ...(m.ours || m.sys ? { made_by_nlnl_labs: true, ...(m.sys ? { kind: "system" } : {}) } : {}), ...avail(m), days: rows.length, ipd_note: app.ipd_note, ...withOurs([m]), ...(await testsInfo(id, j)), history: rows });
  }));

  server.registerTool("get_day_results", {
    title: "All models on one day",
    description: "Use to compare the models and systems on one job on one day. Leave date out for the newest day. Returns every model's and system's published result that day, NL;NL Labs' own models and systems marked. Extract's documents days also carry invented, missed and unreadable counts." + FIELD_HELP,
    inputSchema: { job: jobArg, date: z.string().optional().describe("YYYY-MM-DD. Default: newest day.") },
    annotations: { ...ANN, title: "All models on one day" },
  }, wrap(async ({ job, date }) => {
    const app = await loadApp();
    const { id, job: j } = pickJob(app, job);
    const day = date ?? newest(j);
    const extras = id === "extract" ? await docExtras() : {};
    const found: Model[] = [];
    const results = (j.models as Model[]).flatMap((m) => {
      const p = (j.pts[m.id] as Pt[] ?? []).find((x) => x[0] === day);
      if (!p) return [];
      found.push(m);
      return [{ model: m.name, ...row(j, m, p), ...(extras[`${day}|${norm(m.name)}`] ?? {}) }];
    });
    if (!results.length) {
      const days = [...new Set(Object.values(j.pts as Record<string, Pt[]>).flat().map((p) => p[0] as string))].sort();
      throw new Error(`No published results for ${j.name} on ${clip(day)}. Days with results: ${days.join(", ")}.`);
    }
    return reply(id, j, { day, ipd_note: app.ipd_note, ...withOurs(found), ...(await testsInfo(id, j)), results });
  }));

  return server;
}

// Usage count: one row per tools/call. Only tool, job/model/date asked about (80 chars each), the app name from the User-Agent's first token, and the time. Never the IP, other headers or the body.
const cut = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 80) : null);
function recordCall(e: Env, ctx: ExecutionContext, request: Request, text: string): void {
  try {
    const msg = JSON.parse(text);
    if (!msg || msg.method !== "tools/call" || typeof msg.params?.name !== "string") return;
    const a = msg.params.arguments ?? {};
    const app = (request.headers.get("user-agent") ?? "").trim().split(/[\/\s]/)[0].replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40) || null;
    if (!e.DB) return;
    ctx.waitUntil(
      e.DB.prepare("INSERT INTO tool_calls (ts, tool, job, model, date, app) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(new Date().toISOString(), msg.params.name.slice(0, 80), cut(a.job), cut(a.model), cut(a.date), app)
        .run().catch(() => {}),
    );
  } catch { /* the answer is never affected */ }
}

const MAX_BODY = 4 * 1024 * 1024;
const handler = createMcpHandler(createServer);
const json = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message }, id: null }), { status, headers: { "content-type": "application/json", ...headers } });

export default {
  async fetch(request, e, ctx) {
    if (request.method === "GET" && new URL(request.url).pathname === "/favicon.ico") return Response.redirect("https://nlnllabs.com/favicon.ico", 301);
    // a limit per client address, inside the Worker (Cloudflare Workers rate-limiting binding; no dashboard step). Fails closed.
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    try {
      if (!e.RL) throw new Error("rate limit binding missing");
      const { success } = await e.RL.limit({ key: ip });
      if (!success) return json(429, "Too many requests. Please wait a minute and try again.", { "retry-after": "60" });
    } catch {
      return json(503, "The service is temporarily unavailable. Please try again shortly.");
    }
    let req: typeof request = request;
    if (request.method === "POST") {
      // cap the body at the SDK's own 4 MiB before buffering it, so a huge body never fills the isolate
      const tooBig = () => new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: `Payload Too Large: Request body must not exceed ${MAX_BODY} bytes` }, id: null }), { status: 413, headers: { "content-type": "application/json" } });
      if (Number(request.headers.get("content-length")) > MAX_BODY) return tooBig();
      const parts: Uint8Array[] = [];
      let got = 0;
      const reader = request.body?.getReader();
      for (;;) {
        const r = reader ? await reader.read() : { done: true as const, value: undefined };
        if (r.done) break;
        got += r.value.byteLength;
        if (got > MAX_BODY) { await reader!.cancel(); return tooBig(); }
        parts.push(r.value);
      }
      const text = await new Blob(parts as BlobPart[]).text();
      // JSON-RPC batches are not part of the current MCP spec; one batch would dodge the per-request limit.
      if (text.trimStart().startsWith("[")) return json(400, "JSON-RPC batches are not supported. Send one request per call.");
      recordCall(e, ctx, request, text);
      req = new Request(request.url, { method: request.method, headers: request.headers, body: text }) as typeof request;
    }
    return handler(req, e, ctx);
  },
  // ts is ISO-8601 text (toISOString, "...Z"), so a text compare against the same format is correct
  scheduled(_event, e, ctx) {
    ctx.waitUntil(e.DB.prepare("DELETE FROM tool_calls WHERE ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months')").run());
  },
} satisfies ExportedHandler<Env>;
