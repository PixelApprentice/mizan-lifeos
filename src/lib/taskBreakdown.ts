import { TASK_POSITION_GAP } from "./taskOrder.ts";

export interface BreakdownStep { title: string; est_min: number }
interface BreakdownParent {
  id: number;
  title: string;
  kind: string;
  status: string;
  est_min: number;
  priority: number;
  project_id: number | null;
  due: string | null;
}
export const MAX_BREAKDOWN_STEPS = 20;
export const MAX_STEP_MINUTES = 1440;

export function distributeStepEstimates(estimate: number, weights: readonly number[]): number[] {
  if (!weights.length || weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) throw new Error("Step weights must be positive.");
  const units = Math.max(weights.length, Math.ceil((Number.isFinite(estimate) && estimate >= 5 ? estimate : 25) / 5));
  const remaining = units - weights.length;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) => remaining * weight / totalWeight);
  const result = shares.map((share) => 1 + Math.floor(share));
  const spare = units - result.reduce((sum, share) => sum + share, 0);
  const ranked = shares.map((share, i) => ({ i, remainder: share % 1 })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0; i < spare; i++) result[ranked[i].i]++;
  return result.map((share) => Math.min(MAX_STEP_MINUTES, share * 5));
}

const cleanItem = (text: string) => text
  .replace(/^[\s,;:.\-–—]+/, "")
  .replace(/[\s,;:]+$/, "")
  .replace(/^(and|then|also)\s+/i, "")
  .replace(/[\s,;]+(and|then)$/i, "")
  .replace(/\s+/g, " ")
  .trim();

function capitalize(text: string) {
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : text;
}

function usable(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const item = capitalize(cleanItem(raw)).slice(0, 300);
    const key = item.normalize("NFKC").toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.length >= 2 ? result.slice(0, MAX_BREAKDOWN_STEPS) : [];
}

/** Finds a list the user already wrote: bullet or numbered lines, inline "1 ... 2 ...", or "topic: a, b and c". */
export function extractListedSteps(text: string): string[] {
  const source = (text ?? "").replace(/\r/g, "");
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  const marker = /^(?:[-*•+]|\[[ xX]?\]|\d{1,2}[.):]|[a-z][.)])\s+/;
  const marked = lines.filter((line) => marker.test(line));
  if (marked.length >= 2) return usable(marked.map((line) => line.replace(marker, "")));

  const flat = lines.join(" ");
  const numbers = [...flat.matchAll(/(?:^|[\s,;:(])(\d{1,2})(?:[.):]|\s*-)?\s+(?=[^\d\s])/g)];
  const chain: { index: number; end: number }[] = [];
  for (const match of numbers) {
    if (Number(match[1]) !== chain.length + 1) continue;
    const at = (match.index ?? 0) + match[0].indexOf(match[1]);
    chain.push({ index: at, end: (match.index ?? 0) + match[0].length });
  }
  if (chain.length >= 2) {
    return usable(chain.map((item, i) => flat.slice(item.end, chain[i + 1]?.index ?? flat.length)));
  }

  if (lines.length >= 2 && lines.every((line) => line.length <= 200)) return usable(lines);

  const colon = flat.indexOf(":");
  const tail = colon >= 0 ? flat.slice(colon + 1) : "";
  const parts = tail.split(/\s*(?:[,;]|\band\b|&)\s*/i).filter((part) => part.trim());
  if (parts.length >= 2 && parts.every((part) => part.trim().length <= 80)) return usable(parts);
  return [];
}

export function suggestTaskSteps(task: Pick<BreakdownParent, "title" | "kind" | "est_min"> & { notes?: string | null }): BreakdownStep[] {
  if (typeof task.title !== "string" || !task.title.trim()) throw new Error("Task title is required.");
  const title = task.title.trim().replace(/\s+/g, " ");
  const listed = extractListedSteps(task.notes ?? "").length ? extractListedSteps(task.notes ?? "") : extractListedSteps(task.title);
  if (listed.length) {
    const estimates = distributeStepEstimates(task.est_min, listed.map(() => 1));
    return listed.map((step, i) => ({ title: step, est_min: estimates[i] }));
  }
  let actions: string[];
  let weights = [1, 3, 1];
  if (/\b(fix|bug|debug|error|crash|broken|repair)\b/i.test(title)) {
    actions = ["Reproduce the problem and write down the exact steps", "Find the cause and make the fix", "Test the fix and one nearby case"];
  } else if (/\b(write|draft|essay|report|proposal|document|article|post)\b/i.test(title)) {
    actions = ["Outline the audience and key points", "Write the first draft", "Revise and proofread"];
  } else if (/\b(read|chapter|book|paper)\b/i.test(title)) {
    actions = ["Pick the section and the question to answer", "Read and note the key ideas", "Summarize from memory"];
  } else if (/\b(learn|study|revise|exam|test|homework|assignment)\b/i.test(title) || task.kind === "study" || task.kind === "school") {
    actions = ["Gather the material and pick the topic", "Work through examples without hints", "Check answers and review weak spots"];
  } else if (/\b(build|implement|code|feature|app|refactor|deploy)\b/i.test(title) || task.kind === "code") {
    actions = ["Define the smallest working outcome", "Implement it", "Test and review"];
  } else if (task.kind === "deen") {
    actions = ["Choose the portion and prepare", "Read or practise it", "Review and note what to revisit"];
  } else if (/\b(client|invoice|deliver|send)\b/i.test(title) || task.kind === "freelance") {
    actions = ["Confirm the deliverable and requirements", "Prepare the first version", "Review and send"];
  } else if (/\b(plan|organi[sz]e|prepare|clean|move|trip)\b/i.test(title)) {
    actions = ["List what is needed", "Do the main part", "Check what is left"];
    weights = [1, 2, 1];
  } else {
    actions = ["Decide what done looks like", "Do the first concrete piece", "Finish loose ends and check the result"];
  }
  const estimates = distributeStepEstimates(task.est_min, weights);
  return actions.map((action, i) => ({ title: action, est_min: estimates[i] }));
}

