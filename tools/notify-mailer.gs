/**
 * SenpaiNet: タグ付き相談 → 該当分野の先輩へメール通知（Google Apps Script）
 *
 * Firebase の Blaze プランなしで、タグに一致する先輩へ自動でメールを送るための仕組み。
 * 数分おきに Firestore を見に行き、未送信の通知を処理します。
 *
 * ── なぜサーバー側で動かすのか ─────────────────────────────
 * 先輩のメールアドレスは senpaiProfiles に入っており、Firestore ルールで
 * 「運営以外は読めない」ようにしてあります。相談を投稿するのは匿名の在校生なので、
 * ブラウザ側でタグ照合をすると先輩のアドレスが漏れてしまいます。
 * そこでこのスクリプトがサービスアカウントの権限で照合と送信を担当します。
 *
 * ══ 設定手順 ══════════════════════════════════════════════
 *
 * ① サービスアカウントを作る（Google Cloud コンソール）
 *   1. https://console.cloud.google.com/iam-admin/serviceaccounts?project=senpainet-console
 *   2.「サービスアカウントを作成」→ 名前：senpainet-notifier →「作成して続行」
 *   3. ロールを選択：「Cloud Datastore ユーザー」→「続行」→「完了」
 *   4. 一覧から作ったアカウントをクリック →「キー」タブ →「鍵を追加」→「新しい鍵を作成」
 *      → JSON を選んで「作成」→ JSONファイルがダウンロードされます
 *
 * ② キーを Apps Script に登録する
 *   1. https://script.google.com/ で「新しいプロジェクト」を作成（招待メールとは別のプロジェクト）
 *   2. このファイルの中身を貼り付けて保存
 *   3. 左メニュー「プロジェクトの設定」→「スクリプト プロパティ」→「スクリプト プロパティを追加」
 *        プロパティ： SA_KEY
 *        値       ： ①でダウンロードしたJSONファイルの中身を丸ごと貼り付け
 *      ※ コードに直接書かず、ここに入れてください（コードより安全です）
 *   4.「スクリプト プロパティを保存」
 *
 * ③ 動作確認
 *   1. 関数リストから testConnection を選んで「実行」
 *   2. 初回は権限の承認を求められるので許可（「詳細」→「安全ではないページに移動」）
 *   3. 実行ログに「接続OK」と先輩の登録件数が出れば成功
 *
 * ④ 自動実行の設定
 *   1. 左メニューの時計アイコン「トリガー」→「トリガーを追加」
 *   2. 実行する関数        ： processNotifyQueue
 *      イベントのソース    ： 時間主導型
 *      時間ベースのトリガー： 分ベースのタイマー
 *      間隔               ： 10分おき
 *   3. 保存
 *
 * これで、タグ付きの相談が投稿されてから最大10分以内に先輩へメールが届きます。
 */

var PROJECT_ID = 'senpainet-console';
var SITE_URL = 'https://ykonishi2006.github.io/senpainet/';

// 1回の実行で処理する通知の上限（暴走を防ぐため）
var MAX_QUEUE_PER_RUN = 10;
// 1件の相談で通知する先輩の上限
var MAX_RECIPIENTS = 30;

// ═══════════════ メイン処理 ═══════════════

function processNotifyQueue() {
  var token = getAccessToken();

  // 未送信の通知を取り出す
  var queue = runQuery(token, {
    from: [{ collectionId: 'mailQueue' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'EQUAL',
        value: { stringValue: 'pending' }
      }
    },
    limit: MAX_QUEUE_PER_RUN
  });

  if (!queue.length) {
    Logger.log('未送信の通知はありません');
    return;
  }

  // 先輩の一覧は1回だけ読んで使い回す
  var senpai = listSenpaiProfiles(token);
  Logger.log('未送信 ' + queue.length + '件 / 先輩の登録 ' + senpai.length + '件');

  queue.forEach(function (item) {
    var q = item.fields;
    var tags = toArray(q.tags);
    var title = toStr(q.title);
    var sent = 0;

    if (tags.length) {
      // タグが1つでも一致する先輩を集める（重複アドレスは除く）
      // listSenpaiProfiles の時点でアドレスの重複は解消済み
      var targets = senpai.filter(function (p) {
        return p.tags.some(function (t) { return tags.indexOf(t) !== -1; });
      }).slice(0, MAX_RECIPIENTS);

      targets.forEach(function (p) {
        try {
          var matched = p.tags.filter(function (t) { return tags.indexOf(t) !== -1; });
          MailApp.sendEmail({
            to: p.email,
            subject: '【SenpaiNet】あなたの分野の相談が届きました：' + title,
            body: plainBody(q, matched),
            htmlBody: htmlBody(q, matched),
            name: 'SenpaiNet'
          });
          sent++;
        } catch (e) {
          Logger.log('送信失敗 ' + p.email + ': ' + e);
        }
      });
    }

    // 処理済みとして記録する（次回の実行で二重に送らないため）
    patchDoc(token, item.name, {
      status: { stringValue: 'sent' },
      sentAt: { integerValue: String(Date.now()) },
      sentCount: { integerValue: String(sent) }
    }, ['status', 'sentAt', 'sentCount']);

    Logger.log('「' + title + '」→ ' + sent + '人に送信');
  });
}

