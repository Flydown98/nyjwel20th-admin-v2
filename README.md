# NYJWEL 20th Admin v2 — v0.2

이번 버전 기능
- 기존 v0.1 로그인/서버 상태/1분 자동백업
- XLSX/XLS 파일 업로드
- 업로드 전 미리보기
- 다음 시트 가져오기:
  - 참가자
  - 문자발송대기
  - 기념품지급
  - 룰렛추첨내역
  - 룰렛상품
  - 행운추첨
  - 좌석설정
  - 설정
  - 접수로그
- 참가자 목록/검색/상태필터
- 좌석설정 목록/검색
- 가져오기 직전/직후 자동백업

## 교체 방법
GitHub `nyjwel20th-admin-v2` 저장소에 이 ZIP의 파일을 그대로 덮어씁니다.
`data/`는 GitHub에 올리지 않습니다.

Cloudtype 환경변수:
- ADMIN_PASSWORD = 기존에 설정한 관리자 비밀번호
- PORT = Cloudtype 자동 설정 사용

Cloudtype:
- Build: npm install
- Start: npm start

배포 후 브라우저에서 Ctrl+Shift+R로 강력 새로고침하세요.

## 개인정보
업로드한 XLSX 원본 파일은 디스크에 저장하지 않고 메모리에서 읽습니다.
가져온 참가자 데이터는 `data/state.json`과 자동백업 JSON에 저장됩니다.
Cloudtype 프로젝트/데이터 파기 전에 필요한 최종 백업을 PC에 내려받으세요.
