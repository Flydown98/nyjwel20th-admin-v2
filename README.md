# NYJWEL 20th Admin v2 - Starter

## 1. GitHub에 업로드
이 ZIP의 내용물을 저장소 루트에 그대로 업로드합니다.

## 2. Cloudtype 환경변수
반드시 아래 환경변수를 설정하세요.

- `ADMIN_PASSWORD` : 관리자 비밀번호
- `PORT` : Cloudtype이 자동으로 넣어주면 따로 설정할 필요 없음

## 3. 실행 명령
- Build: `npm install`
- Start: `npm start`

## 4. 확인
Cloudtype 배포 주소 접속 -> 로그인 -> 서버 새로고침 -> 테스트 저장 -> 백업 다운로드

## 중요
- `data/` 폴더는 `.gitignore` 처리되어 개인정보가 GitHub에 올라가지 않습니다.
- 현재 v0.1은 서버/로그인/임시저장/자동백업 연결 확인용입니다.
- 참가자/QR/좌석/단체/행운권 기능은 다음 단계에서 추가합니다.
