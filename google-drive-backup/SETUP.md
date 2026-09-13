# Google Drive 외부백업 연결

## 1. Google Drive에 백업 폴더 생성
예: `NYJWEL20_Cloudtype_Backup`

폴더 URL에서 폴더 ID를 확인합니다.

## 2. Apps Script 프로젝트 생성
`script.google.com`에서 새 프로젝트를 만들고 이 폴더의 `Code.gs` 내용을 붙여넣습니다.

프로젝트 설정 → 스크립트 속성에 아래 두 값을 넣습니다.

- `BACKUP_TOKEN`: 임의의 긴 비밀문자열
- `BACKUP_FOLDER_ID`: 위에서 만든 Google Drive 폴더 ID

Apps Script 프로젝트 시간대는 `Asia/Seoul` 권장입니다.

## 3. 웹 앱 배포
배포 → 새 배포 → 웹 앱

- 실행 사용자: 나
- 액세스 권한: 모든 사용자(Anyone)

배포 후 `/exec`로 끝나는 웹 앱 URL을 복사합니다.

## 4. Cloudtype 환경변수
Cloudtype 서비스 환경변수에:

- `GDRIVE_BACKUP_URL` = Apps Script `/exec` URL
- `GDRIVE_BACKUP_TOKEN` = Apps Script의 `BACKUP_TOKEN`과 동일한 값

을 추가하고 재배포합니다.

## 5. 관리자 페이지에서 확인
`백업` → `Google Drive 외부 백업 · 복원`

- 지금 Drive 백업
- 시점 백업 생성
- Drive 최신백업 복원
- Drive 목록

을 사용할 수 있습니다.

외부백업은 비동기 보험용입니다. Google 응답이 늦어도 QR 접수/좌석 변경 요청 자체는 Google 응답을 기다리지 않습니다.