// 設定が正しいか確かめる（トリガー設定前に手動で実行する）
function testConnection() {
  var token = getAccessToken();
  var senpai = listSenpaiProfiles(token);
  var pending = runQuery(token, {
    from: [{ collectionId: 'mailQueue' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' }
      }
    }
  });
  Logger.log('接続OK');
  Logger.log('先輩の登録件数: ' + senpai.length);
  Logger.log('未送信の通知: ' + pending.length + '件');
  senpai.slice(0, 3).forEach(function (p) {
    Logger.log('  例) ' + maskEmail(p.email) + ' / タグ: ' + p.tags.join('、'));
  });
  if (!senpai.length) Logger.log('※ 先輩がまだ登録されていません。サイトで先輩登録を試してください。');
}

// ═══════════════ メール本文 ═══════════════

function plainBody(q, matched) {
  var url = SITE_URL;
  return 'あなたが登録している分野の相談が投稿されました。\n\n' +
    '■ ' + toStr(q.title) + '\n' +
    (toStr(q.category) ? 'カテゴリ：' + toStr(q.category) + '\n' : '') +
    '一致したタグ：' + matched.map(function (t) { return '#' + t; }).join('　') + '\n\n' +
    (toStr(q.excerpt) ? toStr(q.excerpt) + '…\n\n' : '') +
    '▼ 相談を読んで回答する\n' + url + '\n\n' +
    '回答は匿名で投稿できます。あなたの経験が後輩の一歩になります。\n\n' +
    '---\n' +
    '通知が不要な場合は、サイトのマイページから得意分野の設定を変更してください。\n' +
    'SenpaiNet';
}

function htmlBody(q, matched) {
  var BLUE = '#2f73e8', INK = '#14233f', MUTED = '#66738c';
  var chips = matched.map(function (t) {
    return '<span style="display:inline-block;font:700 11px/1 Helvetica,Arial,sans-serif;color:' + BLUE +
      ';background:#e8f1fe;padding:6px 11px;border-radius:8px;margin:0 5px 5px 0">#' + escapeHtml(t) + '</span>';
  }).join('');

  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"></head>' +
    '<body style="margin:0;padding:0;background:#f4f7fb">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f7fb">' +
    '<tr><td align="center" style="padding:32px 16px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ' +
      'style="width:600px;max-width:100%;background:#fff;border-radius:16px;overflow:hidden">' +

    '<tr><td style="background:' + BLUE + ';height:5px;font-size:0;line-height:0">&nbsp;</td></tr>' +

    '<tr><td style="padding:28px 32px 0">' +
      '<div style="font:700 11px/1 Helvetica,Arial,sans-serif;color:' + BLUE + ';letter-spacing:.14em">NEW QUESTION</div>' +
      '<div style="margin-top:10px;font:400 13px/1.8 Helvetica,Arial,sans-serif;color:' + MUTED + '">' +
        'あなたが登録している分野の相談が投稿されました。</div>' +
    '</td></tr>' +

    '<tr><td style="padding:18px 32px 0">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="background:#f7f9fc;border:1px solid #e7edf6;border-radius:12px">' +
        '<tr><td style="padding:18px 20px">' +
          (toStr(q.category) ? '<div style="font:700 11px/1 Helvetica,Arial,sans-serif;color:#8a97ac">' +
            escapeHtml(toStr(q.category)) + '</div>' : '') +
          '<div style="margin-top:8px;font:700 17px/1.55 Helvetica,Arial,sans-serif;color:' + INK + '">' +
            escapeHtml(toStr(q.title)) + '</div>' +
          (toStr(q.excerpt) ? '<div style="margin-top:10px;font:400 13px/1.9 Helvetica,Arial,sans-serif;color:' +
            MUTED + '">' + escapeHtml(toStr(q.excerpt)) + '…</div>' : '') +
          '<div style="margin-top:14px">' + chips + '</div>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:24px 32px 0">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
        '<tr><td align="center" style="background:' + BLUE + ';border-radius:10px">' +
          '<a href="' + SITE_URL + '" style="display:inline-block;padding:14px 34px;' +
            'font:700 15px/1 Helvetica,Arial,sans-serif;color:#fff;text-decoration:none;border-radius:10px">' +
            '相談を読んで回答する</a>' +
        '</td></tr>' +
      '</table>' +
      '<div style="margin-top:12px;font:400 12px/1.7 Helvetica,Arial,sans-serif;color:#94a1b5">' +
        '回答は匿名で投稿できます</div>' +
    '</td></tr>' +

    '<tr><td style="padding:26px 32px 30px">' +
      '<div style="height:1px;background:#eef1f7;font-size:0;line-height:0;margin-bottom:16px">&nbsp;</div>' +
      '<div style="font:400 11.5px/1.8 Helvetica,Arial,sans-serif;color:#a8b3c4">' +
        '通知が不要な場合は、サイトのマイページから得意分野の設定を変更してください。<br>' +
        'SenpaiNet</div>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

// ═══════════════ Firestore REST ═══════════════

function baseUrl() {
  return 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
}

// サービスアカウントのJSONキーからアクセストークンを取得する（JWT Bearer フロー）
function getAccessToken() {
  var raw = PropertiesService.getScriptProperties().getProperty('SA_KEY');
  if (!raw) throw new Error('スクリプト プロパティ SA_KEY が未設定です。設定手順②をご確認ください。');
  var key = JSON.parse(raw);

  var now = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var claim = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  var unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  var sig = Utilities.computeRsaSha256Signature(unsigned, key.private_key);
  var jwt = unsigned + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText());
  if (!body.access_token) throw new Error('認証に失敗しました: ' + res.getContentText());
  return body.access_token;
}

