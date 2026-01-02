// auth.js

// 1. 현재 페이지가 로그인 페이지인지 확인
const isLoginPage = window.location.pathname.includes('login.html');

// 2. 로컬 스토리지에서 토큰 가져오기
const authToken = localStorage.getItem('novel_auth_token');

// 3. 토큰이 없는데 로그인 페이지가 아니라면 -> 로그인 페이지로 강제 이동
if (!authToken && !isLoginPage) {
    alert("로그인이 필요한 서비스입니다.");
    window.location.href = 'login.html';
}

// 4. (선택) 로그아웃 함수 - 전역에서 쓰기 위해 window 객체에 등록
window.logout = function() {
    if(confirm("로그아웃 하시겠습니까?")) {
        localStorage.removeItem('novel_auth_token');
        window.location.href = 'login.html';
    }
};

// 5. (선택) API 요청 시 토큰을 헤더에 실어 보내는 공통 함수
// 기존 fetch 대신 이 함수를 쓰면 보안이 강화됩니다. (선택사항)
window.authFetch = async function(url, options = {}) {
    const token = localStorage.getItem('novel_auth_token');
    
    if (!options.headers) options.headers = {};
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, options);
    
    // 토큰 만료 시 처리 (서버에서 401이나 403을 줄 경우)
    if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('novel_auth_token');
        alert("세션이 만료되었습니다. 다시 로그인해주세요.");
        window.location.href = 'login.html';
        return null;
    }
    
    return response;
};