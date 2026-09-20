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
  return { createInitialState, tasksOn, findTask, dayStats, monthStats, toggleTask, addTask,
    updateTaskText, deleteTask, restoreTask, moveTaskToDate, reorderTask, setNote, getNote,
    monthMatrix, shiftMonth, shiftDate, weekdayIndex, toggleCheckin, streak, exportJSON, importJSON,
    completedCount, totalCount, recentDays, noteList };`)();

const TODAY = '2026-09-20';
const fresh = () => CORE.createInitialState(TODAY);
const shiftOf = (iso, n) => CORE.shiftDate(iso, n);

test('CORE 区的代码不含 DOM / 存储调用（预置数据文字除外）', () => {
  const code = m[1].replace(/var SEED_ITEMS = \[[\s\S]*?\n\];/, '');
  for (const k of ['document', 'window', 'localStorage']) {
    assert.ok(!code.includes(k), `CORE 代码里出现 ${k}`);
  }
});

test('预置清单：53 条任务，从今天起一天一条，无日期缺口', () => {
  const s = fresh();
  assert.equal(s.tasks.length, 53);
  assert.equal(s.tasks[0].date, TODAY);
  assert.equal(s.tasks.at(-1).date, CORE.shiftDate(TODAY, 52));
  for (let i = 1; i < s.tasks.length; i += 1) {
    assert.equal(s.tasks[i].date, CORE.shiftDate(s.tasks[i - 1].date, 1), `第 ${i + 1} 条日期不连续`);
  }
});

test('预置清单：id 唯一、文字非空、交付物有 16 条', () => {
  const s = fresh();
  const ids = new Set();
  for (const t of s.tasks) {
    assert.ok(t.text.length > 0);
    assert.ok(!ids.has(t.id), `重复 id: ${t.id}`);
    ids.add(t.id);
  }
  assert.equal(s.tasks.filter((t) => t.kind === 'deliverable').length, 16);
});

test('createInitialState 每次返回独立副本', () => {
  const a = fresh();
  CORE.toggleTask(a, a.tasks[0].id);
  assert.equal(fresh().tasks[0].done, false);
});

test('weekdayIndex：2026-09-20 是周日(6)，2026-09-21 是周一(0)', () => {
  assert.equal(CORE.weekdayIndex('2026-09-20'), 6);
  assert.equal(CORE.weekdayIndex('2026-09-21'), 0);
});

test('tasksOn / dayStats 只统计当天', () => {
  const s = fresh();
  assert.equal(CORE.tasksOn(s, TODAY).length, 1);
  assert.deepEqual(CORE.dayStats(s, TODAY), { done: 0, total: 1, ratio: 0, allDone: false });
  assert.equal(CORE.dayStats(s, '2030-01-01').total, 0);
  const two = CORE.addTask(s, TODAY, '再排一件');
  assert.equal(CORE.dayStats(two, TODAY).total, 2);
  const done = CORE.toggleTask(two, CORE.tasksOn(two, TODAY)[0].id);
  assert.deepEqual(CORE.dayStats(done, TODAY).done, 1);
  assert.equal(CORE.dayStats(CORE.toggleTask(done, CORE.tasksOn(done, TODAY)[1].id), TODAY).allDone, true);
});

test('toggleTask 不可变且能来回切', () => {
  const s = fresh();
  const id = s.tasks[0].id;
  const s2 = CORE.toggleTask(s, id);
  assert.equal(s.tasks[0].done, false, '不得修改入参');
  assert.equal(CORE.findTask(s2, id).done, true);
  assert.equal(CORE.findTask(CORE.toggleTask(s2, id), id).done, false);
});

test('addTask：落在指定日期；空文字忽略', () => {
  const s = fresh();
  const s2 = CORE.addTask(s, '2026-12-25', '圣诞那天的事');
  assert.equal(s.tasks.length, 53, '不得修改入参');
  assert.equal(s2.tasks.length, 54);
  const added = s2.tasks.at(-1);
  assert.equal(added.date, '2026-12-25');
  assert.equal(added.kind, 'custom');
  assert.equal(added.done, false);
  assert.equal(CORE.addTask(s, TODAY, '   ').tasks.length, 53);
});

test('updateTaskText / deleteTask / restoreTask', () => {
  const s = fresh();
  const id = s.tasks[3].id;
  assert.equal(CORE.findTask(CORE.updateTaskText(s, id, '改好了'), id).text, '改好了');
  assert.equal(CORE.findTask(CORE.updateTaskText(s, id, '  '), id).text, '建一个 learning-log 仓库，把这 20 行提交上去');
  const removed = CORE.findTask(s, id);
  const after = CORE.deleteTask(s, id);
  assert.equal(CORE.findTask(after, id), null);
  assert.equal(after.tasks.length, 52);
  const back = CORE.restoreTask(after, removed, 3);
  assert.equal(back.tasks[3].id, id, '撤销后回到原来的位置');
  assert.equal(back.tasks.length, 53);
  assert.equal(CORE.restoreTask(back, removed, 3).tasks.length, 53, '已存在的任务不会重复插入');
});

test('moveTaskToDate：换日期与无效输入', () => {
  const s = fresh();
  const id = s.tasks[0].id;
  const moved = CORE.moveTaskToDate(s, id, '2027-01-01');
  assert.equal(CORE.findTask(moved, id).date, '2027-01-01');
  assert.equal(CORE.tasksOn(moved, TODAY).length, 0);
  assert.equal(CORE.tasksOn(moved, '2027-01-01').length, 1);
  assert.equal(CORE.findTask(CORE.moveTaskToDate(s, id, '明天'), id).date, TODAY, '无效日期不动');
});

test('reorderTask：同一天内换序，越界不动，跨天不受影响', () => {
  const s = CORE.createInitialState(TODAY);
  const withTwo = CORE.addTask(CORE.addTask(s, TODAY, 'A'), TODAY, 'B');
  const ids = CORE.tasksOn(withTwo, TODAY).map((t) => t.id);
  assert.equal(ids.length, 3);
  const up = CORE.tasksOn(CORE.reorderTask(withTwo, ids[2], -1), TODAY).map((t) => t.id);
  assert.deepEqual(up, [ids[0], ids[2], ids[1]]);
  assert.deepEqual(CORE.tasksOn(CORE.reorderTask(withTwo, ids[0], -1), TODAY).map((t) => t.id), ids);
  assert.deepEqual(CORE.tasksOn(CORE.reorderTask(withTwo, ids[2], 1), TODAY).map((t) => t.id), ids);
  assert.equal(CORE.tasksOn(CORE.reorderTask(withTwo, ids[0], -1), CORE.shiftDate(TODAY, 1)).length, 1);
});

test('monthMatrix：42 格、周一开始、9 月从 8/31 起、当月 30 天', () => {
  const cells = CORE.monthMatrix(2026, 9);
  assert.equal(cells.length, 42);
  assert.equal(cells[0].iso, '2026-08-31');
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[1].iso, '2026-09-01');
  assert.equal(cells[1].inMonth, true);
  assert.equal(cells.filter((c) => c.inMonth).length, 30);
  assert.equal(cells[41].iso, '2026-10-11');
});

test('monthMatrix：2 月与闰年不出错', () => {
  assert.equal(CORE.monthMatrix(2028, 2).filter((c) => c.inMonth).length, 29);
  assert.equal(CORE.monthMatrix(2027, 2).filter((c) => c.inMonth).length, 28);
});

test('shiftMonth 跨年', () => {
  assert.deepEqual(CORE.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(CORE.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test('monthStats 只算这个月', () => {
  const s = fresh();
  const sep = CORE.monthStats(s, 2026, 9);
  assert.equal(sep.total, 11, '9/20 到 9/30 共 11 条');
  assert.equal(sep.done, 0);
  const doneOne = CORE.toggleTask(s, s.tasks[0].id);
  assert.equal(CORE.monthStats(doneOne, 2026, 9).done, 1);
  assert.equal(CORE.monthStats(doneOne, 2026, 8).total, 0);
});

test('卡点记录：写入、读取、清空', () => {
  const s = fresh();
  assert.equal(CORE.getNote(s, TODAY), '');
  const s2 = CORE.setNote(s, TODAY, '闭包没想明白');
  assert.equal(CORE.getNote(s2, TODAY), '闭包没想明白');
  assert.equal(CORE.getNote(s, TODAY), '', '不得修改入参');
  assert.equal(CORE.getNote(CORE.setNote(s2, TODAY, ''), TODAY), '');
});

test('completedCount / totalCount', () => {
  const s = fresh();
  assert.equal(CORE.totalCount(s), 53);
  assert.equal(CORE.completedCount(s), 0);
  const one = CORE.toggleTask(s, s.tasks[0].id);
  assert.equal(CORE.completedCount(one), 1);
  assert.equal(CORE.completedCount(s), 0, '不得修改入参');
});

test('recentDays：连续 30 天，最后一天是今天，含完成数与打卡标记', () => {
  let s = fresh();
  s = CORE.addTask(s, shiftOf(TODAY, -3), '三天前多的一件');
  s = CORE.toggleTask(s, s.tasks[0].id);
  s = CORE.toggleCheckin(s, TODAY, true);
  const days = CORE.recentDays(s, TODAY, 30);
  assert.equal(days.length, 30);
  assert.equal(days[0].iso, shiftOf(TODAY, -29));
  assert.equal(days[29].iso, TODAY);
  for (let i = 1; i < days.length; i += 1) {
    assert.equal(days[i].iso, shiftOf(days[i - 1].iso, 1), '日期必须连续');
  }
  assert.deepEqual(days[29], { iso: TODAY, done: 1, total: 1, ratio: 1, checked: true });
  const back3 = days.find((d) => d.iso === shiftOf(TODAY, -3));
  assert.equal(back3.total, 1, '预置任务只从今天往后排，三天前只有我手动加的那一条');
  assert.equal(back3.done, 0);
  assert.equal(back3.checked, false);
});

test('noteList：按日期倒序、忽略空白', () => {
  let s = fresh();
  assert.deepEqual(CORE.noteList(s), []);
  s = CORE.setNote(s, '2026-09-18', '第一条');
  s = CORE.setNote(s, '2026-09-20', '第三条');
  s = CORE.setNote(s, '2026-09-19', '第二条');
  s = CORE.setNote(s, '2026-09-21', '   ');
  assert.deepEqual(CORE.noteList(s), [
    { date: '2026-09-20', text: '第三条' },
    { date: '2026-09-19', text: '第二条' },
    { date: '2026-09-18', text: '第一条' }
  ]);
});

test('打卡：去重、连续、断档', () => {
  let s = fresh();
  s = CORE.toggleCheckin(s, '2026-09-18', true);
  s = CORE.toggleCheckin(s, '2026-09-18', true);
  s = CORE.toggleCheckin(s, '2026-09-19', true);
  s = CORE.toggleCheckin(s, '2026-09-20', true);
  assert.equal(s.checkins.length, 3);
  assert.equal(CORE.streak(s, '2026-09-20'), 3);
  assert.equal(CORE.streak(s, '2026-09-21'), 3, '今天还没打卡时，昨天的连续仍成立');
  assert.equal(CORE.streak(s, '2026-09-23'), 0);
  assert.equal(CORE.streak(CORE.toggleCheckin(s, '2026-09-19', false), '2026-09-20'), 1);
});

test('exportJSON → importJSON 往返完全等价', () => {
  let s = fresh();
  s = CORE.addTask(s, TODAY, '临时加的');
  s = CORE.toggleTask(s, s.tasks[0].id);
  s = CORE.moveTaskToDate(s, s.tasks[1].id, '2026-10-05');
  s = CORE.setNote(s, TODAY, '今天卡在闭包');
  s = CORE.toggleCheckin(s, TODAY, true);
  assert.deepEqual(CORE.importJSON(CORE.exportJSON(s)), s);
});

test('导入校验：旧版备份、坏数据都给出明确错误', () => {
  assert.throws(() => CORE.importJSON('{"weeks": []}'), /旧版（周制）的备份/);
  assert.throws(() => CORE.importJSON('不是 JSON'));
  assert.throws(() => CORE.importJSON('{"tasks": [{"id":"a","text":"","date":"2026-09-20"}]}'));
  assert.throws(() => CORE.importJSON('{"tasks": [{"id":"a","text":"x","date":"明天"}]}'));
  assert.throws(() => CORE.importJSON('{}'));
});
