/**
 * SenpaiNet 招待メール送信スクリプト（Google Apps Script）
 *
 * Firebase を Blaze プランにしなくても、無料で招待メールを自動送信するための仕組み。
 * Google アカウントの無料枠（通常 1日100通、Workspace は 1日1500通）で送信されます。
 *
 * ── 設計方針（重要）─────────────────────────────────────
 * このウェブアプリのURLは index.html に書かれ、公開リポジトリに載ります。
 * つまり「URLを秘密にする」「合言葉を持たせる」といった守り方は成立しません
 * （合言葉もクライアント側にあるため、一緒に読まれてしまう）。
 *
 * そこで、このスクリプトは **件名と本文をサーバー側で固定** しています。
 * 外部から指定できるのは「宛先」と「招待者名」だけなので、URLを知られても
 * 送れるのは SenpaiNet の招待文だけになり、なりすましメールの踏み台にはできません。
 * さらに 1日あたりの送信数に上限を設けて、悪用時の被害を限定しています。
 *
 * ── 設定手順 ─────────────────────────────────────────────
 * 1. https://script.google.com/ を開き、既存のプロジェクトを開く（新規なら「新しいプロジェクト」）
 * 2. エディタの中身を全部消して、このファイルの中身を貼り付ける
 * 3. 💾 保存（Ctrl+S）
 * 4. 右上「デプロイ」→「デプロイを管理」→ 鉛筆アイコン（編集）
 *      → バージョン：「新バージョン」を選択  ← ここを忘れると古いコードのままです
 *      → アクセスできるユーザー：全員
 *      →「デプロイ」
 * 5. URLは変わりません。index.html の INVITE_ENDPOINT はそのままでOK
 *
 * ── 動作確認 ────────────────────────────────────────────
 * ブラウザでウェブアプリURLを開くと {"ok":true,...} が表示されます。
 */

// 招待リンク（管理コンソール）
var CONSOLE_URL = 'https://ykonishi2006.github.io/senpainet/#admin';

// 1日あたりの送信上限（悪用されたときの被害を抑えるため）
var DAILY_LIMIT = 20;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var to = String(data.to || '').trim();
    var by = String(data.by || '').trim();

    // 宛先の形式チェック
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || to.length > 200) {
      return json({ ok: false, error: 'invalid recipient' });
    }
    // 招待者名は本文に差し込むため、長さを制限し改行を除去（ヘッダ汚染・水増し防止）
    by = by.replace(/[\r\n]/g, ' ').slice(0, 100);
    if (by && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(by)) by = '';

    // 1日の送信上限チェック
    if (!underDailyLimit()) {
      return json({ ok: false, error: 'daily limit reached' });
    }

    // 件名・本文はサーバー側で固定する（外部からは差し替えられない）
    var subject = '【SenpaiNet】運営メンバーに招待されました';
    var body =
      'SenpaiNet の運営メンバーに追加されました。\n\n' +
      'このメールアドレス（' + to + '）のGoogleアカウントで、管理コンソールにログインできます。\n\n' +
      '▼ 管理コンソール\n' + CONSOLE_URL + '\n\n' +
      'ログイン方法：上記を開き「Googleでログイン」を選択してください。\n' +
      (by ? '招待者：' + by + '\n' : '') +
      '\n心当たりがない場合は、このメールは破棄してください。\n' +
      'SenpaiNet 運営事務局';

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: body,
      name: 'SenpaiNet 運営事務局'
    });

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// 日付ごとの送信数をスクリプトプロパティに記録し、上限を超えたら false を返す
function underDailyLimit() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return false; // 同時アクセスが詰まっている場合は安全側に倒す
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var key = 'sent_' + today;
    var count = Number(props.getProperty(key) || 0);
    if (count >= DAILY_LIMIT) return false;
    props.setProperty(key, String(count + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 動作確認用（ブラウザでURLを開くと表示される）
function doGet() {
  return json({ ok: true, message: 'SenpaiNet invite mailer is running' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