function runQuery(token, structuredQuery) {
  var res = UrlFetchApp.fetch(baseUrl() + ':runQuery', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ structuredQuery: structuredQuery }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('クエリに失敗: ' + res.getContentText());
  return JSON.parse(res.getContentText())
    .filter(function (r) { return r.document; })
    .map(function (r) { return r.document; });
}

// 先輩プロフィールを全件読む（件数が少ない前提。増えたらページングを足す）
function listSenpaiProfiles(token) {
  var out = [], pageToken = '';
  do {
    var url = baseUrl() + '/senpaiProfiles?pageSize=300' + (pageToken ? '&pageToken=' + pageToken : '');
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error('先輩一覧の取得に失敗: ' + res.getContentText());
    var data = JSON.parse(res.getContentText());
    (data.documents || []).forEach(function (d) {
      var f = d.fields || {};
      out.push({
        email: toStr(f.email).trim(),
        tags: toArray(f.tags),
        // notify が明示的に false のときだけ通知を止める（未設定は従来どおり通知する）
        notify: !(f.notify && f.notify.booleanValue === false),
        updatedAt: Number(toStr(f.updatedAt) || toStr(f.createdAt) || 0)
      });
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  // 同じアドレスの登録が複数あれば、最後に更新されたものだけを使う。
  // （マイページ導入前の登録が残っていても、最新の設定が優先される）
  var latest = {};
  out.forEach(function (p) {
    if (!p.email) return;
    var cur = latest[p.email];
    if (!cur || p.updatedAt >= cur.updatedAt) latest[p.email] = p;
  });

  return Object.keys(latest)
    .map(function (k) { return latest[k]; })
    .filter(function (p) { return p.notify; });
}

function patchDoc(token, docName, fields, maskPaths) {
  var mask = maskPaths.map(function (p) { return 'updateMask.fieldPaths=' + encodeURIComponent(p); }).join('&');
  var res = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/' + docName + '?' + mask, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) Logger.log('更新に失敗: ' + res.getContentText());
}

// ═══════════════ 小さな道具 ═══════════════

// Firestore の値オブジェクトから文字列を取り出す
function toStr(v) {
  if (!v) return '';
  return v.stringValue || v.integerValue || '';
}

// Firestore の配列値から文字列の配列を取り出す
function toArray(v) {
  if (!v || !v.arrayValue || !v.arrayValue.values) return [];
  return v.arrayValue.values.map(function (x) { return x.stringValue || ''; })
    .filter(function (x) { return x; });
}

function b64url(str) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ログにアドレスをそのまま出さないための伏せ字
function maskEmail(e) {
  var i = String(e).indexOf('@');
  if (i < 2) return '***';
  return String(e).slice(0, 2) + '***' + String(e).slice(i);
}
