# nyjwel20th-admin-v2

남양주시장애인복지관 개관 20주년 현장 관리자 V2의 1차 테스트 서버입니다.

현재 단계의 목적:
1. Cloudtype 서울 리전에서 Node.js 서버 정상 실행 확인
2. Cloudtype 서버 → 문자나라 `send.sys` 직접 호출
3. 실제 휴대폰 수신 여부 확인

## Cloudtype
- Port: `3000`
- Install command: `npm install`
- Build command: 비움
- Start command: `npm start`

## Environment variables
GitHub에 실제 값을 올리지 말고 Cloudtype에서만 설정합니다.

- `ADMIN_TOKEN` : 직접 정한 긴 임의 문자열
- `MUNJANARA_ID` : 문자나라 아이디
- `MUNJANARA_PW` : 문자나라 2차 비밀번호
- `MUNJANARA_SENDER` : 문자나라에 사전등록된 발신번호

배포 후 서비스 주소를 열어 테스트 수신번호와 메시지를 입력해 발송합니다.
