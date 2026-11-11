/**
 * Club members sheet ⇄ Club app
 *
 * Sends the "Members" tab to the app and writes the paying members found in
 * Stripe into the "From Stripe" tab.
 *
 * New Stripe payers are also added to the "Members" tab automatically, with
 * Status "via Stripe": their access keeps following Stripe (it ends when they
 * stop paying), and their Note shows the plan and "member until" date.
 * Change their Status to "blocked" to remove access, or to "active" to keep
 * them in for good (like members added by hand).
 *
 * Setup (once, from the organization's Google account):
 *   1. In the sheet: Extensions → Apps Script, paste this file, save.
 *   2. Project Settings (gear) → Script properties → Add property:
 *        SYNC_SECRET = (the value Claude gave you)
 *   3. Back in the editor, pick the function "setup" and click Run, then allow access.
 * After that it runs by itself: a few seconds after each edit, and every hour.
 * The menu "Club app" in the sheet has "Sync now" and "Check Stripe now".
 */

const SYNC_URL = 'https://eypehvhcqzhwssydvrhn.supabase.co/functions/v1/sync';
const MEMBERS_TAB = 'Members';
const STRIPE_TAB = 'From Stripe';
const VIA_STRIPE = 'via Stripe';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Club app')
    .addItem('Sync now', 'syncNow')
    .addItem('Check Stripe now', 'syncWithStripe')
    .addToUi();
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onMembersEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('syncNow').timeBased().everyHours(1).create();
  // Status column (D): active / blocked / via Stripe
  const members = SpreadsheetApp.getActive().getSheetByName(MEMBERS_TAB);
  members.getRange(2, 4, Math.max(members.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['active', 'blocked', VIA_STRIPE], true).setAllowInvalid(true).build());
  syncNow();
}

// Edits come in bursts: wait a moment so one sync covers them all.
function onMembersEdit(e) {
  if (e && e.range && e.range.getSheet().getName() !== MEMBERS_TAB) return;
  Utilities.sleep(3000);
  syncNow();
}

function syncNow() { sync_(false); }
function syncWithStripe() { sync_(true); }

function sync_(stripeNow) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
    if (!secret) throw new Error('Add the SYNC_SECRET script property first (Project Settings → Script properties).');

    const ss = SpreadsheetApp.getActive();
    const values = ss.getSheetByName(MEMBERS_TAB).getDataRange().getValues();
    const rows = values.slice(1)
      .filter(r => String(r[0]).trim())
      // "via Stripe" rows don't give access by themselves: Stripe does (blocked still blocks).
      .filter(r => String(r[3]).trim().toLowerCase() !== VIA_STRIPE.toLowerCase())
      .map(r => ({ email: r[0], name: r[1], role: r[2], status: r[3], note: r[4] }));

    const res = UrlFetchApp.fetch(SYNC_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-secret': secret },
      payload: JSON.stringify({ action: 'sheet', rows: rows, stripeNow: stripeNow }),
      muteHttpExceptions: true,
    });
    const body = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() !== 200 || !body.ok) {
      throw new Error('Club app sync failed: ' + (body.error || res.getResponseCode()));
    }
    writeStripe_(ss, body.stripe || []);
    const added = addStripeMembers_(ss, body.stripe || []);
    if (added) ss.toast(added + ' new paying member' + (added === 1 ? '' : 's') + ' added to the Members tab.', 'Club app');
    if (stripeNow) ss.toast('Members sent, Stripe checked: ' + (body.active || 0) + ' active paying members.', 'Club app');
  } finally {
    lock.releaseLock();
  }
}

function writeStripe_(ss, list) {
  const sheet = ss.getSheetByName(STRIPE_TAB);
  const tz = ss.getSpreadsheetTimeZone();
  const fmt = d => d ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd') : '';
  const out = [['Email', 'Name', 'Plan', 'Member until', 'Status', 'Last checked']].concat(
    list.map(m => [m.email, m.name, m.plan, fmt(m.member_until),
      m.active && (!m.member_until || new Date(m.member_until) > new Date()) ? 'active' : 'ended',
      fmt(m.checked_at)]));
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 6).clearContent();
  sheet.getRange(1, 1, out.length, 6).setValues(out);
}

// Copy Stripe payers into the Members tab (Status "via Stripe") and keep their Note up to date.
function addStripeMembers_(ss, list) {
  const sheet = ss.getSheetByName(MEMBERS_TAB);
  const tz = ss.getSpreadsheetTimeZone();
  const fmt = d => d ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd') : '';
  const values = sheet.getDataRange().getValues();
  const rowOf = new Map();
  values.forEach((r, i) => { if (i > 0 && String(r[0]).trim()) rowOf.set(String(r[0]).trim().toLowerCase(), i + 1); });
  const newRows = [];
  list.forEach(m => {
    const email = String(m.email || '').trim().toLowerCase();
    if (!email) return;
    const paying = m.active && (!m.member_until || new Date(m.member_until) > new Date());
    const plan = m.plan ? m.plan.charAt(0).toUpperCase() + m.plan.slice(1) : '';
    const note = 'Stripe' + (plan ? ' ' + plan : '') + (m.member_until ? ' · until ' + fmt(m.member_until) : '') + (paying ? '' : ' · payment ended');
    const row = rowOf.get(email);
    if (row) {
      // Only rows the script manages ("via Stripe") get their note refreshed; hand-made rows are left alone.
      if (String(values[row - 1][3]).trim().toLowerCase() === VIA_STRIPE.toLowerCase()) {
        if (values[row - 1][4] !== note) sheet.getRange(row, 5).setValue(note);
        if (!String(values[row - 1][1]).trim() && m.name) sheet.getRange(row, 2).setValue(m.name);
      }
    } else if (paying) {
      newRows.push([email, m.name || '', 'member', VIA_STRIPE, note, fmt(new Date())]);
      rowOf.set(email, -1);
    }
  });
  if (newRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
  return newRows.length;
}
