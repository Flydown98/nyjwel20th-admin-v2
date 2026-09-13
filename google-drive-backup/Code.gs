/**
 * NYJWEL 20th Cloudtype <-> Google Drive JSON backup bridge
 *
 * Script Properties:
 *   BACKUP_TOKEN     : Cloudtype GDRIVE_BACKUP_TOKEN과 동일한 임의의 긴 문자열
 *   BACKUP_FOLDER_ID : 백업을 저장할 Google Drive 폴더 ID
 *
 * Web App 배포:
 *   Execute as: Me
 *   Who has access: Anyone
 * 실제 접근은 BACKUP_TOKEN으로 검증합니다.
 */
function doGet() {
  return json_({ok:true, service:'nyjwel20th-drive-backup', time:new Date().toISOString()});
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verifyToken_(body.token);
    var action = String(body.action || '');

    if (action === 'save') return json_(save_(body));
    if (action === 'list') return json_(list_());
    if (action === 'load') return json_(load_(body.name || 'latest.json'));
    return json_({ok:false,error:'unknown action'});
  } catch (err) {
    return json_({ok:false,error:String(err && err.message || err)});
  }
}

function verifyToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('BACKUP_TOKEN') || '';
  if (!expected) throw new Error('Apps Script BACKUP_TOKEN이 설정되지 않았습니다.');
  if (String(token || '') !== expected) throw new Error('unauthorized');
}

function folder_() {
  var id = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID') || '';
  if (!id) throw new Error('Apps Script BACKUP_FOLDER_ID가 설정되지 않았습니다.');
  return DriveApp.getFolderById(id);
}

function save_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var folder = folder_();
    var text = JSON.stringify(body.state || {});
    upsert_(folder, 'latest.json', text);

    var snapshotName = '';
    if (body.snapshot) {
      snapshotName = 'backup-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyyMMdd-HHmmss') + '.json';
      folder.createFile(snapshotName, text, MimeType.PLAIN_TEXT);
      pruneSnapshots_(folder, 300);
    }
    return {ok:true,name:'latest.json',snapshotName:snapshotName,size:text.length,updatedAt:new Date().toISOString()};
  } finally {
    lock.releaseLock();
  }
}

function list_() {
  var folder = folder_(), files = folder.getFiles(), rows = [];
  while (files.hasNext()) {
    var f = files.next();
    var name = f.getName();
    if (name === 'latest.json' || /^backup-\d{8}-\d{6}\.json$/.test(name)) {
      rows.push({name:name,size:f.getSize(),updatedAt:f.getLastUpdated().toISOString()});
    }
  }
  rows.sort(function(a,b){ return new Date(b.updatedAt)-new Date(a.updatedAt); });
  return {ok:true,rows:rows.slice(0,100)};
}

function load_(name) {
  name = String(name || 'latest.json').replace(/[\/\\]/g,'');
  var files = folder_().getFilesByName(name);
  if (!files.hasNext()) throw new Error('백업 파일을 찾을 수 없습니다: ' + name);
  var f = files.next(), text = f.getBlob().getDataAsString('UTF-8');
  return {ok:true,name:name,updatedAt:f.getLastUpdated().toISOString(),state:JSON.parse(text)};
}

function upsert_(folder, name, text) {
  var files = folder.getFilesByName(name);
  if (files.hasNext()) {
    var f = files.next();
    f.setContent(text);
    while (files.hasNext()) files.next().setTrashed(true);
    return f;
  }
  return folder.createFile(name, text, MimeType.PLAIN_TEXT);
}

function pruneSnapshots_(folder, keep) {
  var files = folder.getFiles(), rows = [];
  while (files.hasNext()) {
    var f = files.next();
    if (/^backup-\d{8}-\d{6}\.json$/.test(f.getName())) rows.push({file:f,time:f.getLastUpdated().getTime()});
  }
  rows.sort(function(a,b){return b.time-a.time});
  rows.slice(keep).forEach(function(x){x.file.setTrashed(true)});
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
