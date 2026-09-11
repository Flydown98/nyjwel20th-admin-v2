const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.ADMIN_TOKEN || "";

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function text(res, status, body, type = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 100_000) {
        reject(new Error("요청이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function checkToken(req) {
  if (!TOKEN) return false;
  return req.headers["x-admin-token"] === TOKEN;
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function callMunjanara(params) {
  return new Promise((resolve, reject) => {
    const url = new URL("https://munjanara.co.kr/send.sys");
    url.search = new URLSearchParams(params).toString();

    const request = https.get(url, {
      headers: {
        "User-Agent": "nyjwel20th-admin-v2/0.1",
        "Accept": "text/plain,*/*"
      },
      timeout: 15000
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => resolve({
        httpStatus: response.statusCode,
        body: body.trim()
      }));
    });

    request.on("timeout", () => request.destroy(new Error("문자나라 연결 시간 초과")));
    request.on("error", reject);
  });
}

const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>20주년 관리자 V2 - 서버 테스트</title>
<style>
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,"Noto Sans KR",sans-serif;background:#f5f5f8;color:#20202a}
.wrap{max-width:760px;margin:48px auto;padding:0 18px}.card{background:#fff;border:1px solid #e7e5ee;border-radius:20px;padding:28px;box-shadow:0 8px 28px rgba(30,20,60,.06)}
h1{margin:0 0 8px;font-size:27px} .sub{color:#6c6875;margin-bottom:24px}.ok{padding:13px 15px;background:#f1ecff;border-radius:12px;margin:18px 0}
label{display:block;font-weight:700;margin:15px 0 7px} input,textarea{width:100%;padding:13px;border:1px solid #d8d5df;border-radius:10px;font:inherit}
textarea{min-height:100px;resize:vertical}button{margin-top:18px;width:100%;padding:14px;border:0;border-radius:11px;background:#6c43d9;color:white;font-weight:800;font-size:16px;cursor:pointer}
pre{white-space:pre-wrap;word-break:break-all;background:#17171c;color:#eee;padding:16px;border-radius:12px;min-height:75px}.note{font-size:13px;color:#77717f;line-height:1.55}
</style>
</head>
<body><div class="wrap"><div class="card">
<h1>20주년 현장 관리자 V2</h1>
<div class="sub">Cloudtype 서울 서버 · 문자나라 연결 1차 테스트</div>
<div class="ok">✓ 서버가 정상 실행 중입니다.</div>
<form id="f">
<label>관리 토큰</label><input id="token" type="password" autocomplete="off" placeholder="Cloudtype ADMIN_TOKEN 값">
<label>테스트 수신번호</label><input id="receiver" inputmode="numeric" placeholder="01012345678">
<label>테스트 메시지</label><textarea id="message">남양주시장애인복지관 문자나라 V2 서버 연동 테스트입니다.</textarea>
<button>문자나라 테스트 발송</button>
</form>
<p class="note">문자나라 아이디·2차 비밀번호·발신번호는 이 페이지나 GitHub에 저장하지 않습니다. Cloudtype 환경변수에서만 읽습니다.</p>
<pre id="out">아직 발송하지 않았습니다.</pre>
</div></div>
<script>
document.getElementById("f").addEventListener("submit", async e => {
  e.preventDefault();
  const out = document.getElementById("out");
  out.textContent = "요청 중...";
  try {
    const r = await fetch("/api/test-sms", {
      method:"POST",
      headers:{"Content-Type":"application/json","X-Admin-Token":document.getElementById("token").value},
      body:JSON.stringify({
        receiver:document.getElementById("receiver").value,
        message:document.getElementById("message").value
      })
    });
    const j = await r.json();
    out.textContent = JSON.stringify(j,null,2);
  } catch(err) { out.textContent = String(err); }
});
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && u.pathname === "/") {
    return text(res, 200, page);
  }

  if (req.method === "GET" && u.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "nyjwel20th-admin-v2",
      regionHint: "Cloudtype deployment",
      time: new Date().toISOString()
    });
  }

  if (req.method === "POST" && u.pathname === "/api/test-sms") {
    if (!checkToken(req)) return json(res, 401, {ok:false, error:"관리 토큰이 올바르지 않습니다."});

    const userid = process.env.MUNJANARA_ID;
    const passwd = process.env.MUNJANARA_PW;
    const sender = onlyDigits(process.env.MUNJANARA_SENDER);

    if (!userid || !passwd || !sender) {
      return json(res, 500, {ok:false, error:"Cloudtype 문자나라 환경변수가 설정되지 않았습니다."});
    }

    try {
      const raw = await readBody(req);
      let data;
      try { data = JSON.parse(raw || "{}"); }
      catch { return json(res, 400, {ok:false, error:"JSON 형식 오류"}); }

      const receiver = onlyDigits(data.receiver);
      const message = String(data.message || "").trim();

      if (receiver.length < 8 || receiver.length > 13) {
        return json(res, 400, {ok:false, error:"수신번호를 확인해주세요."});
      }
      if (!message) return json(res, 400, {ok:false, error:"메시지가 비어 있습니다."});
      if (Buffer.byteLength(message, "utf8") > 1800) {
        return json(res, 400, {ok:false, error:"1차 테스트에서는 메시지를 더 짧게 입력해주세요."});
      }

      const result = await callMunjanara({
        userid,
        passwd,
        sender,
        receiver,
        message,
        encode: "1",
        end_alert: "0",
        allow_mms: "1"
      });

      const parts = result.body.split("|");
      return json(res, 200, {
        ok: result.httpStatus === 200 && parts[0] === "9",
        munjanaraHttpStatus: result.httpStatus,
        resultCode: parts[0] || "",
        balance: parts[1] || "",
        sendCount: parts[2] || "",
        reservation: parts[3] || "",
        raw: result.body,
        note: parts[0] === "9"
          ? "문자나라가 발송 요청을 접수했습니다. 실제 휴대폰 수신 및 문자나라 전송내역도 확인해주세요."
          : "문자나라가 요청을 성공으로 접수하지 않았습니다."
      });
    } catch (err) {
      return json(res, 502, {ok:false, error:err.message});
    }
  }

  json(res, 404, {ok:false, error:"Not found"});
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`nyjwel20th-admin-v2 listening on ${PORT}`);
});
