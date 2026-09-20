import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const m = html.match(/\/\* ===== CORE ===== \*\/([\s\S]*?)\/\* ===== CORE END ===== \*\//);
assert.ok(m, '找不到 CORE 标记');
const CORE = new Function(`${m[1]}
  return { createInitialState, findWeek, weekProgress, overallProgress, currentWeek,
    toggleTask, addTask, updateTaskText, deleteTask, moveTask, addWeek, removeWeek,
    setWeekNote, updateWeekMeta, toggleCheckin, streak, exportJSON, importJSON };`)();

const firstTask = (s) => s.weeks[0].tasks[0];

test('预置数据：17 张卡覆盖 1..19 周且无缺口', () => {
  const s = CORE.createInitialState();
  assert.equal(s.weeks.length, 17);
  const nums = [];
  for (const w of s.weeks) for (let n = w.no; n <= w.noEnd; n++) nums.push(n);
  assert.deepEqual(nums, Array.from({ length: 19 }, (_, i) => i + 1));
});

test('预置数据：每周有任务、id 全局唯一', () => {
  const s = CORE.createInitialState();
  const ids = new Set();
  for (const w of s.weeks) {
    assert.ok(w.tasks.length >= 1, `${w.id} 没有任务`);
    for (const t of w.tasks) {
      assert.ok(t.text && t.text.length > 0);
      assert.ok(!ids.has(t.id), `重复 id: ${t.id}`);
      ids.add(t.id);
    }
  }
});

test('预置数据：第 1 周含"这周三件事"，第 6/8/10 周有检查点', () => {
  const s = CORE.createInitialState();
  assert.ok(s.weeks[0].tasks.some((t) => t.text.includes('20 行')));
  for (const no of [6, 8, 10]) {
    const w = s.weeks.find((x) => x.no === no);
    assert.ok(w.checkpoint && w.checkpoint.length > 10, `第 ${no} 周缺检查点`);
  }
});

test('createInitialState 每次返回独立副本', () => {
  const a = CORE.createInitialState();
  CORE.toggleTask(a, a.weeks[0].id, firstTask(a).id);
  const b = CORE.createInitialState();
  assert.equal(firstTask(b).done, false);
});

test('toggleTask 不可变且能来回切换', () => {
  const s = CORE.createInitialState();
  const w = s.weeks[0].id;
  const t = firstTask(s).id;
  const s2 = CORE.toggleTask(s, w, t);
  assert.equal(firstTask(s).done, false, '不得修改入参');
  assert.equal(firstTask(s2).done, true);
  assert.equal(firstTask(CORE.toggleTask(s2, w, t)).done, false);
});

test('weekProgress / overallProgress 与勾选同步', () => {
  let s = CORE.createInitialState();
  const w0 = s.weeks[0];
  assert.equal(CORE.weekProgress(w0).done, 0);
  assert.equal(CORE.overallProgress(s).weeksTotal, 19);
  assert.equal(CORE.overallProgress(s).weeksDone, 0);
  for (const t of w0.tasks) s = CORE.toggleTask(s, w0.id, t.id);
  assert.equal(CORE.weekProgress(CORE.findWeek(s, w0.id)).ratio, 1);
  assert.equal(CORE.overallProgress(s).weeksDone, 1);
});

test('两周共用的卡片完成后按 2 周计入', () => {
  let s = CORE.createInitialState();
  const multi = s.weeks.find((w) => w.noEnd - w.no === 1);
  assert.equal(multi.no, 15);
  for (const t of multi.tasks) s = CORE.toggleTask(s, multi.id, t.id);
  assert.equal(CORE.overallProgress(s).weeksDone, 2);
});

test('currentWeek 指向第一张未完成的卡，全完成后指向最后一张', () => {
  let s = CORE.createInitialState();
  assert.equal(CORE.currentWeek(s).no, 1);
  for (const t of s.weeks[0].tasks) s = CORE.toggleTask(s, s.weeks[0].id, t.id);
  assert.equal(CORE.currentWeek(s).no, 2);
  for (const w of s.weeks) for (const t of w.tasks) s = CORE.toggleTask(s, w.id, t.id);
  assert.equal(CORE.currentWeek(s).no, 19);
});

test('addTask：追加自定义任务，空文字忽略', () => {
  const s = CORE.createInitialState();
  const wid = s.weeks[2].id;
  const before = s.weeks[2].tasks.length;
  const s2 = CORE.addTask(s, wid, '自己加一条');
  assert.equal(s.weeks[2].tasks.length, before, '不得修改入参');
  assert.equal(s2.weeks[2].tasks.length, before + 1);
  assert.equal(s2.weeks[2].tasks.at(-1).kind, 'custom');
  assert.equal(s2.weeks[2].tasks.at(-1).done, false);
  assert.equal(CORE.addTask(s, wid, '   ').weeks[2].tasks.length, before);
});

test('updateTaskText / deleteTask', () => {
  const s = CORE.createInitialState();
  const wid = s.weeks[1].id;
  const tid = s.weeks[1].tasks[0].id;
  assert.equal(CORE.findWeek(CORE.updateTaskText(s, wid, tid, '改好了'), wid).tasks[0].text, '改好了');
  assert.equal(CORE.findWeek(CORE.updateTaskText(s, wid, tid, '  '), wid).tasks[0].text, s.weeks[1].tasks[0].text);
  const n = s.weeks[1].tasks.length;
  assert.equal(CORE.findWeek(CORE.deleteTask(s, wid, tid), wid).tasks.length, n - 1);
});

test('moveTask 上下移动且不越界', () => {
  const s = CORE.createInitialState();
  const wid = s.weeks[2].id;
  const [a, b] = s.weeks[2].tasks.map((t) => t.id);
  const up = CORE.findWeek(CORE.moveTask(s, wid, b, -1), wid).tasks;
  assert.deepEqual(up.slice(0, 2).map((t) => t.id), [b, a]);
  assert.deepEqual(CORE.findWeek(CORE.moveTask(s, wid, a, -1), wid).tasks.map((t) => t.id), s.weeks[2].tasks.map((t) => t.id));
  const last = s.weeks[2].tasks.at(-1).id;
  assert.deepEqual(CORE.findWeek(CORE.moveTask(s, wid, last, 1), wid).tasks.map((t) => t.id), s.weeks[2].tasks.map((t) => t.id));
});

test('addWeek / removeWeek（至少留一张卡）', () => {
  const s = CORE.createInitialState();
  const s2 = CORE.addWeek(s);
  assert.equal(s2.weeks.length, 18);
  assert.equal(s2.weeks.at(-1).no, 20);
  assert.equal(CORE.removeWeek(s, s.weeks[0].id).weeks.length, 16);
  assert.equal(CORE.removeWeek({ ...s, weeks: [s.weeks[0]] }, s.weeks[0].id).weeks.length, 1);
});

test('setWeekNote / updateWeekMeta', () => {
  const s = CORE.createInitialState();
  const wid = s.weeks[3].id;
  assert.equal(CORE.findWeek(CORE.setWeekNote(s, wid, '卡在闭包'), wid).note, '卡在闭包');
  const s2 = CORE.updateWeekMeta(s, wid, { title: '新标题', label: '10 月' });
  assert.equal(CORE.findWeek(s2, wid).title, '新标题');
  assert.equal(CORE.findWeek(s2, wid).label, '10 月');
  assert.equal(CORE.findWeek(CORE.updateWeekMeta(s, wid, {}), wid).title, s.weeks[3].title);
});

test('exportJSON → importJSON 往返等价，损坏数据抛错', () => {
  const s = CORE.createInitialState();
  const s2 = CORE.toggleTask(s, s.weeks[0].id, firstTask(s).id);
  assert.deepEqual(CORE.importJSON(CORE.exportJSON(s2)), s2);
  assert.throws(() => CORE.importJSON('{"weeks": "nope"}'));
  assert.throws(() => CORE.importJSON('不是 JSON'));
  assert.throws(() => CORE.importJSON('{"weeks": [{"id":"x"}]}'));
});

test('打卡：toggleCheckin 去重，streak 支持连续与断档', () => {
  let s = CORE.createInitialState();
  s = CORE.toggleCheckin(s, '2026-09-18', true);
  s = CORE.toggleCheckin(s, '2026-09-18', true);
  s = CORE.toggleCheckin(s, '2026-09-19', true);
  s = CORE.toggleCheckin(s, '2026-09-20', true);
  assert.equal(s.checkins.length, 3);
  assert.equal(CORE.streak(s, '2026-09-20'), 3);
  assert.equal(CORE.streak(s, '2026-09-21'), 3, '今天还没打卡时，昨天的连续仍然成立');
  assert.equal(CORE.streak(s, '2026-09-23'), 0);
  assert.equal(CORE.streak(CORE.toggleCheckin(s, '2026-09-19', false), '2026-09-20'), 1);
});
