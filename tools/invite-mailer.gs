/**
 * SenpaiNet 招待メール送信スクリプト（Google Apps Script）
 *
 * Firebase を Blaze プランにしなくても、無料で招待メールを自動送信するための仕組み。
 * Google アカウントの無料枠（通常 1日100通、Workspace は 1日1500通）で送信されます。
 *
 * ── 設定手順 ─────────────────────────────────────────────
 * 1. https://script.google.com/ を開き「新しいプロジェクト」を作成
 * 2. 既定のコードを全部消して、このファイルの中身を貼り付ける
 * 3. 下の SHARED_SECRET を、推測されない自分だけの文字列に変更する
 * 4. 右上「デプロイ」→「新しいデプロイ」→ 種類：ウェブアプリ
 *      次のユーザーとして実行 ： 自分
 *      アクセスできるユーザー ： 全員
 *    →「デプロイ」→ 初回はGoogleの権限承認を求められるので許可する
 * 5. 表示された「ウェブアプリのURL」（https://script.google.com/macros/s/.../exec）をコピー
 * 6. index.html の  var INVITE_ENDPOINT = '';  にそのURLを貼り付ける
 *    var SHARED_SECRET も同じ文字列に合わせる（index.html 側にも同じ値を入れる場合）
 * 7. 保存してデプロイすれば、運営メンバー追加時に自動でメールが飛びます
 *
 * ── 注意 ────────────────────────────────────────────────
 * ・送信元はこのスクリプトを作成したGoogleアカウントのメールアドレスになります。
 * ・ウェブアプリURLを知られると第三者がメールを送れてしまうため、URLは公開しないでください。
 *   （index.html は公開リポジトリにあるため、心配な場合は SHARED_SECRET の確認を必ず有効にし、
 *     宛先を admins コレクションに登録済みのアドレスだけに限定する運用を推奨します）
 */

// index.html 側と同じ値にする。空文字にすると合言葉チェックを行わない。
var SHARED_SECRET = '';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && data.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }
    if (!data.to || !data.subject || !data.body) {
      return json({ ok: false, error: 'missing fields' });
    }

    MailApp.sendEmail({
      to: data.to,
      subject: data.subject,
      body: data.body,
      name: 'SenpaiNet 運営事務局'
    });

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
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