export function validateTaskSteps(parent: BreakdownParent, steps: readonly BreakdownStep[], tasks: readonly { parent_id: number | null; title?: string }[]): BreakdownStep[] {
  if (!Number.isSafeInteger(parent.id) || parent.id <= 0) throw new Error("Task no longer exists.");
  if (parent.status === "done") throw new Error("Reopen the task before adding steps.");
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_BREAKDOWN_STEPS) throw new Error(`Add between 1 and ${MAX_BREAKDOWN_STEPS} steps at a time.`);
  const existing = new Set(tasks.filter((task) => task.parent_id === parent.id && typeof task.title === "string")
    .map((task) => task.title!.trim().replace(/\s+/g, " ").normalize("NFKC").toLowerCase()));
  const seen = new Set<string>();
  return steps.map((step, i) => {
    if (!step || typeof step.title !== "string") throw new Error(`Step ${i + 1} needs a title.`);
    const title = step.title.trim().replace(/\s+/g, " ");
    if (!title || title.length > 300) throw new Error(`Step ${i + 1} needs a title of 1–300 characters.`);
    if (!Number.isInteger(step.est_min) || step.est_min < 5 || step.est_min > MAX_STEP_MINUTES) throw new Error(`Step ${i + 1} needs a whole-number estimate between 5 and ${MAX_STEP_MINUTES} minutes.`);
    const key = title.normalize("NFKC").toLowerCase();
    if (seen.has(key)) throw new Error(`Step ${i + 1} duplicates another step. Give each step a distinct title.`);
    if (existing.has(key)) throw new Error(`Step ${i + 1} already exists on this task.`);
    seen.add(key);
    return { title, est_min: step.est_min };
  });
}

// New steps go after the existing ones, so a task can be broken down further later.
export function taskStepsStatement(parentId: number, steps: readonly BreakdownStep[], now: string): { sql: string; values: (number | string)[] } {
  const values: (number | string)[] = [];
  const rows = steps.map((step, i) => {
    const start = values.length;
    values.push(step.title, step.est_min, (i + 1) * TASK_POSITION_GAP);
    return `($${start + 1},$${start + 2},$${start + 3})`;
  });
  values.push(parentId, now);
  return {
    sql: `WITH requested(title,est_min,step_pos) AS (VALUES ${rows.join(",")}),
      parent AS (SELECT * FROM tasks WHERE id=$${values.length - 1} AND status IN ('backlog','open','doing')),
      base AS (SELECT COALESCE(MAX(position),0) AS top FROM tasks WHERE parent_id=$${values.length - 1})
      INSERT INTO tasks (title,kind,status,parent_id,est_min,project_id,priority,due,position,completed_at,created_at)
      SELECT requested.title,parent.kind,CASE WHEN parent.status='backlog' THEN 'backlog' ELSE 'open' END,
        parent.id,requested.est_min,parent.project_id,parent.priority,parent.due,base.top+requested.step_pos,NULL,$${values.length}
      FROM requested CROSS JOIN parent CROSS JOIN base ORDER BY requested.step_pos`,
    values,
  };
}

export function taskTreeRoots<T extends { id: number; parent_id: number | null }>(tasks: readonly T[], matches: readonly T[]): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const roots = new Map<number, T>();
  for (const match of matches) {
    let root = match;
    const visited = new Set([root.id]);
    while (root.parent_id !== null) {
      const parent = byId.get(root.parent_id);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      root = parent;
    }
    if (!roots.has(root.id)) roots.set(root.id, root);
  }
  return [...roots.values()];
}
